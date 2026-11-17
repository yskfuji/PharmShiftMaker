"""Producer-backed PostgreSQL/file reconciliation; no inferred ownership flags."""

import errno
import hashlib
import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.application.planning import Conflict
from shift_scheduler.application.storage_reconciliation import file_observation
from shift_scheduler.db.compliance_models import CopySubject, LegalHold, ManagedCopy
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops import managed_writer as writer
from shift_scheduler.ops.archive import create_managed_archive, restore_archive
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE


def source(factory, root, monkeypatch, content=b"person p0", people=("p0",)):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    identity = uuid4().hex
    item = CopyRegistration(
        copy_id=identity,
        relative_path=identity,
        medium="file",
        category="exports",
        content_hash=hashlib.sha256(content).hexdigest(),
        person_ids=people,
        anchor="last_activity",
        anchor_at="2020-01-01T00:00:00Z",
        evidence=EVIDENCE,
        subject_status="VERIFIED",
    )
    writer.reserve(factory, SCOPE, item, "schedule.json", "a" * 64)
    writer.publish_bytes(factory, SCOPE, identity, content)
    return identity, item.content_hash


def test_real_backup_producer_and_retry_preserve_source_provenance(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    identity, digest = source(pg, root, monkeypatch)
    backup = uuid4().hex
    path = create_managed_archive(pg, SCOPE, {identity: digest}, backup)
    first_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    assert create_managed_archive(pg, SCOPE, {identity: digest}, backup) == path
    assert hashlib.sha256(path.read_bytes()).hexdigest() == first_hash
    with pg() as session:
        row = session.get(ManagedCopy, backup)
        assert row.medium == "backup" and row.state == "PRESENT"
        assert row.subject_status == "UNVERIFIED"  # Provenance is not a review.
        assert row.locator["source_copies"] == {identity: digest}
        assert set(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == backup)
            )
        ) == {"p0"}
        assert file_observation(session, SCOPE)["complete"]
    restored = tmp_path / "isolated-restore"
    restored_identity = restore_archive(
        path,
        restored,
        expected={"archive_id": backup, "kind": "managed", "scope": SCOPE},
    )
    assert restored_identity["operation_id"] == backup
    assert (restored / "copies" / identity).read_bytes() == b"person p0"
    manifest = json.loads((restored / "manifest.json").read_text())
    assert manifest["sources"] == {identity: digest}
    # Exact source identity/content must be checked even for a completed retry.
    (root / identity).write_bytes(b"changed")
    with pytest.raises(Conflict, match="source bytes changed"):
        create_managed_archive(pg, SCOPE, {identity: digest}, backup)


def test_registered_capture_enospc_resume_and_lost_publication_ack(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    identity, digest = source(pg, root, monkeypatch)
    output = uuid4().hex
    writer.reserve_capture(pg, SCOPE, output, "replica", {identity: digest})

    def full(stream):
        with pg() as session:
            assert session.get(ManagedCopy, output).state == "CAPTURING"
        stream.write(b"partial")
        raise OSError(errno.ENOSPC, "synthetic dedicated producer capacity")

    with pytest.raises(OSError):
        writer.capture(pg, SCOPE, output, full)
    assert not (root / output).exists()
    with pg() as session:
        assert session.get(ManagedCopy, output).state == "CAPTURE_RETRY"
        assert not file_observation(session, SCOPE)["complete"]
    real_fsync = writer.os.fsync
    calls = 0

    def lose_ack(fd):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("lost durable directory ACK")
        return real_fsync(fd)

    monkeypatch.setattr(writer.os, "fsync", lose_ack)
    with pytest.raises(OSError):
        writer.capture(pg, SCOPE, output, lambda stream: stream.write(b"complete"))
    assert (root / output).read_bytes() == b"complete"
    with pg() as session:
        assert session.get(ManagedCopy, output).state == "CAPTURE_READY"
    monkeypatch.setattr(writer.os, "fsync", real_fsync)

    def must_not_repeat(stream):
        raise AssertionError("committed after-image must be reused")

    assert (
        writer.capture(pg, SCOPE, output, must_not_repeat).read_bytes() == b"complete"
    )
    with pg() as session:
        assert file_observation(session, SCOPE)["complete"]


def test_capture_source_erasure_during_generation_never_publishes(
    pg, tmp_path, monkeypatch
):
    from shift_scheduler.db.compliance_models import ErasedSubject

    root = tmp_path / "managed"
    root.mkdir()
    identity, digest = source(pg, root, monkeypatch)
    output = uuid4().hex
    writer.reserve_capture(pg, SCOPE, output, "replica", {identity: digest})

    def erase_during(stream):
        stream.write(b"sensitive residual")
        with pg.begin() as session:
            session.add(
                ErasedSubject(
                    facility_id="hospital",
                    person_id="p0",
                    plan_id="synthetic",
                    evidence={},
                )
            )

    with pytest.raises(Conflict, match="Erasure prevents"):
        writer.capture(pg, SCOPE, output, erase_during)
    assert not (root / output).exists()
    assert (
        root / (".pending-" + output)
    ).exists()  # Attributable residual, never hidden.
    with pg() as session:
        assert not file_observation(session, SCOPE)["complete"]


def external(factory, people=("p0",)):
    with factory.begin() as session:
        privacy.save_rule(
            session,
            SCOPE,
            RetentionPolicy(
                category="exports",
                purpose="synthetic expired export",
                anchor="last_activity",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=EVIDENCE,
                owner="officer",
                next_review="2036-01-01",
            ),
            0,
            "officer",
        )
        copies.register(
            session,
            SCOPE,
            CopyRegistration(
                copy_id="external",
                relative_path="custodian/receipt",
                medium="external",
                category="exports",
                content_hash="b" * 64,
                person_ids=people,
                anchor="last_activity",
                anchor_at="2020-01-01T00:00:00Z",
                evidence=EVIDENCE,
                subject_status="VERIFIED",
            ),
            0,
            "officer",
        )


def test_external_confirmation_records_evidence_without_claiming_physical_erasure(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    external(pg)
    with pg.begin() as session:
        result = copies.confirm_external(
            session, SCOPE, "external", 1, EVIDENCE, "officer", AT
        )
        assert result["state"] == "EXTERNAL_CONFIRMED"
        assert not result["confirmation"]["local_physical_erasure_verified"]
        assert result["confirmation"]["content_hash"] == "b" * 64
        assert not result["all_copies_complete"]
    with pg.begin() as session, pytest.raises(Conflict):
        copies.confirm_external(session, SCOPE, "external", 1, EVIDENCE, "officer", AT)
    with pg() as session:
        target = next(
            t
            for t in copies.inventory(session, SCOPE, "p0", AT)["targets"]
            if t["copy_id"] == "external"
        )
        assert target["state"] == "EXTERNAL_CONFIRMED"
        assert "external_confirmation_recorded" in target["blockers"]


def test_external_confirmation_rechecks_other_subject_hold_and_retention(pg):
    external(pg, ("p0", "p1"))
    with pg.begin() as session:
        session.add(
            LegalHold(
                hold_id="hold",
                scope_id=SCOPE,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
    with pg.begin() as session:
        with pytest.raises(Conflict, match="active legal hold"):
            copies.confirm_external(
                session, SCOPE, "external", 1, EVIDENCE, "officer", AT
            )
        assert session.get(ManagedCopy, "external").state == "PRESENT"
    with pg.begin() as session:
        session.get(LegalHold, "hold").active = False
        session.get(ManagedCopy, "external").anchor_at = AT
    with pg.begin() as session, pytest.raises(Conflict, match="not expired"):
        copies.confirm_external(session, SCOPE, "external", 1, EVIDENCE, "officer", AT)


def test_attendance_producer_registered_and_mapping_reuse_rejected(
    pg, tmp_path, monkeypatch
):
    from shift_scheduler.ops.attendance_adapter import (
        convert_managed_schedule_to_attendance,
    )
    from tests.test_attendance_adapter import write_mapping

    root = tmp_path / "managed"
    root.mkdir()
    mapping = write_mapping(tmp_path)
    raw = json.dumps(
        {
            "assignments": [
                {
                    "person_id": "sato",
                    "shift_id": "DAY",
                    "assignment_date": "2025-02-01",
                }
            ]
        }
    ).encode()
    identity, digest = source(pg, root, monkeypatch, raw, ("sato",))
    output = uuid4().hex
    path = convert_managed_schedule_to_attendance(
        pg, SCOPE, identity, digest, mapping, output
    )
    assert "EMP-001" in path.read_text()
    with pg() as session:
        row = session.get(ManagedCopy, output)
        assert row.locator["route"] == "attendance.csv"
        assert (
            row.evidence["mapping_hash"]
            == hashlib.sha256(mapping.read_bytes()).hexdigest()
        )
        assert file_observation(session, SCOPE)["complete"]
    mapping.write_text(mapping.read_text().replace("EMP-001", "EMP-999"))
    with pytest.raises(Conflict, match="mapping changed"):
        convert_managed_schedule_to_attendance(
            pg, SCOPE, identity, digest, mapping, output
        )
    assert "EMP-001" in path.read_text() and "EMP-999" not in path.read_text()


def test_backup_compatibility_cli_routes_registered_sources_through_real_producer(
    pg, tmp_path, monkeypatch
):
    from argparse import Namespace

    from scripts.backup_artifacts import create_backup

    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    root = tmp_path / "managed"
    root.mkdir()
    identity, digest = source(pg, root, monkeypatch)
    output = uuid4().hex
    result = create_backup(
        Namespace(
            managed_source_copy=[identity + "=" + digest],
            operation_id=output,
            scope_id=SCOPE,
            dry_run=False,
        )
    )
    assert result == root / output
    with pg() as session:
        assert session.get(ManagedCopy, output).state == "PRESENT"
        assert file_observation(session, SCOPE)["complete"]
