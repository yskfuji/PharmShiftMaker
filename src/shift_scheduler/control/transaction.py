"""Application-side prepare/commit receipt; an ambiguous outcome never self-aborts."""

import os
from uuid import uuid4

from sqlalchemy import event
from sqlalchemy.orm import Session

from shift_scheduler.control.client import configured_client
from shift_scheduler.db.compliance_models import ControlCommit
from shift_scheduler.domain.planning import content_hash


def stage_control(session: Session) -> None:
    if configured_client() is not None:
        session.info["control_dirty"] = True


@event.listens_for(Session, "before_commit")
def prepare_control(session: Session) -> None:
    if not session.info.pop("control_dirty", False):
        return
    from shift_scheduler.ops.erasure_replay import export_manifest

    client = configured_client()
    if client is None:
        raise RuntimeError("Control configuration changed during operation")
    session.flush()
    manifest = export_manifest(
        session,
        os.environ.get("PHARMSHIFT_ERASURE_MANIFEST_KEY", "").encode(),
        include_policies=True,
    )
    generation = client.require_access()["generation"]
    operation = uuid4().hex
    digest = content_hash(manifest)
    receipt = {
        "operation_id": operation,
        "source_id": client.client_id,
        "expected_generation": generation,
        "manifest_hash": digest,
    }
    # Store the operation id before the call: an unacknowledged prepare is still
    # visible in the independent service and MUST remain blocked for reconciliation.
    session.info["control_prepared"] = {
        **receipt,
        "receipt_hash": content_hash(receipt),
    }
    client.request(
        "POST",
        "/operations/prepare",
        {
            "operation_id": operation,
            "expected_generation": generation,
            "manifest": manifest,
        },
    )
    session.add(ControlCommit(**session.info["control_prepared"]))
    session.flush()


@event.listens_for(Session, "after_commit")
def confirm_control(session: Session) -> None:
    receipt = session.info.pop("control_prepared", None)
    if receipt:
        client = configured_client()
        if client is None:
            raise RuntimeError("Control configuration changed after commit")
        client.request(
            "POST",
            f"/operations/{receipt['operation_id']}/commit",
            {
                "manifest_hash": receipt["manifest_hash"],
                "receipt_hash": receipt["receipt_hash"],
            },
        )


@event.listens_for(Session, "after_rollback")
def preserve_ambiguous_preparation(session: Session) -> None:
    # A disconnect during COMMIT can be reported as rollback while the database
    # committed. Never send abort here. Independent pending evidence is retained.
    session.info.pop("control_prepared", None)
    session.info.pop("control_dirty", None)
