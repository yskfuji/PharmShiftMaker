"""Independent chronological examples, including lawful zero-hour conversion."""

from datetime import date
from itertools import permutations

import pytest
from pydantic import ValidationError

from shift_scheduler.domain.compliance import LeaveRecord
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.validation.leave_accounting import account_leave
from tests.test_compliance_v2 import leave_event, leave_fixture
from tests.test_compliance_v3 import upgrade


def fixture(events, conversion_quantity=2):
    payload = upgrade(leave_fixture(events))
    old = payload["leave_policies"][0]
    old["end"] = "2026-02-01T00:00:00+09:00"
    new = dict(
        old,
        policy_id="new",
        start=old["end"],
        end="2027-01-01T00:00:00+09:00",
        hours_per_day=4,
    )
    payload["leave_policies"].append(new)
    payload["leave_records"].append(
        dict(
            leave_event("conversion", "conversion", "hour", conversion_quantity),
            effective_on="2026-02-01",
            policy_id="new",
            interval=None,
            conversion_old_hours=8,
            conversion_new_hours=4,
        )
    )
    payload["ledger_recordings"].append(
        {
            "recording_id": "conversion",
            "object_kind": "leave_record",
            "object_id": "conversion",
            "external_event_id": "hr:conversion",
            "external_revision": 1,
            "recorded_at": "2026-02-01T00:00:00+09:00",
            "evidence": payload["policy_evidence"],
        }
    )
    return payload


def hourly():
    return dict(
        leave_event("hours", unit="hour", quantity=5),
        interval={
            "start": "2026-01-06T09:00:00+09:00",
            "end": "2026-01-06T14:00:00+09:00",
        },
    )


@pytest.mark.parametrize("reverse_order", [False, True])
def test_conversion_replays_effective_dates_not_import_order(reverse_order):
    payload = fixture([hourly()])
    if reverse_order:
        payload["leave_records"].reverse()
    data = SolverSnapshotV3.model_validate(payload)
    report = account_leave(data, date(2026, 2, 2))
    # 10 - 5/8 = 9 + 3/8; ceil(3/8 * 4) = 2 hours; 9 + 2/4 = 9.5.
    assert report["balances"][0]["remaining_days"] == {
        "numerator": 19,
        "denominator": 2,
    }
    assert not report["findings"]
    before = account_leave(data, date(2026, 1, 31), effective_at=date(2026, 1, 31))
    assert before["balances"][0]["remaining_days"] == {
        "numerator": 75,
        "denominator": 8,
    }


def test_whole_day_conversion_is_legal_and_zero_consumption_is_not():
    data = SolverSnapshotV3.model_validate(fixture([], 0))
    report = account_leave(data, date(2026, 2, 2))
    assert not report["findings"]
    assert report["balances"][0]["remaining_days"] == {
        "numerator": 10,
        "denominator": 1,
    }
    with pytest.raises(ValidationError):
        LeaveRecord.model_validate(leave_event("zero", quantity=0))


def test_causal_replay_of_reservation_take_reverse_independent_of_import_order():
    events = [
        leave_event("z-reservation", "reserve"),
        leave_event("a-actual", related_event_id="z-reservation"),
        leave_event("b-reverse", "reverse", related_event_id="a-actual"),
    ]
    for order in permutations(events):
        data = SolverSnapshotV3.model_validate(upgrade(leave_fixture(order)))
        report = account_leave(data, date(2026, 2, 2))
        assert not report["findings"]
        assert report["balances"][0]["remaining_days"] == {
            "numerator": 10,
            "denominator": 1,
        }


def test_late_grant_reduction_preserves_deficit_and_original_history():
    payload = fixture([hourly()])
    payload["grant_amendments"] = [
        {
            "amendment_id": "reduction",
            "person_id": "p0",
            "account_id": "g",
            "external_event_id": "hr:g",
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": "2026-02-15",
            "recorded_at": "2026-03-01T00:00:00+09:00",
            "granted_days": 0,
            "statutory_days": 0,
            "reason": "external HR correction",
            "evidence": payload["policy_evidence"],
        }
    ]
    data = SolverSnapshotV3.model_validate(payload)
    before = account_leave(data, date(2026, 2, 2), effective_at=date(2026, 2, 2))
    assert before["balances"][0]["remaining_days"] == {
        "numerator": 19,
        "denominator": 2,
    }
    after = account_leave(data, date(2026, 3, 2))
    assert after["balances"][0]["remaining_days"] == {"numerator": -1, "denominator": 2}
    assert after["requires_hr_reconciliation"]
    assert any("underfunded" in f.message for f in after["findings"])
    assert data.leave_accounts[0].granted_days == 10


def test_reverse_before_source_is_reconciliation_not_silently_reordered():
    reverse = dict(
        leave_event("reverse", "reverse", related_event_id="actual"),
        effective_on="2026-01-05",
    )
    report = account_leave(
        SolverSnapshotV3.model_validate(
            upgrade(leave_fixture([leave_event("actual"), reverse]))
        ),
        date(2026, 2, 2),
    )
    assert report["requires_hr_reconciliation"]
    assert any("precedes" in f.message for f in report["findings"])
