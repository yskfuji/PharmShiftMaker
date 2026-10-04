"""A qualification renewed as consecutive records stays continuous; a gap does not."""

from datetime import timedelta

import pytest

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import Proposal
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.test_contract_revision_crossing import night_payload


def snapshot_with_capabilities(split_at_hours=None, gap_hours=0, expire_first=False):
    payload, _ = night_payload(split=False)
    start = parse_snapshot(payload).period.start
    payload["demands"] = [dict(d, minimum=1) for d in payload["demands"]]
    if split_at_hours is not None:
        base = payload["capabilities"][0]
        boundary = start + timedelta(hours=split_at_hours)
        first = dict(base, end=boundary.isoformat())
        second = dict(base, start=(boundary + timedelta(hours=gap_hours)).isoformat())
        if (
            expire_first
        ):  # evidence of the earlier record already expired before it ended
            first["evidence"] = dict(
                base["evidence"],
                valid_until=(boundary - timedelta(hours=1)).isoformat(),
            )
        payload["capabilities"] = [first, second, *payload["capabilities"][1:]]
    return parse_snapshot(payload)


def crossing(snapshot, split_at_hours):
    boundary = snapshot.period.start + timedelta(hours=split_at_hours)
    return next(d for d in snapshot.candidates if d.start < boundary < d.end)


def findings(snapshot, duty):
    return [
        f.rule_id
        for f in validate(snapshot, Proposal(duty_ids=(duty.duty_id,))).findings
        if f.rule_id == "capability"
    ]


def test_renewal_at_midnight_keeps_the_night_duty_qualified():
    snapshot = snapshot_with_capabilities(split_at_hours=24)
    assert findings(snapshot, crossing(snapshot, 24)) == []
    result = solve(snapshot, 10)
    assert (
        result.status == "OPTIMAL"
        and crossing(snapshot, 24).duty_id in result.proposal.duty_ids
    )


@pytest.mark.parametrize("gap_hours,expire_first", [(1, False), (0, True)])
def test_gap_or_expired_evidence_is_not_qualified(gap_hours, expire_first):
    snapshot = snapshot_with_capabilities(
        split_at_hours=24, gap_hours=gap_hours, expire_first=expire_first
    )
    assert findings(snapshot, crossing(snapshot, 24)) == ["capability"]


def test_single_record_behaviour_is_unchanged():
    snapshot = snapshot_with_capabilities()
    for duty in snapshot.candidates:
        assert findings(snapshot, duty) == []


def test_supervision_is_still_required_when_a_trainee_capability_is_renewed():
    """Review finding: segments must also split at capability renewals, otherwise a
    trainee's supervision requirement was skipped on the straddling segment."""
    results = []
    for split in (None, 24):
        payload, _ = night_payload(split=False)
        payload["capabilities"] = [
            dict(c, supervision_required=True) for c in payload["capabilities"]
        ]
        start = parse_snapshot(payload).period.start
        payload["demands"] = [dict(d, minimum=1) for d in payload["demands"]]
        if split is not None:
            base = payload["capabilities"][0]
            boundary = (start + timedelta(hours=split)).isoformat()
            payload["capabilities"] = [
                dict(base, end=boundary),
                dict(base, start=boundary),
                *payload["capabilities"][1:],
            ]
        snapshot = parse_snapshot(payload)
        duty = crossing(snapshot, 24)
        rules = sorted(
            {
                f.rule_id
                for f in validate(snapshot, Proposal(duty_ids=(duty.duty_id,))).findings
            }
        )
        results.append((rules, solve(snapshot, 10).status))
    assert results[0] == results[1]
    assert "supervision" in results[1][0] and results[1][1] == "INFEASIBLE"
