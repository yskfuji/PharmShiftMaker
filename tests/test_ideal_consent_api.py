"""The absence consent setting: switched per planning scope by an administrator (default
off). When on, the person named as an absence replacement must consent before the case
can be approved, and a pharmacist may name a replacement for their own duty."""

from __future__ import annotations

import threading

import pytest
from sqlalchemy import select

from shift_scheduler.db.planning_models import PlanningChangeCase, PlanningScope
from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import (
    EVIDENCE,
    SCOPE,
    approve,
    covered_by_p2,
    open_absence,
    own_and_foreign,
    recommend,
    replacement_for,
)
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)

# The fixture of the base module, published here so pytest finds it by name.
world = base.world


def switch(client, enabled, expected, key, evidence=EVIDENCE):
    return client.post(
        "/planning/scope-settings/absence-consent" + SCOPE,
        json={
            "enabled": enabled,
            "evidence": evidence,
            "expected_version": expected,
            "idempotency_key": key,
        },
    )


def consent(client, case, key):
    return client.post(
        f"/planning/change-cases/{case['case_id']}/consent" + SCOPE,
        json={
            "expected_version": case["version"],
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )


def data_revision(world):
    with world["db"].begin() as session:
        return session.get(PlanningScope, "hospital/pharmacy").data_revision


def test_off_by_default_and_unchanged(world):
    admin, leader = world["clients"]["admin"], world["clients"]["leader"]
    pharmacist = world["clients"]["pharmacist"]
    setting = admin.get("/planning/scope-settings" + SCOPE).json()
    assert setting["absence_replacement_consent"] == {
        "enabled": False,
        "revision": 0,
        "history": [],
    }
    case = open_absence(world, leader, world["assignments"][0], "off-case-0001").json()
    assert case["status"] == "READY"
    assert case["validation"]["required_consent_person_ids"] == []
    assert case["validation"]["consent_policy"]["enabled"] is False
    own, _ = own_and_foreign(world)
    assert open_absence(world, pharmacist, own, "off-case-0002").status_code == 403


def test_only_an_administrator_switches_it_without_staling_inputs(
    world,
):
    clients = world["clients"]
    admin, leader, pharmacist = (
        clients["admin"],
        clients["leader"],
        clients["pharmacist"],
    )
    before = data_revision(world)
    assert switch(leader, True, 0, "switch-leader-1").status_code == 403
    assert switch(pharmacist, True, 0, "switch-pharm-01").status_code == 403
    on = switch(admin, True, 0, "switch-admin-01")
    assert on.status_code == 200, on.text
    assert on.json()["absence_replacement_consent"]["enabled"] is True
    assert on.json()["absence_replacement_consent"]["revision"] == 1
    # the setting is not a solver input: planning inputs stay current
    assert data_revision(world) == before
    # stale revision, and a key reused for different contents
    assert switch(admin, False, 0, "switch-admin-02").status_code == 409
    assert switch(admin, False, 1, "switch-admin-01").status_code == 409
    # replay returns the same answer
    assert switch(admin, True, 0, "switch-admin-01").status_code == 200
    # who changed it and why: administrators only
    history = admin.get("/planning/scope-settings" + SCOPE).json()
    assert [
        h["enabled"] for h in history["absence_replacement_consent"]["history"]
    ] == [True]
    seen = pharmacist.get("/planning/scope-settings" + SCOPE).json()
    assert seen["absence_replacement_consent"]["history"] is None
    assert seen["absence_replacement_consent"]["enabled"] is True
    # the generic administrative record route cannot write it
    generic = admin.post(
        "/planning/compliance/records/scope_setting" + SCOPE,
        json={
            "payload": {
                "setting_id": "absence_replacement_consent",
                "enabled": False,
                "reason": "汎用の経路",
                "evidence": {"reference": "TEST-2"},
            },
            "expected_revision": 1,
            "idempotency_key": "generic-setting-1",
        },
    )
    assert generic.status_code == 422, generic.text


def test_on_the_replacement_consents_before_approval(
    world,
):
    clients = world["clients"]
    admin, leader, pharmacist = (
        clients["admin"],
        clients["leader"],
        clients["pharmacist"],
    )
    assert switch(admin, True, 0, "switch-on-00001").status_code == 200
    own, _ = own_and_foreign(world)
    covered, candidate = covered_by_p2(world, own)
    case = open_absence(
        world, leader, covered, "on-case-00001", replacement=candidate
    ).json()
    assert case["status"] == "AWAITING_CONSENT"
    assert case["validation"]["required_consent_person_ids"] == ["p2"]
    assert case["validation"]["consent_policy"] == {
        "setting_id": "absence_replacement_consent",
        "enabled": True,
        "revision": 1,
    }
    # not approvable before consent, and only the replacement may consent
    assert approve(leader, case, "on-approve-001").status_code == 409
    assert consent(admin, case, "on-consent-adm").status_code == 403
    agreed = consent(pharmacist, case, "on-consent-001")
    assert agreed.status_code == 200, agreed.text
    assert agreed.json()["status"] == "READY"
    recommended = recommend(leader, agreed.json(), "on-recommend-2")
    assert recommended.status_code == 200, recommended.text
    approved = approve(clients["developer"], recommended.json(), "on-approve-002")
    assert approved.status_code == 200, approved.text
    assert approved.json()["version"] == 2


def test_on_a_pharmacist_may_name_a_replacement_for_their_own_duty(
    world,
):
    clients = world["clients"]
    admin, pharmacist = clients["admin"], clients["pharmacist"]
    assert switch(admin, True, 0, "switch-on-00002").status_code == 200
    own, foreign = own_and_foreign(world)
    mine = open_absence(world, pharmacist, own, "on-own-000001")
    assert mine.status_code == 200, mine.text
    assert mine.json()["status"] == "AWAITING_CONSENT"
    replacement = replacement_for(world, own).person_id
    # a pharmacist sees only their own consent state, which is empty here
    assert mine.json()["validation"]["required_consent_person_ids"] == []
    with world["db"].begin() as session:
        row = session.get(PlanningChangeCase, mine.json()["case_id"])
        assert row.validation["required_consent_person_ids"] == [replacement]
    # still only for their own duty
    assert open_absence(world, pharmacist, foreign, "on-foreign-01").status_code == 403


def test_an_absent_person_cannot_cover_and_a_later_switch_keeps_open_cases(world):
    clients = world["clients"]
    admin, leader, pharmacist = (
        clients["admin"],
        clients["leader"],
        clients["pharmacist"],
    )
    assert switch(admin, True, 0, "switch-on-00003").status_code == 200
    duties = world["assignments"]
    starts = sorted({d["start"] for d in duties})
    early = next(
        d for d in duties if d["start"] == starts[0] and d["person_id"] == "p1"
    )
    late = next(d for d in duties if d["start"] == starts[1] and d["person_id"] == "p0")
    pick = {(c.start.isoformat(), c.person_id): c for c in world["snapshot"].candidates}
    # p0 is absent from one duty of the case and cannot be its replacement elsewhere
    refused = leader.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "ABSENCE",
            "affected_assignment_ids": [early["duty_id"], late["duty_id"]],
            "proposed_assignment_ids": [
                pick[(starts[0], "p0")].duty_id,
                pick[(starts[1], "p2")].duty_id,
            ],
            "evidence": EVIDENCE,
            "idempotency_key": "two-replace-01",
        },
    )
    assert refused.status_code == 422, refused.text
    # an open case keeps the policy it was opened under
    own, _ = own_and_foreign(world)
    covered, candidate = covered_by_p2(world, own)
    case = open_absence(
        world, leader, covered, "keep-open-0001", replacement=candidate
    ).json()
    assert case["status"] == "AWAITING_CONSENT"
    assert switch(admin, False, 1, "switch-off-0003").status_code == 200
    assert approve(leader, case, "keep-approve-1").status_code == 409
    with world["db"].begin() as session:
        assert session.get(PlanningChangeCase, case["case_id"]).status == (
            "AWAITING_CONSENT"
        )
    # new cases follow the new setting
    later = open_absence(world, leader, duties[-1], "after-off-0001").json()
    assert later["validation"]["required_consent_person_ids"] == []
    del pharmacist


def test_everyone_asked_consents_before_the_case_is_ready(world):
    """An exchange asks both people; one consent is not enough, and a given consent
    cannot be turned into a refusal afterwards."""
    clients = world["clients"]
    pharmacist, admin = clients["pharmacist"], clients["admin"]
    own, _ = own_and_foreign(world)
    options = pharmacist.get(
        "/planning/change-cases/options"
        + SCOPE
        + f"&publication_id={world['publication'].publication_id}"
        + f"&duty_id={own['duty_id']}&kind=SWAP"
    ).json()["options"]
    option = next(o for o in options if o["counterpart"]["person_id"] == "p0")
    created = pharmacist.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "SWAP",
            "affected_assignment_ids": option["affected_assignment_ids"],
            "proposed_assignment_ids": option["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "swap-both-0001",
        },
    ).json()
    assert created.get("status") == "AWAITING_CONSENT", created
    first = consent(pharmacist, created, "swap-both-0002")
    assert first.status_code == 200 and first.json()["status"] == "AWAITING_CONSENT"
    # the pharmacist has consented: refusing now is a conflict
    refused = pharmacist.post(
        f"/planning/change-cases/{created['case_id']}/decline" + SCOPE,
        json={
            "expected_version": first.json()["version"],
            "evidence": EVIDENCE,
            "idempotency_key": "swap-both-0003",
        },
    )
    assert refused.status_code == 409
    second = consent(admin, first.json(), "swap-both-0004")
    assert second.status_code == 200 and second.json()["status"] == "READY"
    # an exchange concerns one duty of the other person, never two
    others = [d["duty_id"] for d in world["assignments"] if d["person_id"] != "p2"][:2]
    wide = pharmacist.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "SWAP",
            "affected_assignment_ids": [own["duty_id"], *others],
            "proposed_assignment_ids": option["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "swap-wide-0001",
        },
    )
    assert wide.status_code == 403


@pytest.mark.parametrize("round_", range(4))
def test_postgres_switch_and_pharmacist_case_are_ordered(world, round_):
    """A pharmacist's replacement is accepted only under the policy it was checked
    against: the facility lock orders the check against a concurrent switch."""
    if "postgresql" not in str(world["db"].kw["bind"].url):
        pytest.skip("row locks are a PostgreSQL property")
    clients = world["clients"]
    own, _ = own_and_foreign(world)
    results = {}

    def turn_on():
        results["switch"] = switch(clients["admin"], True, 0, f"race-switch-{round_}")

    def open_case():
        results["case"] = open_absence(
            world, clients["pharmacist"], own, f"race-case-00{round_}"
        )

    threads = [threading.Thread(target=turn_on), threading.Thread(target=open_case)]
    for thread in threads[:: 1 if round_ % 2 else -1]:
        thread.start()
    for thread in threads:
        thread.join()
    assert results["switch"].status_code == 200
    case = results["case"]
    assert case.status_code in {200, 403}
    if case.status_code == 200:
        with world["db"].begin() as session:
            row = session.scalars(
                select(PlanningChangeCase).where(
                    PlanningChangeCase.case_id == case.json()["case_id"]
                )
            ).one()
            assert row.validation["consent_policy"]["enabled"] is True
            assert row.status in {"AWAITING_CONSENT", "DRAFT"}
