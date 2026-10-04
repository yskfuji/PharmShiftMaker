"""Real PostgreSQL row/trigger and retained-reference checks; synthetic records only."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    ComplianceRevision,
    LegalHold,
    ManagedCopy,
)
from shift_scheduler.domain.copies import DatabaseCopyReview
from shift_scheduler.domain.planning import Evidence, content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_planning_postgres import pg as _pg

pg = _pg
SCOPE = "hospital/pharmacy"
AT = datetime(2035, 1, 1, tzinfo=UTC)
EVIDENCE = Evidence(
    reference="synthetic independent review", status="verified", verified_by="officer"
)


def prepare(pg):
    with pg.begin() as session:
        privacy.save_rule(
            session,
            SCOPE,
            RetentionPolicy(
                category="compliance",
                purpose="test expiry",
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
            "admin",
        )
        session.add(
            ComplianceEntity(
                key="entity",
                scope_id=SCOPE,
                kind="test",
                entity_id="external",
                person_id="p0",
                revision=1,
                payload={"person_id": "p0", "text": "synthetic"},
                created_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )
        session.flush()
        session.add(
            ComplianceRevision(
                key="revision",
                entity_key="entity",
                revision=1,
                payload={"person_id": "p0"},
                actor="test",
                created_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )
    review(pg)


def review(pg):
    with pg.begin() as session:
        for row in session.scalars(
            select(ManagedCopy).where(ManagedCopy.category == "compliance")
        ):
            if (row.locator.get("table"), row.locator.get("pk", {}).get("key")) not in {
                ("compliance_entities", "entity"),
                ("compliance_revisions", "revision"),
            }:
                continue
            copies.review_database_copy(
                session,
                SCOPE,
                DatabaseCopyReview(
                    copy_id=row.copy_id,
                    content_hash=row.content_hash,
                    person_ids=("p0",),
                    evidence=EVIDENCE,
                ),
                row.revision,
                "officer",
                AT,
            )


def test_dependency_order_transaction_and_restore_reapplication(pg):
    prepare(pg)
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        assert len(plan["database_erasure_order"]) == 2
        first = session.get(ManagedCopy, plan["database_erasure_order"][0])
        assert first.locator["table"] == "compliance_revisions"
        result = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        assert len(result["erased_database_copy_ids"]) == 2
        assert not result["all_copies_complete"]
        assert session.get(ComplianceEntity, "entity") is None
    with pg.begin() as session:
        manifest = export_manifest(session, b"x" * 32)
        assert manifest["payload"]["version"] == 4
        quarantine(session)
        # A synthetic older restore has no later tombstones.
        for row in session.scalars(
            select(ManagedCopy).where(ManagedCopy.state == "ERASED")
        ):
            row.state = "PRESENT"
        session.flush()
        session.add(
            ComplianceEntity(
                key="entity",
                scope_id=SCOPE,
                kind="test",
                entity_id="external",
                person_id="p0",
                revision=1,
                payload={"person_id": "p0"},
                created_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )
        session.flush()
        session.add(
            ComplianceRevision(
                key="revision",
                entity_key="entity",
                revision=1,
                payload={"person_id": "p0"},
                actor="test",
                created_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )
    with pg.begin() as session:
        replay(session, manifest, content_hash(manifest), b"x" * 32)
        assert session.get(ComplianceEntity, "entity") is None
        assert session.get(ComplianceRevision, "revision") is None


def test_unreviewed_child_and_late_hold_prevent_deletion(pg):
    prepare(pg)
    with pg.begin() as session:
        child = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "compliance_revisions"
        )
        child.subject_status = "UNVERIFIED"
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        assert not plan["database_erasure_order"]
        assert any(
            "retained_database_references" in t["blockers"] for t in plan["targets"]
        )
    review(pg)
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
    with pg.begin() as session:
        session.add(
            LegalHold(
                hold_id="late",
                scope_id=SCOPE,
                person_id="p0",
                active=True,
                revision=1,
                payload={},
            )
        )
    with pytest.raises(Conflict), pg.begin() as session:
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    with pg() as session:
        assert session.get(ComplianceEntity, "entity") is not None


def test_transaction_rollback_restores_database_and_copy_state(pg):
    prepare(pg)
    with pg() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        session.rollback()
    with pg() as session:
        assert session.get(ComplianceEntity, "entity") is not None
        assert not list(
            session.scalars(select(ManagedCopy).where(ManagedCopy.state == "ERASED"))
        )


def test_erased_identity_cannot_be_recreated_by_raw_sql(pg):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    prepare(pg)
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    with (
        pytest.raises(IntegrityError, match="identity recreation"),
        pg.begin() as session,
    ):
        session.execute(
            text(
                "INSERT INTO compliance_entities(key,scope_id,kind,entity_id,person_id,revision,payload,created_at) VALUES ('entity','hospital/pharmacy','test','external','p0',1,'{}',now())"
            )
        )


def test_database_hash_uses_trigger_timezone_not_connection_timezone(pg):
    from sqlalchemy import text

    prepare(pg)
    with pg.begin() as session:
        session.execute(text("SET LOCAL TIME ZONE 'Asia/Tokyo'"))
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        outcome = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
        assert len(outcome["erased_database_copy_ids"]) == 2


def test_file_worker_and_late_hold_use_same_lock_order(pg, tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread, main_thread

    from sqlalchemy import text

    from shift_scheduler.application.planning import lock_facility
    from tests.test_managed_copies import prepare as prepare_file

    path = prepare_file(pg, tmp_path, monkeypatch)
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "admin", AT)
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "admin", AT
        )
    waiting = Event()
    original = copies.lock_facility

    def observed_lock(session, scope):
        if current_thread() is not main_thread():
            waiting.set()
        return original(session, scope)

    monkeypatch.setattr(copies, "lock_facility", observed_lock)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pg.begin() as session:
            lock_facility(session, SCOPE)
            running = pool.submit(copies.process_one, pg, AT)
            assert waiting.wait(5)
            session.execute(text("SET LOCAL lock_timeout = '2s'"))
            # Old worker order holds this row while waiting on this transaction's
            # facility lock. The new order permits the hold to linearize first.
            row = session.get(ManagedCopy, "copy1", with_for_update=True)
            assert row.state == "PENDING_ERASURE"
            session.add(
                LegalHold(
                    hold_id="concurrent",
                    scope_id=SCOPE,
                    person_id="p0",
                    active=True,
                    revision=1,
                    payload={"reason": "synthetic"},
                )
            )
        assert running.result(timeout=10)
    assert path.exists()
