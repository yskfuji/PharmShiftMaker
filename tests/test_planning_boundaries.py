from datetime import timedelta

import pytest

from shift_scheduler.domain.planning import Interval, Proposal, SolverSnapshot
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.test_reviewed_planning import snapshot


@pytest.mark.parametrize("lookahead", (7, 14, 28))
def test_lookahead_is_solved_but_period_volume_is_separate(lookahead):
    source = snapshot(2, lookahead + 1)
    period = Interval(
        start=source.period.start, end=source.period.start + timedelta(days=1)
    )
    data = SolverSnapshot.model_validate(
        {
            **source.model_dump(mode="json"),
            "period": period.model_dump(mode="json"),
            "lookahead_days": lookahead,
            "lookahead_demand_confirmed": True,
            "contracts": [
                c.model_copy(update={"period_max_seconds": 4 * 3600}).model_dump(
                    mode="json"
                )
                for c in source.contracts
            ],
        }
    )
    result = solve(data, 5)
    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert result.validation.publishable
    ids = set(result.proposal.duty_ids)
    assert any(d.duty_id in ids and d.start >= period.end for d in data.candidates)
    missing_future = Proposal(
        duty_ids=tuple(
            d.duty_id
            for d in data.candidates
            if d.duty_id in ids and d.start < period.end
        )
    )
    assert not validate(data, missing_future).publishable


def test_mid_period_contract_and_qualification_expiry_do_not_use_longest_profile():
    data = snapshot(1, 2)
    boundary = data.period.start + timedelta(days=1)
    first = data.contracts[0].model_copy(update={"end": boundary})
    second = data.contracts[0].model_copy(
        update={
            "revision_id": "changed",
            "start": boundary,
            "allowed_kinds": ("OTHER",),
        }
    )
    data = data.model_copy(update={"contracts": (first, second)})
    report = validate(data, Proposal(duty_ids=("p0d0", "p0d1")))
    assert any(
        f.rule_id == "contract.availability" and "p0d1" in f.subjects
        for f in report.findings
    )
    assert solve(data, 5).status == "INFEASIBLE"
    valid = snapshot(1, 1)
    assert validate(valid, Proposal(duty_ids=("p0d0",))).publishable
    expired = valid.capabilities[0].model_copy(
        update={"end": valid.candidates[0].start}
    )
    assert not validate(
        valid.model_copy(update={"capabilities": (expired,)}),
        Proposal(duty_ids=("p0d0",)),
    ).publishable


def test_agency_part_time_fixed_term_and_external_work_are_composable():
    data = snapshot(1, 1)
    contract = data.contracts[0].model_copy(
        update={
            "engagement": "agency",
            "fixed_term": True,
            "time_category": "part_time",
            "dispatch_evidence": data.policy_evidence,
            "dispatch_tasks": ("dispensing",),
        }
    )
    data = data.model_copy(update={"contracts": (contract,)})
    assert validate(data, Proposal(duty_ids=("p0d0",))).publishable
    external = data.candidates[0].model_copy(
        update={
            "duty_id": "other-employer",
            "source": "external",
            "external_employer_id": "other",
            "relationship_id": "external",
        }
    )
    report = validate(
        data.model_copy(update={"history": (external,)}), Proposal(duty_ids=("p0d0",))
    )
    assert any(f.rule_id == "overlap" for f in report.findings)
    unverified = contract.model_copy(update={"dispatch_evidence": None})
    assert not validate(
        data.model_copy(update={"contracts": (unverified,)}),
        Proposal(duty_ids=("p0d0",)),
    ).publishable


@pytest.mark.parametrize("seed", (0, 1, 7))
def test_id_order_and_seed_preserve_feasibility_and_optimal_objective(seed):
    data = snapshot(2, 3)
    first = solve(data, 5, seed=seed)
    payload = data.model_dump_json()
    # Bijective renaming changes no legal/availability condition.
    renamed = SolverSnapshot.model_validate_json(
        payload.replace("p0", "renamed-A").replace("p1", "renamed-B")
    )
    renamed = renamed.model_copy(
        update={
            "people": tuple(reversed(renamed.people)),
            "candidates": tuple(reversed(renamed.candidates)),
        }
    )
    second = solve(renamed, 5, seed=seed)
    assert first.status == second.status == "OPTIMAL"
    assert first.objective_by_level == second.objective_by_level


def test_ordinary_rest_does_not_require_paid_leave_balance():
    data = snapshot(1, 1).model_copy(update={"demands": ()})
    assert validate(data, Proposal()).publishable
    assert solve(data, 5).proposal.duty_ids == ()


def test_supervision_capacity_and_break_gap_are_real_time_constraints():
    data = snapshot(2, 1)
    supervised = data.capabilities[0].model_copy(update={"supervision_required": True})
    supervisor = data.capabilities[1].model_copy(update={"supervisor_capacity": 1})
    data = data.model_copy(update={"capabilities": (supervised, supervisor)})
    assert any(
        f.rule_id == "supervision"
        for f in validate(data, Proposal(duty_ids=("p0d0",))).findings
    )
    assert validate(data, Proposal(duty_ids=("p0d0", "p1d0"))).publishable
    duty = data.candidates[1]
    a, b = duty.start + timedelta(hours=1), duty.start + timedelta(hours=2)
    interrupted = duty.model_copy(
        update={
            "work": (
                Interval(start=duty.start, end=a),
                Interval(start=b, end=duty.end),
            ),
            "breaks": (Interval(start=a, end=b),),
        }
    )
    data = data.model_copy(update={"candidates": (data.candidates[0], interrupted)})
    report = validate(data, Proposal(duty_ids=("p0d0", "p1d0")))
    assert any(f.rule_id == "supervision" for f in report.findings)
