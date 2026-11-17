import hashlib
from datetime import UTC, datetime

import pytest

from shift_scheduler.application import copies, planning, privacy
from shift_scheduler.db.compliance_models import LegalHold, ManagedCopy
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_reviewed_planning import db as _db
from tests.test_reviewed_planning import snapshot

db = _db
SCOPE = "hospital/pharmacy"
AT = datetime(2035, 1, 1, tzinfo=UTC)


def prepare(db, tmp_path, monkeypatch, *, medium="file", anchor="2020-01-01T00:00:00Z"):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path))
    path = tmp_path / "record.txt"
    path.write_text("synthetic-person-only")
    data = snapshot(1, 1)
    with db.begin() as session:
        planning.register_input(session, data, "admin", 0)
        privacy.save_rule(
            session,
            SCOPE,
            RetentionPolicy(
                category="backups" if medium == "backup" else "exports",
                purpose="isolated proof",
                anchor="backup_created" if medium == "backup" else "last_activity",
                retention_days=3650,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=data.policy_evidence,
                owner="admin",
                next_review="2036-01-01",
            ),
            0,
            "admin",
        )
        item = CopyRegistration(
            copy_id="copy1",
            category="backups" if medium == "backup" else "exports",
            medium=medium,
            relative_path=path.name,
            content_hash=hashlib.sha256(path.read_bytes()).hexdigest(),
            person_ids=("p0",),
            anchor="backup_created" if medium == "backup" else "last_activity",
            anchor_at=anchor,
            evidence=data.policy_evidence,
            subject_status="VERIFIED",
        )
        copies.register(session, SCOPE, item, 0, "admin")
    return path


def test_committed_queue_before_unlink_and_restart_ack(db, tmp_path, monkeypatch):
    path = prepare(db, tmp_path, monkeypatch)
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        result = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        assert result["state"] == "QUEUED"
        assert path.exists()  # API does not unlink before transaction commit.
    # Crash after approved unlink, before acknowledgement.
    path.unlink()
    assert copies.process_one(db, AT)
    with db() as session:
        assert session.get(ManagedCopy, "copy1").state == "ERASED"
    assert not copies.process_one(db, AT)


def test_rollback_cannot_delete_file(db, tmp_path, monkeypatch):
    path = prepare(db, tmp_path, monkeypatch)
    with db() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        session.rollback()
    assert path.exists()
    assert not copies.process_one(db, AT)


def test_late_hold_stops_committed_intent(db, tmp_path, monkeypatch):
    path = prepare(db, tmp_path, monkeypatch)
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    with db.begin() as session:
        session.add(
            LegalHold(
                hold_id="late",
                scope_id=SCOPE,
                person_id="p0",
                active=True,
                revision=1,
                payload={"reason": "legal"},
            )
        )
    assert copies.process_one(db, AT)
    assert path.exists()


def test_backup_retained_until_expiry_is_not_full_erasure(db, tmp_path, monkeypatch):
    path = prepare(
        db, tmp_path, monkeypatch, medium="backup", anchor="2034-01-01T00:00:00Z"
    )
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        assert "retention_not_expired" in plan["targets"][0]["blockers"]
        result = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        assert not result["all_copies_complete"]
    assert path.exists()
    assert not copies.process_one(db, AT)


def test_changed_content_cannot_be_erased(db, tmp_path, monkeypatch):
    path = prepare(db, tmp_path, monkeypatch)
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    path.write_text("different protected content")
    assert copies.process_one(db, AT)
    assert path.exists()
    with db() as session:
        assert session.get(ManagedCopy, "copy1").state == "CHANGED"


def test_traversal_and_symlinks_are_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path))
    (tmp_path / "link").symlink_to("/tmp")
    for path in ["../outside", "/etc/passwd", "link/file", ".erasure/private"]:
        with pytest.raises(ValueError):
            copies.checked_file(path)


def test_signed_restore_manifest_reapplies_managed_file_erasure(
    db, tmp_path, monkeypatch
):
    from shift_scheduler.domain.planning import content_hash
    from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay

    path = prepare(db, tmp_path, monkeypatch)
    original = path.read_bytes()
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    copies.process_one(db, AT)
    with db.begin() as session:
        manifest = export_manifest(session, b"x" * 32)
        quarantine(session)
    path.write_bytes(original)  # simulate an older backup bringing the file back
    with db.begin() as session:
        result = replay(session, manifest, content_hash(manifest), b"x" * 32)
        assert result["state"] == "REPLAYED"
    assert not path.exists()


def test_restore_resumes_capture_before_opening_gate(db, tmp_path, monkeypatch):
    import os

    from shift_scheduler.domain.planning import content_hash
    from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay

    path = prepare(db, tmp_path, monkeypatch)
    original = path.read_bytes()
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    copies.process_one(db, AT)
    with db.begin() as session:
        manifest = export_manifest(session, b"x" * 32)
        quarantine(session)
    path.write_bytes(original)
    captured = tmp_path / ".erasure" / hashlib.sha256(b"copy1").hexdigest()
    os.rename(path, captured)  # process dies here; original pathname is absent
    with db.begin() as session:
        assert (
            replay(session, manifest, content_hash(manifest), b"x" * 32)["state"]
            == "REPLAYED"
        )
    assert not captured.exists()


def test_unverified_subject_evidence_and_anchor_mismatch_block_erasure(
    db, tmp_path, monkeypatch
):
    path = prepare(db, tmp_path, monkeypatch)
    with db.begin() as session:
        row = session.get(ManagedCopy, "copy1")
        row.evidence = {"reference": "unconfirmed", "status": "unverified"}
        row.anchor = "period_end"
    with db.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        assert "subject_inventory_unverified" in plan["targets"][0]["blockers"]
        assert "retention_anchor_mismatch" in plan["targets"][0]["blockers"]
        assert not copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )["queued_copy_ids"]
    assert path.exists()
