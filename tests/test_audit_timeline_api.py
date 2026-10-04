"""The audit timeline: administrators only, one scope, complete paging, and no person
identifiers or evidence text in the answer."""

from __future__ import annotations

import json
import re

from shift_scheduler.db.planning_models import PlanningOutbox
from tests import test_ideal_consent_api as consent_api
from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import EVIDENCE, SCOPE, open_absence
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)

# The fixture of the base module, published here so pytest finds it by name.
world = base.world
PERSON = re.compile(r"(?<![A-Za-z0-9_])p[0-9]+(?![A-Za-z0-9_])")


def activity(world):
    clients = world["clients"]
    assert (
        consent_api.switch(clients["admin"], True, 0, "tl-switch-0001").status_code
        == 200
    )
    for i, duty in enumerate(world["assignments"]):
        open_absence(world, clients["leader"], duty, f"tl-case-{i:06d}")
    with world["db"].begin() as session:
        session.add(
            PlanningOutbox(
                event_id="elsewhere-0001",
                kind="change.absence.created",
                scope_id="other/pharmacy",
                actor="someone",
                payload={"case_id": "x", "person_ids": ["p9"]},
            )
        )


def timeline(client, query=""):
    return client.get("/planning/audit-timeline" + SCOPE + query)


def test_administrators_see_counts_and_references_only(world):
    activity(world)
    admin = world["clients"]["admin"]
    got = timeline(admin, "&limit=200")
    assert got.status_code == 200, got.text
    body = got.json()
    kinds = {e["kind"] for e in body["entries"]}
    assert {
        "change.absence.created",
        "compliance.scope_setting",
        "schedule.published",
    } <= kinds
    text = json.dumps(body, ensure_ascii=False)
    assert not PERSON.findall(text), PERSON.findall(text)
    for leaked in (
        EVIDENCE["reason"],
        EVIDENCE["reference"],
        "person_id",
        "evidence",
        "case_id",
        "publication_id",
        "input_hash",
        "admin",
        "leader",
        "pharmacist",
    ):
        assert leaked not in text
    created = next(e for e in body["entries"] if e["kind"] == "change.absence.created")
    assert created["subject_count"] >= 1 and created["actor_role"] == "LEADER"
    assert "elsewhere-0001" not in text
    # an administrative record change does not record how many people it concerned
    setting = next(
        e for e in body["entries"] if e["kind"] == "compliance.scope_setting"
    )
    assert setting["subject_count"] is None
    for name in ("leader", "pharmacist"):
        assert timeline(world["clients"][name]).status_code == 403


def test_paging_is_complete_and_filters_by_category(world):
    activity(world)
    admin = world["clients"]["admin"]
    everything = timeline(admin, "&limit=200").json()["entries"]
    seen, cursor = [], None
    while True:
        page = timeline(
            admin, "&limit=3" + (f"&before={cursor}" if cursor else "")
        ).json()
        seen += page["entries"]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == everything
    changes = timeline(admin, "&limit=200&category=change").json()["entries"]
    assert changes and all(e["category"] == "change" for e in changes)
    assert timeline(admin, "&before=not-a-cursor").status_code == 422
