"""L04 boundaries with hand-computed expectations (no database needed).

Fixture: one 10-day statutory grant on 2026-01-01 (usable until 2028-01-01,
exclusive), 8h days, hourly leave enabled, and a five-day obligation window
2026-01-01 to 2027-01-01.
"""

from datetime import date, timedelta

import pytest

from shift_scheduler.domain.compliance import SolverSnapshotV2
from shift_scheduler.validation.leave_accounting import account_leave
from tests.test_compliance_v2 import leave_event, leave_fixture


def event(identity, unit, day, hours=None, kind="take"):
    record = leave_event(identity, kind=kind, unit=unit, quantity=hours or 1)
    end_hour = 9 + (hours if unit == "hour" else 4 if unit == "half_day" else 8)
    record.update(
        effective_on=day.isoformat(),
        interval={
            "start": f"{day}T09:00:00+09:00",
            "end": f"{day}T{end_hour:02d}:00:00+09:00",
        },
    )
    return record


def day(i):
    return date(2026, 1, 6) + timedelta(days=i)


@pytest.mark.parametrize("hours,exceeded", [(40, False), (41, True)])
def test_hourly_leave_cap_is_five_days(hours, exceeded):
    events = [event(f"h{i}", "hour", day(i), 8) for i in range(5)]
    if hours == 41:
        events.append(event("h5", "hour", day(5), 1))
    findings = [
        f.message
        for f in account_leave(leave_fixture(events), date(2026, 6, 1))["findings"]
    ]
    assert ("Hourly annual-leave yearly cap exceeded" in findings) is exceeded


@pytest.mark.parametrize(
    "taken_on,valid", [(date(2027, 12, 31), True), (date(2028, 1, 1), False)]
)
def test_leave_is_usable_until_the_day_before_the_exclusive_expiry(taken_on, valid):
    data = leave_fixture()
    payload = data.model_dump(mode="json")
    # Extend policy and obligation so only the grant validity decides.
    payload["leave_policies"][0]["end"] = "2029-01-01T00:00:00+09:00"
    payload["leave_obligations"] = []
    payload["leave_records"] = [event("late", "day", taken_on)]
    report = account_leave(SolverSnapshotV2.model_validate(payload), date(2028, 6, 1))
    problems = [f for f in report["findings"] if f.status == "violation"]
    assert (not problems) is valid


@pytest.mark.parametrize(
    "halves,hours,status",
    [
        (10, 0, "fulfilled"),  # ten half-days = five days
        (9, 8, "at_risk"),  # hourly leave never counts toward the obligation
        (8, 0, "at_risk"),
    ],
)
def test_five_day_obligation_counts_half_days_not_hours(halves, hours, status):
    events = [event(f"d{i}", "half_day", day(i)) for i in range(halves)]
    if hours:
        events.append(event("h", "hour", day(halves), hours))
    obligation = account_leave(leave_fixture(events), date(2026, 12, 31))[
        "obligations"
    ][0]
    assert obligation["taken_half_days"] == halves
    assert obligation["status"] == status


def test_reversed_leave_does_not_count_toward_the_obligation():
    events = [event(f"d{i}", "half_day", day(i)) for i in range(10)]
    reversal = event("undo", "half_day", day(0), kind="reverse")
    reversal["related_event_id"] = "d0"
    report = account_leave(leave_fixture([*events, reversal]), date(2026, 12, 31))
    assert not [f for f in report["findings"] if f.status == "violation"]
    assert report["obligations"][0]["taken_half_days"] == 9
    assert report["obligations"][0]["status"] == "at_risk"
