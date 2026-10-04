"""Reconcile a source commit after a lost authority acknowledgement. No inferred abort."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import configured_client
from shift_scheduler.db.compliance_models import ControlCommit
from shift_scheduler.db.settings import DatabaseSettings
from shift_scheduler.domain.planning import content_hash


def reconcile(factory, client):
    status = client.request("GET", "/status")
    operation = status.get("pending_operation_id")
    if not operation:
        return {"pending": False}
    with factory() as session:
        row = session.get(ControlCommit, operation)
        if not row or row.source_id != client.client_id:
            raise ValueError(
                "No matching committed source receipt; keep blocked and investigate independently"
            )
        expected = content_hash(
            {
                "operation_id": row.operation_id,
                "source_id": row.source_id,
                "expected_generation": row.expected_generation,
                "manifest_hash": row.manifest_hash,
            }
        )
        if row.receipt_hash != expected:
            raise ValueError("Source receipt is corrupt; keep authority pending")
        return client.request(
            "POST",
            f"/operations/{operation}/commit",
            {"manifest_hash": row.manifest_hash, "receipt_hash": row.receipt_hash},
        )


if __name__ == "__main__":
    client = configured_client()
    if client is None:
        raise ValueError("Independent authority must be configured")
    # Deliberate, narrow maintenance path: reads only committed control receipts.
    # Use source credentials; never point this at a restored or copied database.
    engine = create_engine(DatabaseSettings.from_environment().url)
    try:
        print(reconcile(sessionmaker(engine), client))
    finally:
        engine.dispose()
