"""Registered publication artifacts. File IO occurs outside the reservation transaction."""

from datetime import UTC
from typing import Any, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy.exc import IntegrityError

from shift_scheduler.api.routers.planning import DB, RequestModel, Scope, User, access
from shift_scheduler.application import publication_artifacts as service
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import Evidence
from shift_scheduler.ops.managed_writer import registered_copy

router = APIRouter(prefix="/planning", tags=["registered artifacts"])


class ArtifactRequest(RequestModel):
    expected_revision: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    format: Literal["json", "csv", "csv-wide"]


class DownloadRequest(RequestModel):
    expected_revision: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    destination: str = Field(min_length=1, max_length=512)


@router.post("/publications/{publication_id}/artifacts", response_model=None)
def prepare_artifact(
    publication_id: str, request: ArtifactRequest, scope_id: Scope, user: User
) -> dict[str, Any]:
    from shift_scheduler.ops.managed_writer import publish_bytes

    factory = get_session_factory()
    try:
        with factory.begin() as session:
            access(session, user, scope_id, write=True)
            result, data = service.prepare(
                session,
                scope_id,
                user.user_id,
                publication_id,
                request.expected_revision,
                request.format,
                request.idempotency_key,
            )
        # Intent/receipt is committed before file IO, without a long DB lock.
        publish_bytes(factory, scope_id, result["copy_id"], data)
        with factory.begin() as session:
            access(session, user, scope_id, write=True)
            row, _, _ = service.read_registered(session, scope_id, result["copy_id"])
            return {**result, "revision": row.revision, "state": row.state}
    except LookupError as exc:
        raise HTTPException(404, "Published artifact not found") from exc
    except (Conflict, IntegrityError) as exc:
        raise HTTPException(
            409, "Publication, copy state or request changed; review before retry"
        ) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            503,
            "File publication incomplete; retry the same request",
            headers={"Retry-After": "1"},
        ) from exc


@router.post("/artifacts/{copy_id}/download", response_model=None)
def download(
    copy_id: str, request: DownloadRequest, scope_id: Scope, session: DB, user: User
) -> Response | dict[str, Any]:
    from shift_scheduler.api.routers.compliance import Mutation, once
    from shift_scheduler.application import copies

    access(session, user, scope_id, write=True)
    try:
        row, people, data = service.read_registered(session, scope_id, copy_id)
    except OSError as exc:
        raise HTTPException(
            503, "Artifact temporarily unavailable", headers={"Retry-After": "1"}
        ) from exc
    mutation = Mutation(
        expected_revision=request.expected_revision,
        idempotency_key=request.idempotency_key,
        payload={"copy_id": copy_id, "destination": request.destination},
    )

    def register_transfer() -> dict[str, Any]:
        if row.revision != request.expected_revision:
            raise Conflict("Artifact version changed")
        transfer = uuid4().hex
        copies.register(
            session,
            scope_id,
            CopyRegistration(
                copy_id=transfer,
                category="exports",
                medium="external",
                relative_path="download:" + transfer,
                content_hash=row.content_hash,
                person_ids=people,
                anchor=cast(
                    Literal[
                        "period_end",
                        "last_activity",
                        "case_closed",
                        "backup_created",
                    ],
                    row.anchor,
                ),
                anchor_at=(
                    row.anchor_at.replace(tzinfo=UTC)
                    if row.anchor_at.tzinfo is None
                    else row.anchor_at
                ),
                subject_status="VERIFIED",
                evidence=Evidence(
                    reference="artifact:" + copy_id,
                    status="verified",
                    verified_by="registered-artifact-download",
                ),
            ),
            0,
            user.user_id,
        )
        tracked = registered_copy(session, transfer)  # registered just above
        tracked.locator = {
            **tracked.locator,
            "source_copy_id": copy_id,
            "source_publication_id": row.locator["source_publication_id"],
            "recipient": user.user_id,
            "destination": request.destination,
            "hash_scheme": "sha256-bytes",
            "confirmation": "UNCONFIRMED",
        }
        return {"transfer_id": transfer}

    receipt = once(
        session,
        scope_id,
        user.user_id,
        "artifact.download",
        mutation,
        register_transfer,
    )
    return Response(
        content=data,
        media_type=service.FORMATS[row.locator["format"]],
        headers={
            "Cache-Control": "no-store",
            "X-Transfer-ID": receipt["transfer_id"],
            "X-Content-SHA256": row.content_hash,
            "Content-Disposition": f'attachment; filename="{copy_id}.{row.locator["format"]}"',
        },
    )
