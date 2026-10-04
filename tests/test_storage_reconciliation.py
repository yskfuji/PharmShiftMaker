"""Live comparisons, independent mutations and safe negative controls."""

import hashlib
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select, text

from shift_scheduler.application.copy_coverage import coverage
from shift_scheduler.application.storage_reconciliation import (
    database_observation,
    file_observation,
    reconcile,
)
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy, PrivacyCase
from tests.test_planning_postgres import pg as _pg
from tests.test_reviewed_planning import db as _db

db, pg = _db, _pg
SCOPE = "hospital/pharmacy"


def managed(factory, root, identity="local", **kwargs):
    data = b"synthetic scoped data"
    (root / identity).write_bytes(data)
    with factory.begin() as session:
        session.add(
            ManagedCopy(
                copy_id=identity,
                scope_id=SCOPE,
                category="exports",
                medium="file",
                locator={"relative_path": identity},
                content_hash=hashlib.sha256(data).hexdigest(),
                revision=1,
                state="PRESENT",
                subject_status="VERIFIED",
                anchor="last_activity",
                anchor_at=datetime(2020, 1, 1, tzinfo=UTC),
                evidence={"reference": "synthetic only"},
                **kwargs,
            )
        )
        session.flush()
        session.add(CopySubject(copy_id=identity, person_id="p0"))


def test_real_files_unknown_tamper_reappearance_and_link_are_detected(
    db, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    managed(db, root)
    with db() as session:
        assert file_observation(session, SCOPE)["complete"]
        before = reconcile(session, SCOPE)
    (root / "unknown").write_text("unregistered")
    (root / "local").write_text("tampered")
    (root / "link").symlink_to(tmp_path / "outside")
    with db() as session:
        after = reconcile(session, SCOPE, before)
        reasons = {i["reason"] for i in after["managed_files"]["issues"]}
        assert {
            "unregistered_file",
            "file_hash_mismatch",
            "symlink_in_managed_root",
        } <= reasons
        assert after["delta"]["managed_files"] == {
            "added": ["unknown"],
            "removed": [],
            "changed": ["local"],
        }
        assert not after["subject_erasure_complete"]
    with db.begin() as session:
        session.get(ManagedCopy, "local").state = "ERASED"
    with db() as session:
        assert "erased_file_reappeared" in {
            i["reason"] for i in file_observation(session, SCOPE)["issues"]
        }


def test_reconciliation_observation_cannot_be_replaced_by_claim_or_other_scope(
    db, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with db() as session:
        before = reconcile(session, SCOPE)
        before["subject_erasure_complete"] = True
        before["database"]["complete"] = True
        result = reconcile(session, SCOPE, before)
        assert (
            not result["subject_erasure_complete"]
            and not result["database"]["complete"]
        )
        assert "wal_and_physical_media" in result["unobserved_domains"]
        with pytest.raises(ValueError, match="same scope"):
            reconcile(session, "other/department", before)
        live = coverage(session, SCOPE)
        assert (
            live["runtime_observed"]
            and "managed_file_reconciliation_incomplete"
            not in live["unverified_storage_paths"]
        )
        assert "database_reconciliation_incomplete" in live["unverified_storage_paths"]
        assert not live["all_storage_complete"]
        assert not coverage()["runtime_observed"]


def test_read_only_database_observer_detects_unregistered_row_and_delta(
    db, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with db() as session:
        before = reconcile(session, SCOPE)
    with db.begin() as session:
        session.add(
            PrivacyCase(
                case_id="case",
                scope_id=SCOPE,
                person_id="p0",
                kind="access",
                payload={},
            )
        )
    with db() as session:
        result = reconcile(session, SCOPE, before)
        assert len(result["delta"]["database"]["added"]) == 1
        assert "missing_registration" in {
            i["reason"] for i in result["database"]["issues"]
        }
        assert not list(
            session.scalars(select(ManagedCopy))
        )  # Observation did not repair/certify.


def test_real_postgresql_hash_and_independent_subject_link_reconciliation(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with pg.begin() as session:
        session.add(
            PrivacyCase(
                case_id="case",
                scope_id=SCOPE,
                person_id="p0",
                kind="access",
                payload={},
            )
        )
    with pg.begin() as session:
        row = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "privacy_cases"
        )
        identity = row.copy_id
        row.subject_status = "VERIFIED"
        row.evidence = {
            "reference": "synthetic exact-hash review",
            "status": "verified",
            "verified_by": "test-officer",
            "reviewed_content_hash": row.content_hash,
        }
    with pg() as session:
        baseline = reconcile(session, SCOPE)
        assert (
            baseline["database"]["complete"]
            and baseline["live_registered_stores_reconciled"]
        )
        assert not baseline["subject_erasure_complete"]
        assert not coverage(session, SCOPE)["all_storage_complete"]
    with pg.begin() as session:
        session.execute(delete(CopySubject).where(CopySubject.copy_id == identity))
        session.get(ManagedCopy, identity).content_hash = "0" * 64
    with pg() as session:
        result = database_observation(session, SCOPE)
        assert {"missing_subject_reference", "database_hash_mismatch"} <= {
            i["reason"] for i in result["issues"]
        }
    with pg.begin() as session:
        session.execute(delete(ManagedCopy).where(ManagedCopy.copy_id == identity))
    with pg() as session:
        assert "missing_registration" in {
            i["reason"] for i in database_observation(session, SCOPE)["issues"]
        }


def test_real_postgresql_disabled_trigger_and_new_table_fail_closed(
    pg, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with pg.begin() as session:
        session.execute(
            text("ALTER TABLE privacy_cases DISABLE TRIGGER pharmshift_copy_write")
        )
        session.execute(
            text(
                "CREATE TABLE unregistered_attachment (id text PRIMARY KEY, body text)"
            )
        )
        report = database_observation(session, SCOPE)
        assert {
            "registration_trigger_missing_or_disabled",
            "unmapped_database_table",
        } <= {i["reason"] for i in report["issues"]}


def test_observer_does_not_follow_parent_symlink(tmp_path):
    from shift_scheduler.application.storage_reconciliation import _safe_file_hash

    root = tmp_path / "managed"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "private").write_bytes(b"not an application copy")
    (root / "parent").symlink_to(outside, target_is_directory=True)
    with pytest.raises(OSError):
        _safe_file_hash(root, "parent/private")


def test_postgresql_observation_restores_callers_timezone(pg):
    with pg.begin() as session:
        session.execute(text("SET LOCAL TIME ZONE 'Asia/Tokyo'"))
        report = database_observation(session, SCOPE)
        assert report["complete"]
        assert session.scalar(text("SHOW TIME ZONE")) == "Asia/Tokyo"
