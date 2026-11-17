"""Fairness normaliser: attainable exposure is the per-revision sum of min(cap, opportunity).

Counterexample found in review: splitting a contract into two revisions with
identical terms (split before any night) used to raise the normaliser and gave
p0 an extra night. No database needed.
"""

from datetime import timedelta

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.optimizer.fairness import capped_opportunity
from shift_scheduler.optimizer.planning import solve
from tests.test_catalogue_v3 import data


def payload(split):
    p = data().model_dump(mode="json")
    p["people"].append({"person_id": "p1", "name": "Synthetic second person"})
    p["contracts"].append(
        dict(p["contracts"][0], person_id="p1", revision_id="c1", relationship_id="e1")
    )
    p["employments"].append(
        dict(
            p["employments"][0],
            person_id="p1",
            revision_id="emp1",
            relationship_id="e1",
        )
    )
    p["capabilities"].append(dict(p["capabilities"][0], person_id="p1"))
    for contract in p["contracts"]:
        contract["allowed_kinds"] = ["NIGHT"]
    p["contracts"][0]["period_max_seconds"] = 4 * 3600
    start = parse_snapshot(p).period.start
    if split:  # identical terms, split before the first night
        base = p["contracts"][0]
        boundary = (start + timedelta(hours=12)).isoformat()
        p["contracts"][0:1] = [
            dict(base, revision_id="c0-a", end=boundary),
            dict(base, revision_id="c0-b", start=boundary),
        ]
    template = p["duty_templates"][0]
    template.update(kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:3])
    raw = parse_snapshot(p)
    generated = generate_catalogue(raw)
    p.update(candidates=generated["candidates"], work_terms=generated["work_terms"])
    p["demands"] = [
        dict(
            p["demands"][0],
            demand_id=f"night-{i}",
            start=(start + timedelta(days=i, hours=22)).isoformat(),
            end=(start + timedelta(days=i + 1, hours=2)).isoformat(),
        )
        for i in range(3)
    ]
    p["burden_history"] = [
        {
            "person_id": f"p{i}",
            "kind": "night",
            "seconds": 14400 if i == 0 else 0,
            "eligible_seconds": 57600 if i == 0 else 86400,
            "period_start": "2025-12-01",
            "period_end": "2026-01-01",
            "eligibility_evidence": p["policy_evidence"],
        }
        for i in range(2)
    ]
    return parse_snapshot(p)


def assignment(snapshot, result):
    people = {d.duty_id: d.person_id for d in snapshot.candidates}
    return sorted(people[i] for i in result.proposal.duty_ids)


def test_identical_split_contract_gives_the_same_plan():
    whole, split = payload(False), payload(True)
    a, b = solve(whole, 10), solve(split, 10)
    assert a.status == b.status == "OPTIMAL"
    assert assignment(whole, a) == assignment(split, b)
    assert a.objective_by_level == b.objective_by_level


def test_attainable_exposure_ignores_revisions_without_opportunity():
    split = payload(True)
    own = [d for d in split.candidates if d.person_id == "p0"]
    spans = lambda d: [(w.start, w.end) for w in d.work]  # noqa: E731
    # c0-a ends before any night: it contributes nothing, not its full cap.
    assert (
        capped_opportunity(split.contracts, "p0", split.period, own, spans) == 4 * 3600
    )
    whole = payload(False)
    own = [d for d in whole.candidates if d.person_id == "p0"]
    assert (
        capped_opportunity(whole.contracts, "p0", whole.period, own, spans) == 4 * 3600
    )
