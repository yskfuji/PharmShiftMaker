from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from shift_scheduler.application import planning, privacy
from shift_scheduler.db.compliance_models import ErasureMarker, LegalHold, RestoreGate
from shift_scheduler.db.planning_models import PlanningInput
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_reviewed_planning import db as _db
from tests.test_reviewed_planning import snapshot

db = _db
SCOPE = "hospital/pharmacy"
AT = datetime(2035, 1, 1, tzinfo=UTC)


def prepare(session):
    data = snapshot(1, 1)
    planning.register_input(session, data, "admin", 0)
    # A newer explicit immutable version releases the old input head.
    newer = data.model_copy(update={"source_revision": 1})
    planning.register_input(session, newer, "admin", 1)
    rule = RetentionPolicy(
        category="planning_history",
        purpose="closed schedule",
        anchor="period_end",
        retention_days=365 * 5,
        legal_minimum_days=365 * 3,
        effective_from="2030-01-01",
        effective_until="2040-01-01",
        evidence=data.policy_evidence,
        owner="records-officer",
        next_review="2036-01-01",
    )
    privacy.save_rule(session, SCOPE, rule, 0, "admin")
    session.flush()
    return data


def test_unverified_current_and_late_hold_cannot_erase(db):
    with db.begin() as session:
        data = prepare(session)
        plan = privacy.preview(session, SCOPE, data.input_hash, "admin", AT)
        assert not plan.payload["blockers"]
        session.add(
            LegalHold(
                hold_id="hold",
                scope_id=SCOPE,
                active=True,
                revision=1,
                payload={"reason": "litigation"},
            )
        )
        session.flush()
        with pytest.raises(planning.Conflict):
            privacy.execute(session, SCOPE, plan.plan_id, plan.fingerprint, "admin", AT)
        assert session.get(PlanningInput, data.input_hash)


def test_erasure_receipt_preserves_hash_and_replay_does_not_resurrect(db):
    with db.begin() as session:
        data = prepare(session)
        old = session.get(PlanningInput, data.input_hash)
        backup = {c.name: getattr(old, c.name) for c in old.__table__.columns}
        plan = privacy.preview(session, SCOPE, data.input_hash, "admin", AT)
        result = privacy.execute(
            session, SCOPE, plan.plan_id, plan.fingerprint, "admin", AT
        )
        assert result["deleted"] >= 1
        assert session.get(PlanningInput, data.input_hash) is None
        assert privacy.execute(
            session, SCOPE, plan.plan_id, plan.fingerprint, "admin", AT
        )["duplicate"]
        manifest = export_manifest(session, b"x" * 32)
    with db.begin() as session:
        session.add(PlanningInput(**backup))
        quarantine(session)
    with db.begin() as session:
        with pytest.raises(ValueError):
            replay(session, manifest, "incorrect", b"x" * 32)
        assert session.get(RestoreGate, "restore").state == "QUARANTINED"
    with db.begin() as session:
        assert (
            replay(session, manifest, content_hash(manifest), b"x" * 32)["removed"] == 1
        )
        assert session.get(PlanningInput, data.input_hash) is None
        assert session.scalar(select(ErasureMarker)) is not None


def test_missing_rule_blocks_without_guessing(db):
    with db.begin() as session:
        data = snapshot()
        planning.register_input(session, data, "admin", 0)
        result = privacy.preview(session, SCOPE, data.input_hash, "admin", AT)
        assert len(result.payload["blockers"]) >= 2


def test_legacy_bundle_does_not_erase_prose_matching_input_identity(db):
    from shift_scheduler.db.planning_models import PlanningOutbox

    with db.begin() as session:
        data = prepare(session)
        session.add(
            PlanningOutbox(
                event_id="unrelated",
                scope_id=SCOPE,
                kind="privacy.request",
                actor="admin",
                payload={"person_id": "other", "reason": data.input_hash},
            )
        )
        session.flush()
        plan = privacy.preview(session, SCOPE, data.input_hash, "admin", AT)
        assert not any(t["key"] == "unrelated" for t in plan.payload["targets"])
        privacy.execute(session, SCOPE, plan.plan_id, plan.fingerprint, "admin", AT)
        assert session.get(PlanningOutbox, "unrelated") is not None


def test_other_department_hold_protects_same_person_in_legacy_erasure(db):
    with db.begin() as session:
        data = prepare(session)
        session.add(
            LegalHold(
                hold_id="transferred-person",
                scope_id="hospital/other",
                person_id="p0",
                active=True,
                revision=1,
                payload={"reason": "case preservation"},
            )
        )
        session.flush()
        plan = privacy.preview(session, SCOPE, data.input_hash, "admin", AT)
        assert any("保全" in b for b in plan.payload["blockers"])
        with pytest.raises(planning.Conflict):
            privacy.execute(session, SCOPE, plan.plan_id, plan.fingerprint, "admin", AT)
