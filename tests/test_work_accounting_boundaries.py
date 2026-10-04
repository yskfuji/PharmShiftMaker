"""L02 boundaries with hand-computed expectations (no database needed).

Fixture calendar: the period starts Monday 2026-01-05, weeks start on Monday,
and Sundays are statutory holidays. Expected values are written out by hand,
never taken from production helpers.
"""

from datetime import datetime, timedelta

import pytest

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade
from tests.test_work_cap_boundaries import report

SECOND = 1 / 3600  # one second expressed in the fixture's hour unit


def run(specs, **agreement):
    payload = upgrade(work_fixture(specs, orders=(1,)))
    payload["agreements"][0].update(agreement)
    data = parse_snapshot(payload)
    return account_work(data, list(data.candidates))


def total(result, key):
    return sum(r[key] for r in result["trace"])


@pytest.mark.parametrize("delta,weekly", [(-1, 0), (0, 0), (1, 1)])
def test_weekly_40_hours_to_the_second(delta, weekly):
    # Week total = 40h + delta: Mon-Fri scheduled days (Friday shortened when
    # delta < 0) plus a Saturday of delta seconds when delta > 0.
    friday = 8 + (delta * SECOND if delta < 0 else 0)
    specs = [("A", i, 9, 8, 8) for i in range(4)] + [("A", 4, 9, friday, friday)]
    if delta > 0:
        specs.append(("A", 5, 9, delta * SECOND, 0))
    result = run(specs)
    assert total(result, "weekly_overtime_seconds") == weekly
    assert total(result, "daily_overtime_seconds") == 0


@pytest.mark.parametrize("delta,daily", [(-1, 0), (0, 0), (1, 1)])
def test_daily_8_hours_to_the_second(delta, daily):
    hours = 8 + delta * SECOND
    result = run([("A", 0, 9, hours, min(8, hours))])
    assert total(result, "daily_overtime_seconds") == daily


def test_overnight_into_sunday_holiday_splits_holiday_work():
    # Saturday 22:00 -> Sunday 06:00; Sunday 2026-01-11 is a statutory holiday.
    result = run([("A", 5, 22, 8, 0)])
    assert total(result, "holiday_seconds") == 6 * 3600
    assert total(result, "work_seconds") == 8 * 3600
    # The two Saturday hours are ordinary work: no daily excess.
    assert total(result, "daily_overtime_seconds") == 0


def test_holiday_work_without_permission_is_a_finding():
    permitted = run([("A", 6, 9, 4, 0)], holiday_work_permitted=True)
    refused = run([("A", 6, 9, 4, 0)], holiday_work_permitted=False)
    assert total(permitted, "holiday_seconds") == 4 * 3600
    assert not [f for f in permitted["findings"] if f.status == "violation"]
    assert [f for f in refused["findings"] if f.status == "violation"]


def monthly_history(delta):
    payload = upgrade(work_fixture([]))
    payload["history"] = []
    days = [
        "2025-12-01",
        "2025-12-02",
        "2025-12-03",
        "2025-12-04",
        "2025-12-05",
        "2025-12-08",
        "2025-12-09",
        "2025-12-10",
        "2025-12-11",
    ]
    for i, day in enumerate(days):
        start = datetime.fromisoformat(f"{day}T07:00:00+09:00")
        end = start + timedelta(hours=13, seconds=delta if i == len(days) - 1 else 0)
        identity = f"h{i}"
        payload["history"].append(
            {
                "duty_id": identity,
                "person_id": "p0",
                "relationship_id": "A",
                "kind": "DAY",
                "location": "main",
                "task": "dispensing",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "work": [{"start": start.isoformat(), "end": end.isoformat()}],
                "source": "external",
                "external_employer_id": "A",
            }
        )
        payload["work_terms"].append(
            {
                "duty_id": identity,
                "employment_revision_id": "emp-A",
                "scheduled_work": [],
            }
        )
    return report(payload)


@pytest.mark.parametrize("delta,flagged", [(-1, False), (0, False), (1, True)])
def test_monthly_45_hours_is_inclusive(delta, flagged):
    # Nine 13h days, Mon-Fri only: 5h daily excess each = 45h (+delta), no weekly excess.
    result = monthly_history(delta)
    assert total(result, "overtime_seconds") == 45 * 3600 + delta
    assert (
        bool(
            [
                f
                for f in result["findings"]
                if f.message == "Monthly agreement limit exceeded"
            ]
        )
        is flagged
    )
