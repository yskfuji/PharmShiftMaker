"""Independent stable-person barriers plus shared-file sequence, real PostgreSQL.

Control network is a bounded fake; the actual database identity trigger remains
installed. A failure is a product counterexample, never an expected pass.
"""

from types import SimpleNamespace

import pytest

from shift_scheduler.application import copies
from shift_scheduler.application import subject_controls as controls
from shift_scheduler.control import transaction
from shift_scheduler.db.compliance_models import LegalHold, PrivacyCase, RetentionRule
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_snapshot_file import prepare
from tests.test_subject_controls_postgres import setup


def configured(pg, monkeypatch):
    setup(pg)
    with pg.begin() as s:
        for person in ("p0", "p1"):
            s.add(
                PrivacyCase(
                    case_id="erase-" + person,
                    scope_id=SCOPE,
                    person_id=person,
                    kind="erase",
                    status="APPROVED",
                    revision=3,
                    payload={"reason": "synthetic reviewed request"},
                )
            )
        row = s.get(RetentionRule, "policy")
        row.payload = RetentionPolicy(
            category="control",
            purpose="synthetic recreation prevention",
            anchor="case_closed",
            retention_days=3650,
            legal_minimum_days=0,
            effective_from="2030-01-01",
            effective_until="2040-01-01",
            evidence=EVIDENCE,
            owner="officer",
            next_review="2036-01-01",
        ).model_dump(mode="json")
    fake = SimpleNamespace(
        client_id="sequence",
        require_access=lambda: {"generation": 1},
        request=lambda *a: {},
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)


def control(s, person):
    return controls.apply(
        s,
        SCOPE,
        person,
        issuer="test",
        subject="admin",
        case_id="erase-" + person,
        case_revision=3,
        expected_revision=0,
        idempotency_key="apply-person-" + person,
        reason="reviewed request",
        at=AT,
    )


def execute(pg, person, key):
    with pg.begin() as s:
        plan = controls.plan_eligible(
            s,
            SCOPE,
            person,
            issuer="test",
            subject="admin",
            expected_revision=1,
            idempotency_key=key + "-plan",
            at=AT,
        )
    with pg.begin() as s:
        return controls.execute_eligible(
            s,
            SCOPE,
            person,
            issuer="test",
            subject="admin",
            expected_revision=1,
            idempotency_key=key + "-execute",
            plan_id=plan["plan_id"],
            plan_revision=plan["revision"],
            fingerprint=plan["fingerprint"],
            at=AT,
        )


@pytest.mark.parametrize("first,second", [("p0", "p1"), ("p1", "p0")])
def test_both_stable_person_controls_allow_sequential_reviewed_erasure(
    pg, tmp_path, monkeypatch, first, second
):
    configured(pg, monkeypatch)
    identity, _ = prepare(pg, tmp_path, monkeypatch, first)
    with pg.begin() as s:
        control(s, first)
    one = execute(pg, first, "first")
    assert one["preserved_archive_count"] == 1
    assert copies.process_one(pg, AT)
    with pg.begin() as s:
        control(s, second)
    two = execute(pg, second, "second")
    assert two["erased_database_count"] >= 1


def test_other_subject_hold_then_second_control_does_not_recreate_erased_first(
    pg, tmp_path, monkeypatch
):
    from shift_scheduler.application.shared_projection import proposal
    from shift_scheduler.db.compliance_models import ManagedCopy

    configured(pg, monkeypatch)
    identity, _ = prepare(pg, tmp_path, monkeypatch, "p0")
    with pg.begin() as s:
        s.add(
            LegalHold(
                hold_id="p1-hold",
                scope_id=SCOPE,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
        control(s, "p0")
    first = execute(pg, "p0", "held-first")
    assert first["queued_count"] == 0 and (tmp_path / identity).exists()
    with pg.begin() as s:
        hold = s.get(LegalHold, "p1-hold")
        hold.active = False
        hold.revision += 1
        control(s, "p1")
    # Historical success expectation is preserved in the audit. A single-person
    # review cannot authorize deletion of the already-controlled other person.
    # The new explicit unanimous-review workflow is tested separately.
    from sqlalchemy import select

    from shift_scheduler.db.compliance_models import PreservedArchive

    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        with pytest.raises(ValueError, match="joint_review_required"):
            proposal(s, row, "p1")
        assert not list(s.scalars(select(PreservedArchive)))
        inventory = copies.inventory(s, SCOPE, "p1", AT)
        target = next(t for t in inventory["targets"] if t["copy_id"] == identity)
        assert "joint_review_required" in target["blockers"]
    assert (tmp_path / identity).exists()
