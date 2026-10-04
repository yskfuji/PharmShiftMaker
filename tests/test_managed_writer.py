import hashlib
from uuid import uuid4

import pytest

from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import ErasedSubject, ManagedCopy
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.ops import managed_writer as writer
from tests.test_database_erasure_postgres import EVIDENCE, SCOPE


def reservation(factory, root, monkeypatch, data=b"synthetic p0 export"):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    identity = uuid4().hex
    item = CopyRegistration(
        copy_id=identity,
        relative_path=identity,
        medium="file",
        category="exports",
        content_hash=hashlib.sha256(data).hexdigest(),
        person_ids=("p0",),
        anchor="last_activity",
        anchor_at="2026-01-01T00:00:00Z",
        evidence=EVIDENCE,
        subject_status="VERIFIED",
    )
    writer.reserve(factory, SCOPE, item, "schedule.csv", "a" * 64)
    return item


def test_file_lock_rejects_non_identifier_before_touching_storage(tmp_path):
    root = tmp_path / "managed"
    root.mkdir()
    with pytest.raises(ValueError, match="32-character alphanumeric"):
        with writer.file_lock(root, "../outside"):
            pytest.fail("invalid copy identifier acquired a lock")
    assert not list(root.iterdir())


def test_register_before_bytes_retry_identity_and_filesystem_reconciliation(
    sqlite_session_factory, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    item = reservation(sqlite_session_factory, root, monkeypatch)
    assert not list(root.iterdir())
    with pytest.raises(ValueError):
        writer.reserve(
            sqlite_session_factory, SCOPE, item, "schedule.csv", "not-hex-" * 8
        )
    with sqlite_session_factory() as s:
        assert s.get(ManagedCopy, item.copy_id).state == "RESERVED"
        assert not writer.reconcile_files(s)["complete"]
    data = b"synthetic p0 export"
    path = writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, data)
    assert path.read_bytes() == data
    assert (
        writer.reserve(sqlite_session_factory, SCOPE, item, "schedule.csv", "a" * 64)
        == item.copy_id
    )
    assert (
        writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, data) == path
    )
    with pytest.raises(Conflict):
        writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, b"different")
    with sqlite_session_factory() as s:
        assert writer.reconcile_files(s)["complete"]
    (root / "forgotten-export").write_bytes(b"synthetic stray")
    with sqlite_session_factory() as s:
        assert writer.reconcile_files(s)["issues"] == [
            {"path": "forgotten-export", "reason": "unregistered_or_link"}
        ]


def test_crash_after_publication_before_ack_and_suppression_during_write(
    sqlite_session_factory, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    item = reservation(sqlite_session_factory, root, monkeypatch)
    original = writer.os.fsync
    count = 0

    def fail_directory(fd):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("Injected directory ACK failure after publication")
        return original(fd)

    monkeypatch.setattr(writer.os, "fsync", fail_directory)
    with pytest.raises(OSError):
        writer.publish_bytes(
            sqlite_session_factory, SCOPE, item.copy_id, b"synthetic p0 export"
        )
    assert (root / item.copy_id).exists()
    with sqlite_session_factory() as s:
        assert s.get(ManagedCopy, item.copy_id).state == "WRITE_RETRY"
    monkeypatch.setattr(writer.os, "fsync", original)
    writer.publish_bytes(
        sqlite_session_factory, SCOPE, item.copy_id, b"synthetic p0 export"
    )
    with sqlite_session_factory.begin() as s:
        s.add(
            ErasedSubject(
                facility_id="hospital", person_id="p0", plan_id="synthetic", evidence={}
            )
        )
    with pytest.raises(Conflict):
        writer.publish_bytes(
            sqlite_session_factory, SCOPE, item.copy_id, b"synthetic p0 export"
        )


def test_changed_after_image_never_becomes_available(
    sqlite_session_factory, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    item = reservation(sqlite_session_factory, root, monkeypatch)
    (root / item.copy_id).write_bytes(b"tampered")
    with pytest.raises(Conflict):
        writer.publish_bytes(
            sqlite_session_factory, SCOPE, item.copy_id, b"synthetic p0 export"
        )
    with sqlite_session_factory() as s:
        assert s.get(ManagedCopy, item.copy_id).state == "WRITE_RETRY"
    with pytest.raises(ValueError):
        writer.publish_bytes(sqlite_session_factory, SCOPE, "../outside", b"synthetic")


def test_rename_before_staging_cleanup_and_erased_file_resurrection(
    sqlite_session_factory, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    data = b"synthetic p0 export"
    item = reservation(sqlite_session_factory, root, monkeypatch, data)
    (root / item.copy_id).write_bytes(data)
    (root / (".pending-" + item.copy_id)).write_bytes(data)
    with sqlite_session_factory() as s:
        assert any(
            i["reason"] == "staging_copy_remaining"
            for i in writer.reconcile_files(s)["issues"]
        )
    writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, data)
    assert not (root / (".pending-" + item.copy_id)).exists()
    with sqlite_session_factory.begin() as s:
        s.get(ManagedCopy, item.copy_id).state = "ERASED"
    with sqlite_session_factory() as s:
        assert writer.reconcile_files(s)["issues"] == [
            {"copy_id": item.copy_id, "reason": "erased_copy_reappeared"}
        ]
