"""Plan comparison: its figures are the solver's own objectives recomputed for fixed
duties (checked against what the solver recorded), seeded jobs stay compatible, and the
API compares only drafts of one input in the caller's scope."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from shift_scheduler.application import plan_comparison
from shift_scheduler.application.worker import run_once
from shift_scheduler.db.planning_models import PlanningJob
from shift_scheduler.domain.planning import Preference
from shift_scheduler.optimizer.planning import solve
from tests import test_ideal_workflows_api as base
from tests.test_ideal_workflows_api import OTHER, SCOPE
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)
from tests.test_reviewed_planning import snapshot

# The fixture of the base module, published here so pytest finds it by name.
world = base.world


def with_preferences_and_previous(n=3, days=2):
    data = snapshot(n=n, days=days)
    duties = data.candidates
    prefs = (
        Preference(person_id="p0", start=duties[0].start, end=duties[0].end, rank=1),
        Preference(person_id="p1", start=duties[0].start, end=duties[0].end, rank=3),
        Preference(person_id="p2", start=duties[-1].start, end=duties[-1].end, rank=2),
    )
    previous = tuple(d.duty_id for d in duties if d.person_id == "p1")
    return data.model_copy(update={"preferences": prefs, "previous_duty_ids": previous})


def refreshed_input(world) -> str:
    """A job for a published period starts from an input refreshed with its
    publication context (the reviewed flow); returns that input's hash."""
    admin = world["clients"]["admin"]
    scope = next(
        s
        for s in admin.get("/planning/scopes").json()
        if s["scope_id"] == "hospital/pharmacy"
    )
    refreshed = admin.post(
        "/planning/inputs/refresh" + SCOPE,
        json={"expected_revision": scope["input_revision"]},
    )
    assert refreshed.status_code == 200, refreshed.text
    return admin.get("/planning/inputs/latest" + SCOPE).json()["input_hash"]


@pytest.mark.parametrize("seed", [0, 1, 7])
def test_figures_reproduce_the_solver_objectives(seed):
    data = with_preferences_and_previous()
    result = solve(data, 10, seed=seed)
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert result.random_seed == seed
    selected = set(result.proposal.duty_ids)
    levels = result.objective_by_level
    assert len(levels) >= 2
    assert plan_comparison.changes(data, selected) == levels[0]
    assert plan_comparison.preference_cost(data, selected)[0] == levels[1]


def test_no_previous_schedule_means_no_change_figure():
    data = snapshot(n=3, days=2)
    result = solve(data, 10)
    assert plan_comparison.changes(data, set(result.proposal.duty_ids)) is None
    assert result.objective_by_level[0] == 0


def test_comparison_orders_marks_duplicates_and_counts_differences():
    data = with_preferences_and_previous()
    a = solve(data, 10).proposal.duty_ids
    b = tuple(d.duty_id for d in data.candidates if d.person_id == "p2")
    out = plan_comparison.compare(
        data,
        [
            {"draft_id": "A", "duty_ids": a, "solver": None},
            {"draft_id": "B", "duty_ids": b, "solver": None},
            {"draft_id": "C", "duty_ids": a, "solver": None},
        ],
        published=None,
    )
    plans = {p["draft_id"]: p for p in out["plans"]}
    assert plans["C"]["duplicate_of"] == "A" and plans["A"]["duplicate_of"] is None
    assert (
        out["order"][0] in {"A", "C"}
        or plans["B"]["findings"] == plans["A"]["findings"]
    )
    pair = next(p for p in out["pairs"] if (p["a"], p["b"]) == ("A", "C"))
    assert pair["differing_duties"] == 0 and pair["affected_people"] == 0
    assert "合成の点数はありません" in out["meaning"]


def test_default_jobs_are_unchanged_and_a_seed_reaches_the_solver(world):
    admin = world["clients"]["admin"]
    input_hash = refreshed_input(world)
    default = admin.post(
        "/planning/jobs" + SCOPE,
        json={"input_hash": input_hash, "idempotency_key": "seed-default-1"},
    )
    seeded = admin.post(
        "/planning/jobs" + SCOPE,
        json={
            "input_hash": input_hash,
            "idempotency_key": "seed-seven-001",
            "random_seed": 7,
            "budget_seconds": 5,
        },
    )
    assert default.status_code == seeded.status_code == 202, seeded.text
    with world["db"].begin() as session:
        rows = {
            j.job_id: j
            for j in session.scalars(
                select(PlanningJob).where(PlanningJob.input_hash == input_hash)
            )
        }
        assert rows[default.json()["job_id"]].result is None
        assert rows[seeded.json()["job_id"]].result == {"requested_random_seed": 7}
    # the same key with another seed is a different request
    other = admin.post(
        "/planning/jobs" + SCOPE,
        json={
            "input_hash": input_hash,
            "idempotency_key": "seed-seven-001",
            "random_seed": 8,
            "budget_seconds": 5,
        },
    )
    assert other.status_code == 409


def test_worker_passes_the_seed(world):
    admin = world["clients"]["admin"]
    input_hash = refreshed_input(world)
    queued = admin.post(
        "/planning/jobs" + SCOPE,
        json={
            "input_hash": input_hash,
            "idempotency_key": "seed-worker-01",
            "random_seed": 3,
            "budget_seconds": 5,
        },
    ).json()
    while run_once(world["db"]):
        pass
    job = admin.get(f"/planning/jobs/{queued['job_id']}" + SCOPE).json()
    assert job["status"] in {"OPTIMAL", "FEASIBLE"}, job
    assert job["result"]["random_seed"] == 3


def test_api_compares_drafts_of_one_input_in_scope(world):
    clients = world["clients"]
    admin = clients["admin"]
    input_hash = world["snapshot"].input_hash
    drafts = []
    for seed, key in ((0, "cmp-draft-0001"), (0, "cmp-draft-0002")):
        created = admin.post(
            "/planning/drafts" + SCOPE,
            json={
                "idempotency_key": key,
                "input_hash": input_hash,
                "proposal": solve(world["snapshot"], 5, seed=seed).proposal.model_dump(
                    mode="json"
                ),
            },
        )
        assert created.status_code == 201, created.text
        drafts.append(created.json()["draft_id"])
    query = f"&input_hash={input_hash}&draft_ids={drafts[0]}&draft_ids={drafts[1]}"
    got = clients["leader"].get("/planning/plan-comparison" + SCOPE + query)
    assert got.status_code == 200, got.text
    body = got.json()
    assert [p["draft_id"] for p in body["plans"]] == drafts
    assert body["plans"][1]["duplicate_of"] == drafts[0]
    # the current publication is the comparison baseline
    assert all(p["changes_from_publication"] is not None for p in body["plans"])
    assert (
        clients["pharmacist"]
        .get("/planning/plan-comparison" + SCOPE + query)
        .status_code
        == 403
    )
    assert admin.get("/planning/plan-comparison" + OTHER + query).status_code == 403
    twice = f"&input_hash={input_hash}&draft_ids={drafts[0]}&draft_ids={drafts[0]}"
    assert admin.get("/planning/plan-comparison" + SCOPE + twice).status_code == 422
    missing = f"&input_hash={input_hash}&draft_ids=nope"
    assert admin.get("/planning/plan-comparison" + SCOPE + missing).status_code == 404


def test_a_seeded_job_resend_is_recognised_after_an_unknown_outcome(world):
    from datetime import UTC, datetime, timedelta

    from shift_scheduler.application.planning import claim_job, finish_job
    from shift_scheduler.domain.planning import SolveResult

    admin = world["clients"]["admin"]
    input_hash = refreshed_input(world)
    body = {
        "input_hash": input_hash,
        "idempotency_key": "seed-unknown-01",
        "random_seed": 5,
        "budget_seconds": 5,
    }
    queued = admin.post("/planning/jobs" + SCOPE, json=body).json()
    with world["db"].begin() as session:
        job_id, token, snapshot, _ = claim_job(session)
        assert job_id == queued["job_id"]
        # the worker lost its child: an unknown outcome that names no seed
        finish_job(
            session,
            job_id,
            token,
            SolveResult(
                status="UNKNOWN",
                input_hash=snapshot.input_hash,
                rule_revision=snapshot.rule_revision,
                solver_version="worker",
            ),
        )
    again = admin.post("/planning/jobs" + SCOPE, json=body)
    assert again.status_code == 202, again.text
    assert again.json()["job_id"] == queued["job_id"]
    # and after the retry limit
    retried = admin.post(
        "/planning/jobs" + SCOPE, json={**body, "idempotency_key": "seed-unknown-02"}
    ).json()
    with world["db"].begin() as session:
        job = session.get(PlanningJob, retried["job_id"])
        job.status, job.attempts = "RUNNING", 3
        job.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    with world["db"].begin() as session:
        claim_job(session)
        assert session.get(PlanningJob, retried["job_id"]).status == "UNKNOWN"
    resend = admin.post(
        "/planning/jobs" + SCOPE, json={**body, "idempotency_key": "seed-unknown-02"}
    )
    assert resend.status_code == 202, resend.text
