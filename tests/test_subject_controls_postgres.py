"""Real PostgreSQL authorization/CAS/hold tests; service transport is a bounded fake."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from shift_scheduler.application import subject_controls as controls
from shift_scheduler.application.planning import Conflict
from shift_scheduler.control import transaction
from shift_scheduler.db.compliance_models import (
    ErasedSubject,
    LegalHold,
    PrivacyCase,
    RetentionRule,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningReceipt
from shift_scheduler.ops.managed_writer import allowed_subjects

SCOPE = "hospital/pharmacy"
NOW = datetime(2026, 9, 23, tzinfo=UTC)


def setup(pg):
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="admin",
                issuer="test",
                subject="admin",
                person_id="admin-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        s.add(
            PrivacyCase(
                case_id="case",
                scope_id=SCOPE,
                person_id="p1",
                kind="erase",
                status="APPROVED",
                revision=3,
                payload={"reason": "reviewed request"},
            )
        )
        s.add(
            RetentionRule(
                key="policy",
                scope_id=SCOPE,
                category="control",
                revision=1,
                payload={
                    "category": "control",
                    "purpose": "prevent recreation",
                    "anchor": "case_closed",
                    "retention_days": 365,
                    "legal_minimum_days": 0,
                    "effective_from": "2026-01-01",
                    "effective_until": "2027-01-01",
                    "evidence": {
                        "reference": "synthetic approval",
                        "status": "verified",
                        "verified_by": "officer",
                    },
                    "owner": "officer",
                    "next_review": "2026-12-31",
                },
            )
        )


def call(s, **kw):
    args = {
        "issuer": "test",
        "subject": "admin",
        "case_id": "case",
        "case_revision": 3,
        "expected_revision": 0,
        "idempotency_key": "subject-request-1",
        "reason": "approved erasure",
        "at": NOW,
    }
    args.update(kw)
    return controls.apply(s, SCOPE, "p1", **args)


def test_authority_hold_revision_and_unconfigured_service_fail_closed(pg, monkeypatch):
    setup(pg)
    monkeypatch.setattr(controls, "configured_client", lambda: None)
    with pg.begin() as s:
        with pytest.raises(PermissionError):
            call(s, issuer="other-issuer")
        with pytest.raises(Conflict):
            call(s, case_revision=2)
        with pytest.raises(RuntimeError, match="Independent"):
            call(s)
        s.add(
            LegalHold(
                hold_id="h",
                scope_id="hospital/other",
                person_id="p1",
                active=True,
                revision=1,
                payload={"reason": "preserve"},
            )
        )
        s.flush()
        with pytest.raises(Conflict, match="hold"):
            call(s)
        assert s.get(ErasedSubject, ("hospital", "p1")) is None
        assert not list(s.scalars(select(PlanningReceipt)))


def test_stable_person_guard_retries_and_no_physical_erasure_claim(pg, monkeypatch):
    setup(pg)
    staged = []
    client = SimpleNamespace(
        client_id="test-source",
        require_access=lambda: {"generation": 1},
        request=lambda *args: staged.append(args),
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(controls, "configured_client", lambda: client)
    monkeypatch.setattr(transaction, "configured_client", lambda: client)
    with pg.begin() as s:
        first = call(s)
        s.flush()
        assert call(s) == first
        with pytest.raises(Conflict, match="changed request"):
            call(s, reason="changed")
        assert first["all_copies_erased"] is False
        assert first["state"] == "CONTROL_APPLIED_REMAINS"
        # The guard is person based, irrespective of a newly chosen copy ID.
        with pytest.raises(Conflict):
            allowed_subjects(s, "hospital/other", ["p1"])
        allowed_subjects(s, SCOPE, ["p2"])
    assert len(staged) == 2
    assert staged[0][1] == "/operations/prepare"
    assert staged[1][1].endswith("/commit")
    with pg() as s:
        assert s.get(PrivacyCase, "case").status == "APPROVED"
        assert len(list(s.scalars(select(ErasedSubject)))) == 1


def test_configuration_disappearance_before_commit_rolls_back_control_and_receipt(
    pg, monkeypatch
):
    setup(pg)
    client = SimpleNamespace(require_access=lambda: {"generation": 1})
    monkeypatch.setattr(controls, "configured_client", lambda: client)
    monkeypatch.setattr(transaction, "configured_client", lambda: None)
    with pytest.raises(RuntimeError, match="configuration changed"):
        with pg.begin() as s:
            call(s)
    with pg() as s:
        assert s.get(ErasedSubject, ("hospital", "p1")) is None
        assert not list(s.scalars(select(PlanningReceipt)))
