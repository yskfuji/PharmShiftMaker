"""F01: a duty spanning two calendar days or a change of agreement (no database).

- The daily 8h limit counts a continuous duty as work of the day it started
  (昭63.1.1基発1号: 継続勤務が二暦日にわたる場合…始業時刻の属する日の労働).
- Statutory holidays are calendar days (00:00-24:00), so only the hours on the
  holiday are holiday work; night work is decided by the clock (Art. 37(4)).
- A 36 agreement covers work during its own validity, so each part of the duty
  must be covered by the agreement in force at that time (not by the agreement
  of the start time).
Expected values are computed by hand in each test.
"""

from datetime import timedelta

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture

HOUR = 3600


def overnight(**changes):
    """p0 works Tue 20:00 - Wed 06:00 (10h, 8h scheduled) for employer A (V3 input)."""
    from tests.test_compliance_v3 import upgrade

    payload = upgrade(work_fixture([("A", 1, 20, 10, 8)], orders=(1,)))
    for key, value in changes.items():
        value(payload) if callable(value) else payload.update({key: value})
    data = parse_snapshot(payload)
    return data, account_work(data, list(data.candidates))


def test_daily_limit_counts_the_duty_as_work_of_its_start_day():
    _, result = overnight()
    # Counted per calendar day it would be 4h + 6h (no overtime); per start day, 10h -> 2h.
    assert sum(r["daily_overtime_seconds"] for r in result["trace"]) == 2 * HOUR
    assert [
        r["start"][11:16] for r in result["trace"] if r["daily_overtime_seconds"]
    ] == ["04:00"]


def test_only_the_hours_on_a_statutory_holiday_are_holiday_work():
    def wednesday_holiday(payload):
        start = payload["period"]["start"][:10]
        from datetime import date

        wednesday = (date.fromisoformat(start) + timedelta(days=2)).isoformat()
        for e in payload["employments"]:
            e["statutory_holidays"] = sorted(set(e["statutory_holidays"]) | {wednesday})

    _, result = overnight(holiday=wednesday_holiday)
    by_day = {}
    for r in result["trace"]:
        by_day[r["date"]] = by_day.get(r["date"], 0) + r["holiday_seconds"]
    assert sorted(by_day.values()) == [0, 6 * HOUR]  # Tuesday 20-24 is not holiday work


def split_agreement(payload, keep_second=True):
    """The employment of A is revised at Wednesday 00:00 with a new agreement 36-A2."""
    from datetime import datetime

    boundary = (
        datetime.fromisoformat(payload["period"]["start"]) + timedelta(days=2)
    ).isoformat()
    before = dict(payload["employments"][0], end=boundary)
    after = dict(
        payload["employments"][0],
        revision_id="emp-A2",
        start=boundary,
        agreement_id="36-A2",
    )
    payload["employments"] = [before, after]
    first = dict(payload["agreements"][0], end=boundary)
    second = dict(payload["agreements"][0], agreement_id="36-A2", start=boundary)
    payload["agreements"] = [first, second] if keep_second else [first]
    for term in payload["work_terms"]:
        term["employment_revision_ids"] = ["emp-A", "emp-A2"]


def lacks_agreement(result):
    return [
        f.message
        for f in result["findings"]
        if "lacks an effective employer agreement" in f.message
    ]


def test_overtime_after_midnight_is_covered_by_the_agreement_in_force_then():
    # The overtime (Wed 04:00-06:00) falls under the agreement starting Wed 00:00.
    _, result = overnight(agreements=lambda p: split_agreement(p, keep_second=True))
    assert lacks_agreement(result) == []


def test_the_start_time_agreement_does_not_cover_work_after_it_ends():
    # Only the agreement ending Wed 00:00 exists: the overtime at 04:00 is not covered,
    # although the duty started while that agreement was in force.
    _, result = overnight(agreements=lambda p: split_agreement(p, keep_second=False))
    assert lacks_agreement(result) != []
