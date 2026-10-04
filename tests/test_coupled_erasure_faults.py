"""Real PG/file composition. Fault injection is bounded, not full-system proof."""

import errno
from datetime import timedelta

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.db.compliance_models import (
    CopyErasure,
    ManagedCopy,
    PreservedArchive,
    RestoreGate,
)
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops import managed_erasure
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_projection import prepare


@pytest.mark.parametrize("failure", ["disk_full", "response_lost"])
def test_shared_database_then_file_failure_retry_and_restore(
    pg, tmp_path, monkeypatch, failure
):
    data, _, source = prepare(pg)
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path))
    path = tmp_path / "synthetic-export.txt"
    path.write_text("synthetic p0 export")
    with pg.begin() as session:
        privacy.save_rule(
            session,
            SCOPE,
            RetentionPolicy(
                category="exports",
                purpose="isolated coupled test",
                anchor="last_activity",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=EVIDENCE,
                owner="test",
                next_review="2036-01-01",
            ),
            0,
            "test",
        )
        copies.register(
            session,
            SCOPE,
            CopyRegistration(
                copy_id="coupled-file",
                category="exports",
                medium="file",
                relative_path=path.name,
                content_hash=copies.file_digest(path),
                person_ids=("p0",),
                anchor="last_activity",
                anchor_at="2020-01-01T00:00:00Z",
                evidence=EVIDENCE,
                subject_status="VERIFIED",
            ),
            0,
            "test",
        )
        plan = copies.preview(session, SCOPE, "p0", "test", AT)
        result = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
        )
        assert len(result["preserved_archive_ids"]) == 2
        assert result["queued_copy_ids"] == ["coupled-file"]
    assert path.exists()  # DB deletion committed, file intent is still pending.
    erase = managed_erasure.erase_verified
    if failure == "disk_full":

        def full(*args):
            raise OSError(errno.ENOSPC, "isolated injected storage failure")

        monkeypatch.setattr(managed_erasure, "erase_verified", full)
        assert copies.process_one(pg, AT)
        with pg() as session:
            assert session.get(ManagedCopy, "coupled-file").state == "RETRY_WAIT"
            assert session.get(CopyErasure, plan["plan_id"]).state == "RETRY_WAIT"
        assert path.exists()
        assert not copies.process_one(pg, AT)  # no busy retry loop
        monkeypatch.setattr(managed_erasure, "erase_verified", erase)
    else:
        # A committed intent permits acknowledging unlink after a lost response.
        erase(tmp_path, path.name, "coupled-file", copies.file_digest(path))
    assert copies.process_one(pg, AT + timedelta(seconds=10))
    assert not path.exists()
    assert not copies.process_one(pg, AT + timedelta(seconds=20))
    with pg.begin() as session:
        assert session.get(ManagedCopy, "coupled-file").state == "ERASED"
        archives = list(session.scalars(select(PreservedArchive)))
        assert len(archives) == 2
        for row in archives:
            assert [p["person_id"] for p in row.payload["retained"]["people"]] == ["p1"]
        manifest = export_manifest(session, b"x" * 32)
    with pg.begin() as session:
        quarantine(session)
    # Application history is retained exactly through replay; this is not a pg_restore trial.
    with pg.begin() as session:
        replay(session, manifest, content_hash(manifest), b"x" * 32)
    with pg() as session:
        assert session.get(RestoreGate, "restore").state == "REPLAYED"
        assert len(list(session.scalars(select(PreservedArchive)))) == 2
