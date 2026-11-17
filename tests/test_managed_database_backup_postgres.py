"""Real native pg_dump stdout; only the owned UUID schema enters the artifact."""

import os
from uuid import uuid4

import pytest
from scripts.backup_pipeline import run_pg_dump

from shift_scheduler.application.planning import Conflict
from shift_scheduler.application.storage_reconciliation import file_observation
from shift_scheduler.db.compliance_models import ManagedCopy, PrivacyCase

SCOPE = "hospital/pharmacy"


def test_native_snapshot_dump_is_registered_before_bytes_and_retry_reuses_hash(
    pg, tmp_path, monkeypatch
):
    binary = os.getenv("PHARMSHIFT_TEST_PG_DUMP")
    if not binary:
        pytest.skip("Explicit owned pg_dump command required")
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with pg.begin() as session:
        session.add(
            PrivacyCase(
                case_id="synthetic",
                scope_id=SCOPE,
                person_id="p0",
                kind="access",
                payload={"request": "synthetic"},
            )
        )
    identity = uuid4().hex
    url = pg.kw["bind"].url.render_as_string(hide_password=False)
    path = run_pg_dump(
        url,
        tmp_path / "unused",
        "synthetic",
        binary,
        factory=pg,
        scope=SCOPE,
        operation_id=identity,
    )
    assert path == root / identity and path.read_bytes().startswith(b"PGDMP")
    assert not (tmp_path / "unused").exists()
    with pg() as session:
        row = session.get(ManagedCopy, identity)
        digest = row.content_hash
        assert row.state == "PRESENT" and row.medium == "backup"
        assert row.locator["route"] == "backup.database"
        snapshot = row.evidence["database_snapshot"]
        assert snapshot["schema"].startswith("audit_") and snapshot["snapshot_id"]
        assert snapshot["consistent_at"] and snapshot["wal_position"]
        assert not snapshot["file_consistency_proven"]
        assert file_observation(session, SCOPE)["complete"]
    # Committed native dump does not execute a new binary or change its digest.
    assert (
        run_pg_dump(
            url,
            tmp_path / "unused",
            "synthetic",
            "never-execute",
            factory=pg,
            scope=SCOPE,
            operation_id=identity,
        )
        == path
    )
    with pg() as session:
        assert session.get(ManagedCopy, identity).content_hash == digest


def test_native_backup_rejects_other_facility_and_prod_legacy_bypass_before_bytes(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with pg.begin() as session:
        session.add(
            PrivacyCase(
                case_id="foreign",
                scope_id="other/pharmacy",
                person_id="foreign",
                kind="access",
                payload={},
            )
        )
    url = pg.kw["bind"].url.render_as_string(hide_password=False)
    with pytest.raises(Conflict, match="another facility"):
        run_pg_dump(
            url,
            tmp_path / "unused",
            "synthetic",
            "never-execute",
            factory=pg,
            scope=SCOPE,
            operation_id=uuid4().hex,
        )
    assert not list(root.iterdir())
    from shift_scheduler.db.restore_lock import RestoreUnavailable

    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    monkeypatch.delenv("PHARMSHIFT_CONTROL_URL", raising=False)
    with pytest.raises(RestoreUnavailable):
        run_pg_dump(url, tmp_path / "unused", "synthetic", "never-execute", factory=pg)
    assert not (tmp_path / "unused").exists()
