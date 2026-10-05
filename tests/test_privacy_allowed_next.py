"""The privacy listing tells each viewer which decisions the decision route accepts.

`allowed_next` is compared with what POST /privacy/cases/{case_id} really does for
every status and every target, not with a table written here. Synthetic data only.
"""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import PrivacyCase
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_api import BASE, QUERY, prepare
from tests.test_compliance_v2 import v2

STATUSES = ["REQUESTED", "VERIFIED", "APPROVED", "COMPLETED", "RELEASED", "REJECTED"]
TARGETS = ["VERIFIED", "APPROVED", "REJECTED", "COMPLETED", "RELEASED"]
PASSWORDS = {"admin": "pass-admin", "leader": "pass-lead", "pharmacist": "pass-ph"}
PREVIOUS_KEYS = ("case_id", "revision", "status", "payload")


def login(client, who):
    client.cookies.clear()
    response = client.post(
        "/auth/login", json={"username": who, "password": PASSWORDS[who]}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def seed(factory, kind, person="p0"):
    """One case per (status, target), so every decision meets an untouched case."""
    prepare(factory)
    with factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="leader",
                issuer="mock",
                subject="leader",
                person_id="p1",
                scope_id="hospital/pharmacy",
                role="LEADER",
                active=True,
            )
        )
        for before in STATUSES:
            for after in TARGETS:
                session.add(
                    PrivacyCase(
                        case_id=f"{before}-{after}",
                        scope_id="hospital/pharmacy",
                        person_id=person,
                        kind=kind,
                        status=before,
                        revision=3,
                        payload={"person_id": person, "kind": kind, "reason": "合成"},
                    )
                )


def decide(client, headers, case_id, target, result_reference="local://result"):
    return client.post(
        BASE + "/privacy/cases/" + case_id + QUERY,
        headers=headers,
        json={
            "expected_revision": 3,
            "idempotency_key": "decide-" + case_id,
            "payload": {
                "status": target,
                "reason": "合成の判断",
                "identity_evidence": v2().policy_evidence.model_dump(mode="json"),
                "result_reference": result_reference,
            },
        },
    )


def listed(client, headers):
    response = client.get(BASE + "/privacy" + QUERY, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("kind", ["access", "rectify", "restrict", "erase"])
def test_allowed_next_is_what_the_decision_route_accepts(sqlite_session_factory, kind):
    seed(sqlite_session_factory, kind)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        cases = {c["case_id"]: c for c in listed(client, admin)["cases"]}
        assert len(cases) == len(STATUSES) * len(TARGETS)
        for before in STATUSES:
            accepted = []
            for after in TARGETS:
                reply = decide(client, admin, f"{before}-{after}", after)
                assert reply.status_code in (200, 422), reply.text
                if reply.status_code == 200:
                    accepted.append(after)
            for after in TARGETS:
                shown = cases[f"{before}-{after}"]["allowed_next"]
                assert len(shown) == len(set(shown))
                assert set(shown) == set(accepted), (before, shown, accepted)
        terminal = [s for s in STATUSES if not cases[f"{s}-VERIFIED"]["allowed_next"]]
        assert terminal == ["RELEASED", "REJECTED"]


def test_the_result_reference_requirement_is_the_one_the_route_enforces(
    sqlite_session_factory,
):
    seed(sqlite_session_factory, "access")
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        cases = {c["case_id"]: c for c in listed(client, admin)["cases"]}
        needing = set()
        for before in STATUSES:
            for after in cases[f"{before}-VERIFIED"]["allowed_next"]:
                case = cases[f"{before}-{after}"]
                required = after in case["result_reference_required"]
                assert set(case["result_reference_required"]) <= set(
                    case["allowed_next"]
                )
                # Without a reference the route refuses exactly the marked targets;
                # the case stays untouched, so the complete decision still succeeds.
                bare = decide(client, admin, case["case_id"], after, None)
                assert bare.status_code == (422 if required else 200), bare.text
                if required:
                    needing.add(after)
                    full = decide(client, admin, case["case_id"], after)
                    assert full.status_code == 200, full.text
        assert needing == {"COMPLETED"}


@pytest.mark.parametrize("who", ["pharmacist", "leader"])
def test_a_viewer_who_may_not_decide_is_offered_nothing(sqlite_session_factory, who):
    person = {"pharmacist": "outsider", "leader": "p1"}[who]
    seed(sqlite_session_factory, "access", person)
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = login(client, who)
        cases = listed(client, staff)["cases"]
        assert len(cases) == len(STATUSES) * len(TARGETS)  # the viewer's own cases
        for case in cases:
            assert case["allowed_next"] == []
            assert case["result_reference_required"] == []
            before, after = case["case_id"].split("-")
            reply = decide(client, staff, case["case_id"], after)
            assert reply.status_code == 403, reply.text
    with sqlite_session_factory() as session:
        for before in STATUSES:
            for after in TARGETS:
                row = session.get(PrivacyCase, f"{before}-{after}")
                assert (row.status, row.revision) == (before, 3)


def test_the_previous_fields_of_the_listing_are_unchanged(sqlite_session_factory):
    seed(sqlite_session_factory, "access")
    with sqlite_session_factory() as session:
        stored = {
            row.case_id: {
                "case_id": row.case_id,
                "revision": row.revision,
                "status": row.status,
                "payload": row.payload,
            }
            for row in session.query(PrivacyCase)
        }
    with TestClient(app, base_url="https://localhost:8000") as client:
        body = listed(client, login(client, "admin"))
    assert set(body) == {"cases", "rules", "holds", "people"}
    assert (body["rules"], body["holds"]) == ([], [])
    assert {p["person_id"] for p in body["people"]} >= {"p0"}
    assert len(body["cases"]) == len(stored)
    for case in body["cases"]:
        assert set(case) == {
            *PREVIOUS_KEYS,
            "allowed_next",
            "result_reference_required",
        }
        assert {key: case[key] for key in PREVIOUS_KEYS} == stored[case["case_id"]]
