"""Replacement and exchange options for one published duty, checked by the server
validation, and what a pharmacist is told about the other person."""

from __future__ import annotations

import json
import re

from tests import test_ideal_consent_api as consent_api
from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import (
    EVIDENCE,
    OTHER,
    SCOPE,
    approve,
    open_absence,
    own_and_foreign,
)
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)

# The fixture of the base module, published here so pytest finds it by name.
world = base.world
switch = consent_api.switch


def options(client, world, duty, kind, scope=SCOPE, publication=None):
    publication = publication or world["publication"].publication_id
    return client.get(
        "/planning/change-cases/options"
        + scope
        + f"&publication_id={publication}&duty_id={duty['duty_id']}&kind={kind}"
    )


def test_absence_options_open_the_case_they_describe(world):
    leader = world["clients"]["leader"]
    duty = world["assignments"][0]
    got = options(leader, world, duty, "ABSENCE")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["consent_required"] is False
    assert body["options"], "the synthetic roster has a free person at every time"
    for option in body["options"]:
        assert option["counterpart"]["person_id"] != duty["person_id"]
        assert option["duty"]["start"] == duty["start"]
        assert option["finding_count"] is not None
    first = body["options"][0]
    case = leader.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "ABSENCE",
            "affected_assignment_ids": first["affected_assignment_ids"],
            "proposed_assignment_ids": first["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "option-case-001",
        },
    ).json()
    assert (case["status"] != "DRAFT") == first["publishable"]


def test_a_pharmacist_is_told_the_counterpart_and_one_duty_only(world):
    clients = world["clients"]
    pharmacist = clients["pharmacist"]
    own, foreign = own_and_foreign(world)
    # no replacement may be named for an absence while the setting is off
    assert options(pharmacist, world, own, "ABSENCE").status_code == 403
    swap = options(pharmacist, world, own, "SWAP")
    assert swap.status_code == 200, swap.text
    assert swap.json()["consent_required"] is True
    assert switch(clients["admin"], True, 0, "options-switch-1").status_code == 200
    absence = options(pharmacist, world, own, "ABSENCE")
    assert absence.status_code == 200
    for body in (swap.json(), absence.json()):
        assert body["options"]
        counterparts = {o["counterpart"]["person_id"] for o in body["options"]}
        text = json.dumps(body, ensure_ascii=False)
        # the only person ids anywhere in the answer: p2 is not even in it, only the
        # counterparts named in the options
        assert set(re.findall(r'"(p\d+)"', text)) <= counterparts
        assert "relationship_id" not in text and "external_employer_id" not in text
        assert all(o["finding_count"] is None for o in body["options"])
        assert all(
            set(o["duty"]) == {"start", "end", "kind", "task", "location"}
            for o in body["options"]
        )
    # someone else's duty does not exist for a pharmacist
    assert options(pharmacist, world, foreign, "SWAP").status_code == 404


def test_scope_publication_and_staleness(world):
    leader = world["clients"]["leader"]
    duty = world["assignments"][0]
    assert options(leader, world, duty, "ABSENCE", scope=OTHER).status_code == 403
    assert (
        options(leader, world, duty, "ABSENCE", publication="nope").status_code == 404
    )
    assert options(leader, world, {"duty_id": "nope"}, "ABSENCE").status_code == 404
    case = open_absence(
        world, leader, world["assignments"][-1], "stale-opt-0001"
    ).json()
    recommended = base.recommend(leader, case, "stale-opt-recommend").json()
    assert (
        approve(
            world["clients"]["developer"], recommended, "stale-opt-0002"
        ).status_code
        == 200
    )
    assert options(leader, world, duty, "ABSENCE").status_code == 409
