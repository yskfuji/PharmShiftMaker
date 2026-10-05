"""Explicit synthetic V3 fixture shared by local UI and API evaluations."""

from datetime import datetime, timedelta

from tests.fixtures.reviewed_planning import reviewed_planning_snapshot
from tests.test_catalogue_v3 import data

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot

SCOPE = "hospital/pharmacy"
# The rule the erasure journey (U29) erases under: one day after the period's end,
# verified, and in force for as long as this synthetic fixture is used.
RETENTION_TRIAL_RULE = {
    "category": "planning_history",
    "purpose": "synthetic browser erasure of superseded planning inputs",
    "anchor": "period_end",
    "retention_days": 1,
    "legal_minimum_days": 0,
    "effective_from": "2015-01-01",
    "effective_until": "2099-01-01",
    "evidence": {
        "reference": "isolated E2E approval",
        "status": "verified",
        "verified_by": "synthetic-reviewer",
    },
    "owner": "synthetic-reviewer",
    "next_review": "2098-12-31",
}


def _weeks_later(snapshot, weeks):
    """The same snapshot with every instant `weeks` weeks later (earlier when negative)."""
    delta = timedelta(weeks=weeks)

    def move(value):
        if isinstance(value, dict):
            return {key: move(item) for key, item in value.items()}
        if isinstance(value, list):
            return [move(item) for item in value]
        if isinstance(value, str) and value[4:5] == "-" and value[10:11] == "T":
            return (datetime.fromisoformat(value) + delta).isoformat()
        return value

    return type(snapshot).model_validate(move(snapshot.model_dump(mode="json")))


def retention_trial_inputs():
    """Superseded inputs for the erasure journey, each with the version replacing it.

    In order: a period ten years past (its retention has passed) and its newer
    version, then a period ten years ahead (its retention has not) and its newer
    version. Only the older version of each pair can ever be erased; the newer one
    stays the current input of its period.
    """
    base = reviewed_planning_snapshot(1, 1)
    inputs = []
    for weeks in (-520, 520):
        older = _weeks_later(base, weeks)
        inputs += [older, older.model_copy(update={"source_revision": 1})]
    return inputs


def seed_planning_dependents(session, snapshot):
    """Plan once with a registered input; return (job_id, draft_id).

    The real path of a generation: a job is queued, claimed and finished with the
    solver's result, which creates the draft and the events of both. Nothing is
    published, so the input stays erasable once it is superseded and its retention has
    passed: a publication would be the current one of its period.
    """
    from shift_scheduler.application import planning
    from shift_scheduler.optimizer.planning import solve

    job = planning.enqueue(
        session, snapshot.input_hash, SCOPE, "fixture", "retention-trial-generation", 5
    )
    session.flush()
    claimed = planning.claim_job(session)
    if claimed is None or claimed[0] != job.job_id:
        raise RuntimeError("The retention trial's job was not the one claimed")
    job_id, token, data, budget = claimed
    draft_id = planning.finish_job(session, job_id, token, solve(data, budget))
    if draft_id is None:
        raise RuntimeError("The retention trial's generation produced no draft")
    session.flush()
    return job_id, draft_id


def seed_retention_trial(session):
    """Register the trial inputs and their rule; return the scope's input revision.

    Called before the fixture's own input is registered, so that input stays the
    newest of the scope. The first input (the one past its retention) also gets a
    finished generation job and the draft it produced, so that erasing it has
    dependent rows to erase.
    """
    from shift_scheduler.application.planning import register_input
    from shift_scheduler.db.compliance_models import RetentionRule

    revision = 0
    for position, snapshot in enumerate(retention_trial_inputs()):
        revision = register_input(session, snapshot, "fixture", revision)[
            "input_revision"
        ]
        if position == 0:
            # While it is still the current version of its period: what planning with an
            # input leaves behind. The journey erases these rows with the input.
            seed_planning_dependents(session, snapshot)
    session.add(
        RetentionRule(
            key="e2e-planning-history",
            scope_id=SCOPE,
            category="planning_history",
            revision=1,
            payload=RETENTION_TRIAL_RULE,
        )
    )
    return revision


def snapshot(*, with_grant_series=False, with_partial_day_leave=False):
    """`with_partial_day_leave`: the leave rules also allow half days and hours (the
    default rules allow whole days only)."""
    original = data()
    payload = original.model_dump(mode="json")
    payload["people"].append(
        {"person_id": "p1", "name": "合成職員・長い氏名・薬剤部の画面評価"}
    )
    payload["contracts"].append(
        dict(
            payload["contracts"][0],
            person_id="p1",
            revision_id="c1",
            relationship_id="e1",
        )
    )
    payload["employments"].append(
        dict(
            payload["employments"][0],
            person_id="p1",
            revision_id="emp1",
            relationship_id="e1",
        )
    )
    payload["capabilities"].append(dict(payload["capabilities"][0], person_id="p1"))
    payload["demands"] = [
        d
        for d in payload["demands"]
        if d["start"][:10] not in payload["employments"][0]["statutory_holidays"]
    ]
    for i in range(2):
        payload["leave_accounts"].append(
            {
                "account_id": f"g{i}",
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "granted_on": "2026-01-01",
                "expires_on": "2028-01-01",
                "granted_days": 5,
                "statutory_days": 5,
                "evidence": payload["policy_evidence"],
            }
        )
        payload["leave_policies"].append(
            {
                "policy_id": f"lp{i}",
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "start": "2026-01-01T00:00:00+09:00",
                "end": "2028-01-01T00:00:00+09:00",
                "hours_per_day": 4,
                "hourly_year_start": "2026-01-01",
                "evidence": payload["policy_evidence"],
                **(
                    {"hourly_enabled": True, "half_day_enabled": True}
                    if with_partial_day_leave
                    else {}
                ),
            }
        )
        payload["ledger_recordings"].append(
            {
                "recording_id": f"hr-g{i}",
                "object_kind": "leave_account",
                "object_id": f"g{i}",
                "external_event_id": f"hr:g{i}",
                "external_revision": 1,
                "recorded_at": "2026-01-01T00:00:00+09:00",
                "evidence": payload["policy_evidence"],
            }
        )
    if with_grant_series:
        # A separate base date from p0's regular grant g0 (2026-01-01): two
        # independent statutory grants on one date are flagged as a duplicate.
        for account_id, days in (("split-first", 3), ("split-second", 4)):
            payload["leave_accounts"].append(
                {
                    "account_id": account_id,
                    "person_id": "p0",
                    "employer_id": "hospital",
                    "granted_on": "2026-01-02",
                    "expires_on": "2028-01-02",
                    "statutory_days": days,
                    "granted_days": days,
                    "grant_cycle_id": "split-series",
                    "evidence": payload["policy_evidence"],
                }
            )
            payload["ledger_recordings"].append(
                {
                    "recording_id": "hr-" + account_id,
                    "object_kind": "leave_account",
                    "object_id": account_id,
                    "external_event_id": "hr:" + account_id,
                    "external_revision": 1,
                    "recorded_at": "2026-01-02T00:00:00+09:00",
                    "evidence": payload["policy_evidence"],
                }
            )
    generated = generate_catalogue(parse_snapshot(payload))
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    return parse_snapshot(payload)
