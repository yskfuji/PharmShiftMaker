"""Reading one case, withdrawing it, declining a consent, and listing memberships."""

from __future__ import annotations

import threading

import pytest

from tests import test_ideal_consent_api as consent_api
from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import (
    EVIDENCE,
    SCOPE,
    approve,
    covered_by_p2,
    open_absence,
    own_and_foreign,
)
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)

# The fixture of the base module, published here so pytest finds it by name.
world = base.world
switch = consent_api.switch
consent = consent_api.consent


def act(client, case, action, key):
    return client.post(
        f"/planning/change-cases/{case['case_id']}/{action}" + SCOPE,
        json={
            "expected_version": case["version"],
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )


def awaiting_p2(world, key):
    """A case in which p2 (the pharmacist) is asked to cover another person's duty."""
    clients = world["clients"]
    assert switch(clients["admin"], True, 0, "actions-switch-1").status_code == 200
    own, _ = own_and_foreign(world)
    covered, candidate = covered_by_p2(world, own)
    case = open_absence(world, clients["leader"], covered, key, replacement=candidate)
    assert case.json()["status"] == "AWAITING_CONSENT", case.text
    return case.json()


def test_one_case_is_readable_only_by_those_who_may_see_it(world):
    clients = world["clients"]
    own, foreign = own_and_foreign(world)
    mine = open_absence(world, clients["leader"], own, "read-own-00001").json()
    other = open_absence(world, clients["leader"], foreign, "read-other-0001").json()
    pharmacist = clients["pharmacist"]
    got = pharmacist.get(f"/planning/change-cases/{mine['case_id']}" + SCOPE)
    assert got.status_code == 200 and got.json()["evidence"] == {}
    # not involved: 404, the same answer as for a case that does not exist
    assert (
        pharmacist.get(f"/planning/change-cases/{other['case_id']}" + SCOPE).status_code
        == 404
    )
    assert pharmacist.get("/planning/change-cases/nope" + SCOPE).status_code == 404
    full = clients["leader"].get(f"/planning/change-cases/{other['case_id']}" + SCOPE)
    assert full.status_code == 200 and full.json()["evidence"] == EVIDENCE


def test_withdrawal_closes_a_case_for_good(world):
    clients = world["clients"]
    leader, pharmacist = clients["leader"], clients["pharmacist"]
    own, _ = own_and_foreign(world)
    case = open_absence(world, pharmacist, own, "withdraw-own-01", replace=False).json()
    # the creator withdraws their own case; an involved pharmacist who did not create
    # a case may not
    planner_case = open_absence(world, leader, own, "withdraw-lead-1").json()
    assert (
        act(pharmacist, planner_case, "withdraw", "withdraw-no-001").status_code == 403
    )
    withdrawn = act(pharmacist, case, "withdraw", "withdraw-yes-01")
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "WITHDRAWN"
    # replay of the same request returns the same answer
    assert act(pharmacist, case, "withdraw", "withdraw-yes-01").status_code == 200
    closed = withdrawn.json()
    assert act(pharmacist, closed, "withdraw", "withdraw-again1").status_code == 409
    assert approve(leader, closed, "withdraw-appr-1").status_code == 409
    # a planner withdraws a case they did not create
    assert act(leader, planner_case, "withdraw", "withdraw-lead-2").status_code == 200


def test_the_person_asked_declines_and_nobody_else(world):
    clients = world["clients"]
    case = awaiting_p2(world, "decline-case-01")
    assert act(clients["admin"], case, "decline", "decline-admin-1").status_code == 403
    assert act(clients["leader"], case, "decline", "decline-lead-01").status_code == 403
    declined = act(clients["pharmacist"], case, "decline", "decline-p2-0001")
    assert declined.status_code == 200, declined.text
    assert declined.json()["status"] == "DECLINED"
    after = declined.json()
    assert approve(clients["leader"], after, "decline-appr-01").status_code == 409
    assert consent(clients["pharmacist"], after, "decline-cons-01").status_code == 409


def test_memberships_are_listed_for_administrators_only(world):
    clients = world["clients"]
    listed = clients["admin"].get("/planning/memberships" + SCOPE)
    assert listed.status_code == 200
    assert {m["subject"] for m in listed.json()} == {
        "admin",
        "developer",
        "leader",
        "pharmacist",
    }
    for name in ("leader", "pharmacist"):
        assert clients[name].get("/planning/memberships" + SCOPE).status_code == 403
    link = (
        clients["admin"]
        .post(
            "/planning/memberships" + SCOPE,
            json={
                "issuer": "https://id.example",
                "subject": "former",
                "person_id": "p1",
                "role": "PHARMACIST",
                "evidence": EVIDENCE,
                "expected_version": 0,
                "idempotency_key": "list-link-0001",
            },
        )
        .json()
    )
    gone = clients["admin"].post(
        f"/planning/memberships/{link['membership_id']}/deactivate" + SCOPE,
        json={
            "expected_version": 1,
            "evidence": EVIDENCE,
            "idempotency_key": "list-deact-001",
        },
    )
    assert gone.status_code == 200, gone.text
    active = clients["admin"].get("/planning/memberships" + SCOPE).json()
    assert "former" not in {m["subject"] for m in active}
    everyone = (
        clients["admin"]
        .get("/planning/memberships" + SCOPE + "&include_inactive=true")
        .json()
    )
    assert "former" in {m["subject"] for m in everyone}


def test_administrator_cannot_deactivate_their_own_membership(world):
    response = world["clients"]["admin"].post(
        "/planning/memberships/m-admin/deactivate" + SCOPE,
        json={
            "expected_version": 1,
            "evidence": EVIDENCE,
            "idempotency_key": "self-deactivate-1",
        },
    )
    assert response.status_code == 409
    active = world["clients"]["admin"].get("/planning/memberships" + SCOPE).json()
    assert next(m for m in active if m["membership_id"] == "m-admin")["active"]


def test_related_creator_requires_an_independent_final_approver(world):
    clients = world["clients"]
    case = open_absence(
        world, clients["leader"], world["assignments"][0], "four-eyes-case-1"
    ).json()
    direct = approve(clients["leader"], case, "four-eyes-direct")
    assert direct.status_code == 409
    recommended = clients["leader"].post(
        f"/planning/change-cases/{case['case_id']}/recommend" + SCOPE,
        json={
            "expected_version": case["version"],
            "evidence": EVIDENCE,
            "idempotency_key": "four-eyes-recommend",
        },
    )
    assert recommended.status_code == 200, recommended.text
    waiting = recommended.json()
    assert waiting["status"] == "AWAITING_INDEPENDENT_APPROVAL"
    assert (
        approve(clients["leader"], waiting, "four-eyes-self-final").status_code == 409
    )
    final = approve(clients["developer"], waiting, "four-eyes-final")
    assert final.status_code == 200, final.text


def test_planner_rejection_is_not_recorded_as_consent_refusal(world):
    clients = world["clients"]
    case = open_absence(
        world, clients["leader"], world["assignments"][0], "reject-case-0001"
    ).json()
    response = act(clients["admin"], case, "reject", "reject-case-0002")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "REJECTED"


@pytest.mark.parametrize("round_", range(4))
def test_postgres_consent_and_withdrawal_race_to_one_outcome(world, round_):
    if "postgresql" not in str(world["db"].kw["bind"].url):
        pytest.skip("row locks are a PostgreSQL property")
    clients = world["clients"]
    case = awaiting_p2(world, f"race-case-{round_:04d}")
    results = {}

    def agree():
        results["consent"] = consent(
            clients["pharmacist"], case, f"race-agree-{round_}"
        )

    def withdraw():
        results["withdraw"] = act(
            clients["leader"], case, "withdraw", f"race-wd-{round_}"
        )

    threads = [threading.Thread(target=agree), threading.Thread(target=withdraw)]
    for thread in threads[:: 1 if round_ % 2 else -1]:
        thread.start()
    for thread in threads:
        thread.join()
    codes = sorted([results["consent"].status_code, results["withdraw"].status_code])
    assert codes == [200, 409], (results["consent"].text, results["withdraw"].text)
