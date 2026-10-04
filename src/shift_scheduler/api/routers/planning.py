"""Reviewed planning API. Every object lookup is scoped by active DB membership."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from shift_scheduler.api.dependencies import UserPrincipal, get_current_user
from shift_scheduler.application import planning as service
from shift_scheduler.db.planning_models import (
    AccountMembership,
    NotificationRead,
    PlanningDraft,
    PlanningHead,
    PlanningInput,
    PlanningInputHead,
    PlanningJob,
    PlanningOutbox,
    PlanningPublication,
    PlanningScope,
)
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain.compliance import SolverSnapshotV2, parse_snapshot
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import Duty, Proposal, SolverSnapshot, content_hash

router = APIRouter(prefix="/planning", tags=["reviewed planning"])


def transaction() -> Iterator[Session]:
    with get_session_factory()() as session:
        try:
            with session.begin():
                yield session
        except service.Blocked as exc:
            raise HTTPException(422, detail=str(exc)) from exc
        except (service.Conflict, IntegrityError) as exc:
            raise HTTPException(
                409,
                detail="Input, version or ledger conflict; refresh and review again",
            ) from exc
        except LookupError as exc:
            raise HTTPException(
                404, detail="Object not found in authorized scope"
            ) from exc
        except ValueError as exc:
            from shift_scheduler.application.actual_file import ActualFileErrors

            if isinstance(exc, ActualFileErrors):
                raise HTTPException(
                    422, detail={"message": str(exc), "row_errors": exc.errors}
                ) from exc
            raise HTTPException(422, detail=str(exc)) from exc


DB = Annotated[Session, Depends(transaction, scope="function")]
User = Annotated[UserPrincipal, Depends(get_current_user)]
Scope = Annotated[str, Query(min_length=3, max_length=256)]


def memberships(session: Session, user: UserPrincipal) -> Sequence[AccountMembership]:
    claims = user.claims or {}
    issuer, subject = claims.get("iss", "mock"), claims.get("sub", user.user_id)
    return session.scalars(
        select(AccountMembership).where(
            AccountMembership.issuer == issuer,
            AccountMembership.subject == subject,
            AccountMembership.active.is_(True),
        )
    ).all()


def access(
    session: Session,
    user: UserPrincipal,
    scope_id: str,
    write: bool = False,
    admin: bool = False,
    privacy_purpose: bool = False,
) -> AccountMembership:
    from shift_scheduler.db.compliance_models import RestoreGate

    gate = session.get(RestoreGate, "restore")
    if gate and gate.state != "REPLAYED":
        raise HTTPException(
            503, "Restored database is quarantined pending erasure/restriction replay"
        )
    matching = [m for m in memberships(session, user) if m.scope_id == scope_id]
    if not matching:
        raise HTTPException(403, "No active membership in this facility/department")
    member = matching[0]
    if admin and member.role != "ADMIN":
        raise HTTPException(403, "Administrator membership required")
    if write and member.role not in ("ADMIN", "LEADER"):
        raise HTTPException(403, "Planning permission required")
    if not privacy_purpose:
        from shift_scheduler.application.privacy import restricted_people

        if restricted_people(session, scope_id):
            raise HTTPException(
                423,
                "Approved use restriction is active; planning access is suspended pending scoped reconciliation",
            )
    return member


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanningScopeSummary(RequestModel):
    scope_id: str
    display_name: str
    person_id: str
    role: Literal["ADMIN", "LEADER", "PHARMACIST"]
    input_revision: int


class DashboardMetric(RequestModel):
    value: int | None
    state: Literal["available", "unknown"]
    reason: str | None


class DashboardSource(RequestModel):
    kind: str
    id: str
    version: int
    input_hash: str | None = None


class DashboardSummary(RequestModel):
    scope_id: str
    period: str
    role: str
    visibility: Literal["department", "self"]
    observed_at: datetime
    sources: list[DashboardSource]
    metrics: dict[str, DashboardMetric]

    @field_serializer("observed_at")
    def serialize_observed_at(self, value: datetime) -> str:
        # Preserve the established wire representation. ``Z`` and ``+00:00`` are
        # equivalent RFC 3339 offsets, but exact clients and signed evidence must
        # not change merely because this response acquired an explicit model.
        return value.isoformat()


class WorkspaceNotification(RequestModel):
    event_id: str
    kind: str
    category: Literal["schedule", "change", "lifecycle"]
    publication_id: str | None
    version: int | None
    created_at: datetime
    read: bool


class InputRequest(RequestModel):
    snapshot: SolverSnapshotV3 | SolverSnapshotV2 | SolverSnapshot = Field(
        discriminator="schema_version"
    )
    expected_revision: int = Field(ge=0)


class JobRequest(RequestModel):
    input_hash: str
    idempotency_key: str = Field(min_length=8, max_length=128)
    budget_seconds: int = Field(default=25, ge=1, le=300)
    # A different seed may find a different plan of equal priority; 0 is the default run.
    random_seed: int = Field(default=0, ge=0, le=2**31 - 1)


class KeyedRequest(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)


class DraftRequest(KeyedRequest):
    input_hash: str
    proposal: Proposal


class EditRequest(KeyedRequest):
    version: int = Field(ge=1)
    proposal: Proposal


class ReviewRequest(KeyedRequest):
    version: int = Field(ge=1)


class PublishRequest(ReviewRequest):
    expected_publication_version: int = Field(ge=0)
    input_hash: str
    review_hash: str
    idempotency_key: str = Field(min_length=8, max_length=128)


class ActualRequest(RequestModel):
    external_id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)
    duty: Duty


def draft_response(draft: PlanningDraft) -> dict[str, Any]:
    return {
        "draft_id": draft.draft_id,
        "input_hash": draft.input_hash,
        "version": draft.version,
        "proposal": draft.proposal,
        "validation": draft.validation,
        "review_hash": draft.reviewed_hash,
        "status": draft.status,
    }


@router.get("/scopes", response_model=list[PlanningScopeSummary])
def list_scopes(session: DB, user: User) -> list[dict[str, Any]]:
    result = []
    for m in memberships(session, user):
        scope = session.get(PlanningScope, m.scope_id)
        result.append(
            {
                "scope_id": m.scope_id,
                "display_name": (
                    scope.display_name if scope and scope.display_name else m.scope_id
                ),
                "person_id": m.person_id,
                "role": m.role,
                "input_revision": scope.input_revision if scope else 0,
            }
        )
    return result


def dashboard_observation_time() -> datetime:
    """Presentation observation clock; synthetic fixtures can override this dependency."""
    return datetime.now(UTC)


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(
    scope_id: Scope,
    session: DB,
    user: User,
    period: Annotated[str, Query(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")],
    observed_at: Annotated[datetime, Depends(dashboard_observation_time)],
) -> dict[str, Any]:
    from shift_scheduler.application.dashboard import monthly_summary

    member = access(session, user, scope_id)
    if period.startswith("0000-") or period == "9999-12":
        raise HTTPException(422, "Period is outside the supported calendar range")
    # These reads already implement per-person/per-department authorization.
    return monthly_summary(
        scope_id,
        period,
        member.role,
        publications(scope_id, session, user),
        staff_requests(scope_id, session, user),
        observed_at=observed_at,
    )


@router.get("/operations")
def operations(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    now = datetime.now(UTC)

    def count(statement: Any) -> int:
        return int(session.scalar(statement) or 0)

    jobs = (
        select(func.count())
        .select_from(PlanningJob)
        .join(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
    )
    undelivered = (
        select(func.count())
        .select_from(PlanningOutbox)
        .where(
            PlanningOutbox.scope_id == scope_id, PlanningOutbox.delivered_at.is_(None)
        )
    )
    current = session.scalars(
        select(PlanningInput)
        .join(
            PlanningInputHead, PlanningInputHead.input_hash == PlanningInput.input_hash
        )
        .where(PlanningInputHead.scope_id == scope_id)
    ).all()
    return {
        "checked_at": now.isoformat(),
        "queued": count(jobs.where(PlanningJob.status == "QUEUED")),
        "expired_leases": count(
            jobs.where(PlanningJob.status == "RUNNING", PlanningJob.lease_until < now)
        ),
        "queue_over_five_minutes": count(
            jobs.where(
                PlanningJob.status == "QUEUED",
                PlanningJob.created_at < now - timedelta(minutes=5),
            )
        ),
        "audit_undelivered": count(undelivered),
        "audit_over_24_hours": count(
            undelivered.where(PlanningOutbox.created_at < now - timedelta(hours=24))
        ),
        "stale_planning_periods": sum(
            not service.input_is_current(session, row) for row in current
        ),
        "meaning": "Operational counters only; zero is not proof of schedule or legal compliance",
    }


@router.post("/inputs")
def register(
    payload: InputRequest, session: DB, user: User, scope_id: str | None = None
) -> dict[str, Any]:
    target = service.scope_of(payload.snapshot)
    access(session, user, target, admin=True)
    # The screen names the department it shows; a file for another one is refused.
    if scope_id is not None and scope_id != target:
        raise HTTPException(
            422, "取込ファイルの施設・部署が、選択中の部署と異なります。"
        )
    scope_id = target
    return service.register_input(
        session, payload.snapshot, user.user_id, payload.expected_revision
    )


@router.get("/inputs/latest")
def latest_input(
    scope_id: Scope, session: DB, user: User, input_hash: str | None = None
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    statement = (
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if input_hash:
        statement = select(PlanningInput).where(
            PlanningInput.scope_id == scope_id, PlanningInput.input_hash == input_hash
        )
    row = session.scalar(statement)
    if row is None:
        raise HTTPException(404, "No planning input has been registered")
    scope = session.get(PlanningScope, scope_id)
    assert scope is not None
    snapshot = parse_snapshot(row.payload)
    head = session.get(
        PlanningHead, content_hash([scope_id, service.period_key(snapshot)])
    )
    return {
        "input_hash": row.input_hash,
        "input_revision": scope.input_revision,
        "snapshot": row.payload,
        "stale": not service.input_is_current(session, row),
        "publication_version": head.version if head else 0,
    }


@router.get("/inputs")
def input_periods(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    access(session, user, scope_id, write=True)
    rows = session.scalars(
        select(PlanningInput)
        .join(
            PlanningInputHead, PlanningInputHead.input_hash == PlanningInput.input_hash
        )
        .where(PlanningInputHead.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
    )
    return [
        {
            "input_hash": row.input_hash,
            "period": row.payload["period"],
            "stale": not service.input_is_current(session, row),
        }
        for row in rows
    ]


@router.post("/jobs", status_code=202)
def enqueue(
    payload: JobRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    job = service.enqueue(
        session,
        payload.input_hash,
        scope_id,
        user.user_id,
        payload.idempotency_key,
        payload.budget_seconds,
        seed=payload.random_seed,
    )
    return {"job_id": job.job_id, "status": job.status}


def job_response(job: PlanningJob) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "input_hash": job.input_hash,
        "budget_seconds": job.budget_seconds,
        "status": job.status,
        "result": job.result,
        "created_at": job.created_at,
        "claimed_at": job.claimed_at,
        "completed_at": job.completed_at,  # compatibility: prepared inside result transaction
        "prepared_at": job.completed_at,
        "persisted_observed_at": job.persisted_observed_at,
        "timing_semantics": "completed_at/prepared_at precede commit; persisted_observed_at is a later commit acknowledgement",
        "stage_seconds": job.stage_seconds,
    }


@router.get("/jobs/by-key")
def job_by_key(
    idempotency_key: Annotated[str, Query(min_length=8, max_length=128)],
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    """Recover an acknowledged-or-unknown submission without reactivating its input."""
    access(session, user, scope_id, write=True)
    key = content_hash([scope_id, user.user_id, idempotency_key])
    job = session.scalar(
        select(PlanningJob).where(
            PlanningJob.request_key == key, PlanningJob.requested_by == user.user_id
        )
    )
    if job is None:
        return {"job": None}
    service.require_input(session, job.input_hash, scope_id)
    return {"job": job_response(job)}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    job = session.get(PlanningJob, job_id)
    if job is None:
        raise HTTPException(404)
    service.require_input(session, job.input_hash, scope_id)
    return job_response(job)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(
    job_id: str, payload: KeyedRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    def action() -> dict[str, Any]:
        job = session.get(PlanningJob, job_id)
        if job is None:
            raise HTTPException(404)
        service.require_input(session, job.input_hash, scope_id)
        # DML returns a CursorResult, which carries rowcount.
        changed = cast(
            CursorResult[Any],
            session.execute(
                update(PlanningJob)
                .where(
                    PlanningJob.job_id == job_id,
                    PlanningJob.status.in_(["QUEUED", "RUNNING"]),
                )
                .values(status="CANCELLED")
            ),
        ).rowcount
        if changed:
            service.emit(
                session, scope_id, user.user_id, "job.cancel", {"job_id": job_id}
            )
        return {"job_id": job_id, "status": job.status}

    return once(
        session, scope_id, user.user_id, "job-cancel:" + job_id, payload, action
    )


@router.post("/drafts", status_code=201)
def create_draft(
    payload: DraftRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    def action() -> dict[str, Any]:
        row = service.require_input(session, payload.input_hash, scope_id)
        return draft_response(
            service.new_draft(session, row, payload.proposal, user.user_id)
        )

    return once(session, scope_id, user.user_id, "draft-create", payload, action)


@router.get("/drafts/{draft_id}")
def get_draft(
    draft_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    draft, _ = service.require_draft(session, draft_id, scope_id)
    return draft_response(draft)


@router.put("/drafts/{draft_id}")
def edit(
    draft_id: str, payload: EditRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    return once(
        session,
        scope_id,
        user.user_id,
        "draft-edit:" + draft_id,
        payload,
        lambda: draft_response(
            service.edit_draft(
                session,
                draft_id,
                scope_id,
                payload.proposal,
                payload.version,
                user.user_id,
            )
        ),
    )


@router.post("/drafts/{draft_id}/review")
def review(
    draft_id: str, payload: ReviewRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    return once(
        session,
        scope_id,
        user.user_id,
        "draft-review:" + draft_id,
        payload,
        lambda: service.review_draft(
            session, draft_id, scope_id, payload.version, user.user_id
        ),
    )


@router.post("/drafts/{draft_id}/publish")
def publish(
    draft_id: str, payload: PublishRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    return service.publish(
        session,
        draft_id,
        scope_id,
        user.user_id,
        payload.version,
        payload.expected_publication_version,
        payload.input_hash,
        payload.review_hash,
        payload.idempotency_key,
    )


@router.get("/publications")
def publications(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    member = access(session, user, scope_id)
    heads = session.scalars(
        select(PlanningHead)
        .join(
            PlanningPublication,
            PlanningHead.publication_id == PlanningPublication.publication_id,
        )
        .where(PlanningPublication.scope_id == scope_id)
    ).all()
    result = []
    for head in heads:
        row = session.get(PlanningPublication, head.publication_id)
        assert row is not None
        source_input = session.get(PlanningInput, row.payload["input_hash"])
        duties = row.payload["assignments"]
        if member.role not in ("ADMIN", "LEADER"):
            duties = [d for d in duties if d["person_id"] == member.person_id]
        result.append(
            {
                "publication_id": row.publication_id,
                "version": row.version,
                "period": row.period_key,
                "input_hash": row.payload["input_hash"],
                "assignments": duties,
                "validation_status": (
                    "verified_at_publication"
                    if source_input and service.input_is_current(session, source_input)
                    else "revalidation_required"
                ),
            }
        )
    return result


@router.get("/publications/{publication_id}/export")
def export(
    publication_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    row = session.get(PlanningPublication, publication_id)
    if row is None or row.scope_id != scope_id:
        raise HTTPException(404)
    assignments = row.payload["assignments"]
    head = session.get(PlanningHead, content_hash([scope_id, row.period_key]))
    result = {
        "schema_version": 1,
        "publication_id": row.publication_id,
        "period": row.period_key,
        "rule_revision": row.payload["rule_revision"],
        "is_current_publication": bool(
            head and head.publication_id == row.publication_id
        ),
        "version": row.version,
        "input_hash": row.payload["input_hash"],
        "assignments": assignments,
        "count": len(assignments),
        "work_seconds": sum(Duty.model_validate(d).work_seconds for d in assignments),
        "content_hash": content_hash(assignments),
    }
    from datetime import UTC, datetime
    from uuid import uuid4

    from shift_scheduler.application import copies
    from shift_scheduler.domain.copies import CopyRegistration
    from shift_scheduler.domain.planning import Evidence
    from shift_scheduler.ops.managed_writer import registered_copy

    transfer = uuid4().hex
    copies.register(
        session,
        scope_id,
        CopyRegistration(
            copy_id=transfer,
            category="exports",
            medium="external",
            relative_path="download:" + transfer,
            content_hash=content_hash(result),
            person_ids=tuple(sorted({d["person_id"] for d in assignments})),
            anchor="last_activity",
            anchor_at=datetime.now(UTC),
            subject_status="VERIFIED",
            evidence=Evidence(
                reference="published-assignments:" + row.publication_id,
                status="verified",
                verified_by="typed-export",
            ),
        ),
        0,
        user.user_id,
    )
    tracked = registered_copy(session, transfer)  # registered just above
    tracked.locator = {
        **tracked.locator,
        "source_publication_id": row.publication_id,
        "source_version": row.version,
        "recipient": user.user_id,
        "hash_scheme": "canonical-content-hash-without-transfer-id",
    }
    return {**result, "transfer_id": transfer}


@router.post("/actuals")
def actual(
    # Kept so the retired route still validates the old body shape before answering 410.
    payload: ActualRequest,  # noqa: ARG001
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    raise HTTPException(
        410,
        "Use /planning/compliance/actual-events with expected_revision and idempotency_key",
    )


@router.get("/notifications", response_model=list[WorkspaceNotification])
def notifications(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    member = access(session, user, scope_id)
    events = session.scalars(
        select(PlanningOutbox)
        .where(
            PlanningOutbox.scope_id == scope_id,
            PlanningOutbox.kind.in_(
                (
                    "schedule.published",
                    "schedule.cancelled",
                    "change.approved",
                    "change.recommended",
                    "change.rejected",
                    "change.withdrawn",
                    "lifecycle.onboard.created",
                    "lifecycle.offboard.created",
                    "lifecycle.task.completed",
                )
            ),
        )
        .order_by(PlanningOutbox.created_at.desc())
        .limit(100)
    ).all()
    result = []
    for e in events:
        if member.person_id not in e.payload.get("person_ids", []):
            continue
        result.append(
            {
                "event_id": e.event_id,
                "publication_id": e.payload.get("publication_id"),
                "version": e.payload.get("version"),
                "kind": e.kind,
                "category": e.kind.split(".", 1)[0],
                "created_at": e.created_at,
                "read": session.get(
                    NotificationRead, content_hash([e.event_id, member.person_id])
                )
                is not None,
            }
        )
    return result


@router.post("/notifications/{event_id}/read")
def mark_read(
    event_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    event = session.get(PlanningOutbox, event_id)
    if (
        event is None
        or event.scope_id != scope_id
        or member.person_id not in event.payload.get("person_ids", [])
    ):
        raise HTTPException(404)
    key = content_hash([event_id, member.person_id])
    if session.get(NotificationRead, key) is None:
        session.add(
            NotificationRead(
                key=key,
                event_id=event_id,
                person_id=member.person_id,
                read_at=datetime.now(UTC),
            )
        )
    return {"read": True}


class CancelRequest(KeyedRequest):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


class SettlementRequest(RequestModel):
    publication_id: str = Field(min_length=1, max_length=64)
    event_id: str = Field(min_length=8, max_length=128)
    kind: str
    amount: int = Field(gt=0)
    expected_revision: int = Field(ge=0)


@router.post("/publications/{publication_id}/cancel")
def cancel_publication(
    publication_id: str,
    payload: CancelRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    return once(
        session,
        scope_id,
        user.user_id,
        "publication-cancel:" + publication_id,
        payload,
        lambda: service.cancel_publication(
            session,
            publication_id,
            scope_id,
            user.user_id,
            payload.expected_version,
            payload.reason,
        ),
    )


@router.get("/leave-balances")
def leave_balances(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    from shift_scheduler.db.planning_models import LeaveBalance

    member = access(session, user, scope_id)
    row = session.scalar(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if row is None:
        return []
    ids = [
        g["grant_id"]
        for g in row.payload["grants"]
        if member.role in ("ADMIN", "LEADER") or g["person_id"] == member.person_id
    ]
    return [
        {
            "grant_id": b.grant_id,
            "person_id": b.person_id,
            "amount": b.amount,
            "consumed": b.consumed,
            "reserved": b.reserved,
            "revision": b.revision,
            "unit": b.payload["unit"],
        }
        for b in session.scalars(
            select(LeaveBalance).where(LeaveBalance.grant_id.in_(ids))
        )
    ]


@router.post("/leave-balances/{grant_id}/settle")
def settle(
    grant_id: str, payload: SettlementRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    allowed = leave_balances(scope_id, session, user)
    if grant_id not in {g["grant_id"] for g in allowed}:
        raise HTTPException(404)
    return service.settle_leave(
        session,
        scope_id,
        user.user_id,
        grant_id,
        payload.event_id,
        payload.kind,
        payload.amount,
        payload.expected_revision,
        payload.publication_id,
    )


class StaffRequest(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    start: datetime
    end: datetime
    kind: str
    rank: int = Field(default=1, ge=1, le=100)
    grant_id: str | None = None
    amount: int = Field(default=1, gt=0)


class RequestDecision(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    version: int = Field(ge=1)
    approved: bool
    reference: str = Field(min_length=1)


class WithdrawalRequest(RequestModel):
    version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)


class RefreshRequest(RequestModel):
    expected_revision: int = Field(ge=0)
    input_hash: str | None = None


@router.get("/requests")
def staff_requests(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    from shift_scheduler.db.planning_models import PlanningRequest

    member = access(session, user, scope_id)
    statement = select(PlanningRequest).where(PlanningRequest.scope_id == scope_id)
    if member.role not in ("ADMIN", "LEADER"):
        statement = statement.where(PlanningRequest.person_id == member.person_id)
    return [
        {
            "request_id": r.request_id,
            "person_id": r.person_id,
            "version": r.version,
            "kind": r.kind,
            "status": r.status,
            "payload": r.payload,
            "decision": r.decision,
        }
        for r in session.scalars(statement)
    ]


@router.post("/requests", status_code=201)
def submit_request(
    payload: StaffRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from uuid import uuid4

    from shift_scheduler.db.planning_models import LeaveBalance, PlanningRequest
    from shift_scheduler.domain.planning import Interval

    member = access(session, user, scope_id)
    from shift_scheduler.api.routers.compliance import once

    def action() -> dict[str, Any]:
        Interval(start=payload.start, end=payload.end)
        if payload.kind not in ("PUBLIC_HOLIDAY_REQUEST", "PAID_LEAVE_REQUEST"):
            raise HTTPException(422, "Unsupported request kind")
        if payload.kind == "PAID_LEAVE_REQUEST":
            balance = (
                session.get(LeaveBalance, payload.grant_id)
                if payload.grant_id
                else None
            )
            if not balance or balance.person_id != member.person_id:
                raise HTTPException(422, "本人の年休付与台帳を選択してください")
        row = PlanningRequest(
            request_id=uuid4().hex,
            scope_id=scope_id,
            person_id=member.person_id,
            version=1,
            kind=payload.kind,
            status="PENDING",
            payload=payload.model_dump(mode="json", exclude={"idempotency_key"}),
        )
        session.add(row)
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id == scope_id)
            .values(
                input_revision=PlanningScope.input_revision + 1,
                data_revision=PlanningScope.data_revision + 1,
            )
        )
        service.emit(
            session,
            scope_id,
            user.user_id,
            "request.submit",
            {"request_id": row.request_id, "person_id": member.person_id},
        )
        return {"request_id": row.request_id, "status": row.status}

    return once(session, scope_id, user.user_id, "request-submit", payload, action)


@router.post("/requests/{request_id}/decision")
def decide_request(
    request_id: str, payload: RequestDecision, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.db.planning_models import PlanningRequest

    access(session, user, scope_id, write=True)
    from shift_scheduler.api.routers.compliance import once

    def action() -> dict[str, Any]:
        row = session.get(PlanningRequest, request_id)
        if row is None or row.scope_id != scope_id:
            raise HTTPException(404)
        service.require_unpublished_request(session, scope_id, request_id)
        decision = {
            "reference": payload.reference,
            "status": "verified",
            "verified_by": user.user_id,
        }
        changed = session.execute(
            update(PlanningRequest)
            .where(
                PlanningRequest.request_id == request_id,
                PlanningRequest.version == payload.version,
            )
            .values(
                version=payload.version + 1,
                status="APPROVED" if payload.approved else "REQUIRES_DISCUSSION",
                decision=decision,
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise HTTPException(409, "Request changed")
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id == scope_id)
            .values(
                input_revision=PlanningScope.input_revision + 1,
                data_revision=PlanningScope.data_revision + 1,
            )
        )
        service.emit(
            session,
            scope_id,
            user.user_id,
            "request.decision",
            {
                "request_id": request_id,
                "decision": decision,
                "approved": payload.approved,
            },
        )
        return {
            "status": "APPROVED" if payload.approved else "REQUIRES_DISCUSSION",
            "version": payload.version + 1,
        }

    return once(
        session,
        scope_id,
        user.user_id,
        "request-decision:" + request_id,
        payload,
        action,
    )


@router.post("/requests/{request_id}/withdraw")
def withdraw(
    request_id: str,
    payload: WithdrawalRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    from shift_scheduler.db.planning_models import PlanningRequest

    member = access(session, user, scope_id)
    from shift_scheduler.api.routers.compliance import once

    def action() -> dict[str, Any]:
        row = session.get(PlanningRequest, request_id)
        if row is None or row.scope_id != scope_id or row.person_id != member.person_id:
            raise HTTPException(404)
        service.require_unpublished_request(session, scope_id, request_id)
        changed = session.execute(
            update(PlanningRequest)
            .where(
                PlanningRequest.request_id == request_id,
                PlanningRequest.version == payload.version,
                PlanningRequest.status != "CANCELLED",
            )
            .values(status="CANCELLED", version=payload.version + 1)
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise service.Conflict("Request changed concurrently")
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id == scope_id)
            .values(
                input_revision=PlanningScope.input_revision + 1,
                data_revision=PlanningScope.data_revision + 1,
            )
        )
        service.emit(
            session,
            scope_id,
            user.user_id,
            "request.withdraw",
            {"request_id": request_id, "person_id": member.person_id},
        )
        return {"status": "CANCELLED", "version": payload.version + 1}

    return once(
        session,
        scope_id,
        user.user_id,
        "request-withdraw:" + request_id,
        payload,
        action,
    )


@router.post("/inputs/refresh")
def refresh(
    payload: RefreshRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.refresh_input(
        session, scope_id, user.user_id, payload.expected_revision, payload.input_hash
    )
