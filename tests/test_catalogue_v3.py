from datetime import timedelta
from itertools import product

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import Proposal
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.test_compliance_v2 import v2
from tests.test_compliance_v3 import upgrade


def data():
    old = v2()
    payload = upgrade(old)
    ev = old.policy_evidence.model_dump(mode="json")
    payload.update(
        catalogue_evidence=ev,
        fairness_history_evidence=ev,
        rule_reviews=[
            {
                "review_id": "review",
                "rule_id": old.rule_revision,
                "source_url": "synthetic:test",
                "provision": "general",
                "transitional_provision": "none in synthetic case",
                "reviewed_on": "2026-01-01",
                "next_review_on": "2026-02-01",
                "evidence": ev,
                "start": old.context.start,
                "end": old.context.end,
            }
        ],
        duty_templates=[
            {
                "template_id": "day",
                "kind": "DAY",
                "task": "dispensing",
                "location": "main",
                "dates": [
                    (old.period.start + timedelta(days=i)).date() for i in range(7)
                ],
                "start_second": 9 * 3600,
                "duration_seconds": 4 * 3600,
                "work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
                "scheduled_work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
            }
        ],
    )
    intermediate = SolverSnapshotV3.model_validate(payload)
    generated = generate_catalogue(intermediate)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    return parse_snapshot(payload)


def test_complete_catalogue_and_exact_lexicographic_solver_match_enumeration():
    snapshot = data()
    # One designated holiday is legally unavailable without a holiday agreement;
    # lower the demand on that day explicitly for the positive control.
    holidays = set(snapshot.employments[0].statutory_holidays)
    snapshot = snapshot.model_copy(
        update={
            "demands": tuple(
                d for d in snapshot.demands if d.start.date() not in holidays
            )
        }
    )
    feasible = []
    ids = [d.duty_id for d in snapshot.candidates]
    for bits in product((False, True), repeat=len(ids)):
        proposal = Proposal(
            duty_ids=tuple(i for i, b in zip(ids, bits, strict=True) if b)
        )
        if validate(snapshot, proposal).publishable:
            feasible.append(set(proposal.duty_ids))
    assert feasible
    result = solve(snapshot, 5)
    assert result.status == "OPTIMAL", result
    assert set(result.proposal.duty_ids) in feasible
    assert result.proven_levels == 4
    assert result.fairness_revision == "eligible-night-holiday-v3"


def test_candidate_deletion_is_detected_even_with_old_complete_flag():
    snapshot = data()
    bad = snapshot.model_copy(
        update={
            "candidates": snapshot.candidates[:-1],
            "work_terms": snapshot.work_terms[:-1],
        }
    )
    report = validate(bad, Proposal())
    assert any(f.rule_id == "catalogue.v3" for f in report.findings)


def test_fixed_history_duty_is_not_required_again_in_candidate_catalogue():
    snapshot = data()
    fixed = snapshot.model_copy(
        update={
            "history": (snapshot.candidates[0],),
            "candidates": snapshot.candidates[1:],
        }
    )
    report = validate(fixed, Proposal())
    assert not [f for f in report.findings if f.rule_id == "catalogue.v3"]


def test_duplicate_patterns_do_not_inflate_union_opportunities():
    from shift_scheduler.optimizer.fairness import burden_spans, union_seconds

    snapshot = data()
    duty = snapshot.candidates[0].model_copy(
        update={"start": snapshot.candidates[0].start}
    )
    spans = burden_spans(duty, "holiday", {duty.start.date()})
    assert union_seconds(spans * 20) == 4 * 3600


def test_expired_tighter_consecutive_rule_does_not_reject_legal_new_contract():
    snapshot = data()
    old = snapshot.contracts[0]
    # Current window is Mon-Sun, Sunday is a designated holiday.
    former = old.model_copy(
        update={
            "revision_id": "old-tight",
            "end": snapshot.period.start,
            "max_consecutive_days": 1,
        }
    )
    current = old.model_copy(
        update={"start": snapshot.period.start, "max_consecutive_days": 6}
    )
    snapshot = snapshot.model_copy(
        update={
            "contracts": (former, current),
            "demands": tuple(d for d in snapshot.demands if d.start.weekday() != 6),
        }
    )
    result = solve(snapshot, 5)
    assert result.status == "OPTIMAL", result
    assert validate(snapshot, result.proposal).publishable


def test_night_fairness_objective_matches_independent_64_assignment_oracle():
    from fractions import Fraction

    payload = data().model_dump(mode="json")
    payload["people"].append({"person_id": "p1", "name": "Synthetic second person"})
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
    for contract in payload["contracts"]:
        contract["allowed_kinds"] = ["NIGHT"]
    template = payload["duty_templates"][0]
    template.update(kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:3])
    raw = parse_snapshot(payload)
    generated = generate_catalogue(raw)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    payload["demands"] = [
        dict(
            payload["demands"][0],
            demand_id=f"night-{i}",
            start=(raw.period.start + timedelta(days=i, hours=22)).isoformat(),
            end=(raw.period.start + timedelta(days=i + 1, hours=2)).isoformat(),
        )
        for i in range(3)
    ]
    payload["burden_history"] = [
        {
            "person_id": f"p{i}",
            "kind": "night",
            "seconds": 14400 if i == 0 else 0,
            "eligible_seconds": 57600,
            "period_start": "2025-12-01",
            "period_end": "2026-01-01",
            "eligibility_evidence": payload["policy_evidence"],
        }
        for i in range(2)
    ]
    snapshot = parse_snapshot(payload)

    def objective(ids):
        counts = [
            sum(
                d.duty_id in ids and d.person_id == f"p{i}" for d in snapshot.candidates
            )
            for i in range(2)
        ]
        # Independent hand calculation: 4h history exposure + 3 possible 4h
        # nights gives 7 units. p0 already worked one historical unit, p1 none.
        rates = [Fraction(counts[0] + 1, 7), Fraction(counts[1], 7)]
        return max(rates), abs(rates[0] - rates[1])

    feasible = []
    for bits in product((False, True), repeat=6):
        ids = tuple(
            d.duty_id
            for d, chosen in zip(snapshot.candidates, bits, strict=True)
            if chosen
        )
        if validate(snapshot, Proposal(duty_ids=ids)).publishable:
            feasible.append(objective(ids))
    result = solve(snapshot, 5)
    assert result.status == "OPTIMAL" and result.proven_levels == 4
    assert (
        objective(result.proposal.duty_ids)
        == min(feasible)
        == (Fraction(2, 7), Fraction(0))
    )
