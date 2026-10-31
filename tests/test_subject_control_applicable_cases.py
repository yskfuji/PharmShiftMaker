"""The person-control read lists exactly the decisions the control route accepts.

`applicable_cases` of GET /subject-controls/{person} is compared with what
POST /subject-controls/{person} really does for every kind and status of a
request, with and without a hold and a current rule for control records; not
with a table written here. Isolated PostgreSQL schema, synthetic data only.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.application import subject_controls as controls
from shift_scheduler.control import transaction
from shift_scheduler.db.compliance_models import LegalHold, PrivacyCase, RetentionRule
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_api import QUERY, token

SCOPE = "hospital/pharmacy"
KINDS = ["access", "rectify", "restrict", "erase"]
STATUSES = ["REQUESTED", "VERIFIED", "APPROVED", "COMPLETED", "RELEASED", "REJECTED"]
PREVIOUS_KEYS = {
    "person_id",
    "revision",
    "state",
    "all_copies_erased",
    "identity_boundary",
    "inventory",
}
PATH = "/planning/compliance/subject-controls/"


def person_of(kind, status):
    return f"person-{kind}-{status}"


def seed(factory, *, rule, hold):
    """One person per (kind, status), each with exactly that request."""
    with factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="admin-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        for kind in KINDS:
            for status in STATUSES:
                person = person_of(kind, status)
                s.add(
                    PrivacyCase(
                        case_id=f"{kind}-{status}",
                        scope_id=SCOPE,
                        person_id=person,
                        kind=kind,
                        status=status,
                        revision=3,
                        payload={"person_id": person, "kind": kind, "reason": "合成"},
                    )
                )
        if rule:
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
                        "effective_until": "2099-01-01",
                        "evidence": {
                            "reference": "synthetic approval",
                            "status": (
                                "verified" if rule == "verified" else "unverified"
                            ),
                            "verified_by": "officer" if rule == "verified" else None,
                        },
                        "owner": "officer",
                        "next_review": "2098-12-31",
                    },
                )
            )
        if hold:
            s.add(
                LegalHold(
                    hold_id="hold",
                    scope_id="hospital/other",
                    person_id=None if hold == "facility" else hold,
                    active=True,
                    revision=1,
                    payload={"reason": "preserve"},
                )
            )


@pytest.mark.parametrize(
    ("rule", "hold", "expected"),
    [
        ("verified", None, ["erase-APPROVED"]),
        ("verified", "person-access-APPROVED", ["erase-APPROVED"]),
        ("verified", "person-erase-APPROVED", []),
        ("verified", "facility", []),
        ("unverified", None, []),
        (None, None, []),
    ],
)
def test_applicable_cases_are_what_the_control_route_accepts(
    pg, monkeypatch, rule, hold, expected
):
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    seed(pg, rule=rule, hold=hold)
    fake = SimpleNamespace(
        client_id="api-test-source",
        require_access=lambda: {"generation": 1},
        request=lambda *args: {},
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)
    accepted = []
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        for kind in KINDS:
            for status in STATUSES:
                case_id, person = f"{kind}-{status}", person_of(kind, status)
                read = client.get(PATH + person + QUERY, headers=admin)
                assert read.status_code == 200, read.text
                before = read.json()
                assert set(before) == PREVIOUS_KEYS | {"applicable_cases"}
                assert (before["revision"], before["state"]) == (0, "NOT_APPLIED")
                listed = before["applicable_cases"]
                assert all(
                    set(row) == {"case_id", "revision", "reason"} for row in listed
                )
                reply = client.post(
                    PATH + person + QUERY,
                    headers=admin,
                    json={
                        "expected_revision": before["revision"],
                        "idempotency_key": "control-" + case_id,
                        "case_id": case_id,
                        "case_revision": 3,
                        "reason": "合成の実施理由",
                    },
                )
                assert reply.status_code in (200, 404, 409, 422), reply.text
                assert (reply.status_code == 200) is (
                    [row["case_id"] for row in listed] == [case_id]
                ), (case_id, listed, reply.text)
                assert all(row["revision"] == 3 for row in listed)
                after = client.get(PATH + person + QUERY, headers=admin).json()
                if reply.status_code == 200:
                    accepted.append(case_id)
                    # An applied control is immutable: nothing is offered again.
                    assert (after["revision"], after["state"]) == (
                        1,
                        "CONTROL_APPLIED_REMAINS",
                    )
                    assert after["applicable_cases"] == []
                else:
                    assert after["applicable_cases"] == listed
                    assert after["revision"] == 0
    assert accepted == expected
