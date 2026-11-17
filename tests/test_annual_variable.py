"""L02: one-year variable working hours (Art. 32-4) with the agreed calendar.

Sources: Labour Standards Act Art. 32-4, 32-4-2, 36(4)(5); Enforcement Regulations
Art. 12-4; 平6.1.4基発1号 (overtime in three stages); 平11.1.29基発45号 (280 days in a
leap year too, weeks above 48h counted where they begin, fixed days not changeable);
平30.12.28基発1228第15号 第2問3 (42h/320h). Expected values are computed by hand.
The fixture week is Mon 2026-01-05 .. Sun 2026-01-11 (Sundays are statutory holidays).
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import AnnualCalendar
from shift_scheduler.validation.work_accounting import (
    _allocate_annual,
    account_work,
    annual_calendar_problems,
)
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade
from tests.test_variable_hours import rows

HOUR = 3600
EVIDENCE = {
    "reference": "synthetic agreement",
    "status": "verified",
    "verified_by": "HR",
}


def january(overrides=None):
    """Weekdays of January 2026 at 8h, with per-date overrides (0 removes the day)."""
    days = {}
    day = date(2026, 1, 1)
    while day < date(2026, 2, 1):
        if day.weekday() < 5:
            days[day.isoformat()] = 8 * HOUR
        day += timedelta(days=1)
    for key, seconds in (overrides or {}).items():
        if seconds:
            days[key] = seconds
        else:
            days.pop(key, None)
    return [{"day": k, "seconds": v} for k, v in sorted(days.items())]


def open_months(first="2026-02-01", months=11, working_days=20, hours=8):
    result, start = [], date.fromisoformat(first)
    for _ in range(months):
        end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        result.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "working_days": working_days,
                "total_seconds": working_days * hours * HOUR,
            }
        )
        start = end
    return result


def calendar(**change):
    return {
        "calendar_id": "cal-2026",
        "employer_id": "A",
        "establishment_id": "site-A",
        "start": "2026-01-01",
        "end": "2027-01-01",
        "first_period_end": "2026-02-01",
        "week_start": 0,
        "days": january(),
        "segments": open_months(),
        "evidence": EVIDENCE,
        **change,
    }


def annual_payload(specs, **change):
    payload = upgrade(work_fixture(specs, orders=(1,)))
    payload["employments"][0].update(
        working_time_system="annual_variable", annual_calendar_id="cal-2026"
    )
    payload["annual_calendars"] = [calendar(**change)]
    return payload


def account(payload):
    data = parse_snapshot(payload)
    return account_work(data, list(data.candidates))


def total(result, key):
    return sum(r[key] for r in result["trace"])


def messages(result):
    return [f.message for f in result["findings"]]


# --- overtime in three stages ------------------------------------------------------


def test_a_ten_hour_calendar_day_has_no_overtime():
    result = account(
        annual_payload([("A", 0, 9, 10, 10)], days=january({"2026-01-05": 10 * HOUR}))
    )
    assert messages(result) == []
    assert total(result, "overtime_seconds") == 0


def test_beyond_an_eight_hour_calendar_day_is_daily_overtime():
    result = account(annual_payload([("A", 0, 9, 10, 10)]))
    assert total(result, "daily_overtime_seconds") == 2 * HOUR


def test_beyond_the_calendar_week_is_weekly_overtime():
    # Calendar Mon-Fri 9h = 45h (limit 45h); Saturday is a rest day (limit 8h/day).
    # Work Mon-Fri 9h and Saturday 8h: no daily overtime; week 53h -> 8h weekly.
    nine = {f"2026-01-0{d}": 9 * HOUR for d in range(5, 10)}
    specs = [("A", d, 9, 9, 9) for d in range(5)] + [("A", 5, 9, 8, 8)]
    result = account(annual_payload(specs, days=january(nine)))
    assert (
        total(result, "daily_overtime_seconds"),
        total(result, "weekly_overtime_seconds"),
    ) == (0, 8 * HOUR)


def short_calendar(days, **change):
    values = {
        "calendar_id": "c",
        "employer_id": "A",
        "establishment_id": "s",
        "start": "2026-01-05",
        "end": "2026-02-09",
        "first_period_end": "2026-02-09",
        "week_start": 0,
        "days": [{"day": d, "seconds": s} for d, s in days.items()],
        "evidence": EVIDENCE,
        **change,
    }
    return AnnualCalendar(**values)


def mon_to(first, count, hours):
    start = date.fromisoformat(first)
    return {(start + timedelta(days=i)).isoformat(): hours * HOUR for i in range(count)}


def test_beyond_the_period_frame_is_period_overtime():
    # Jan 5 - Feb 9 (35 days): frame 144000 x 35 / 7 = 200h. Calendar weeks: 48h
    # (Mon-Sat 8h), 32h (Mon-Thu), then 40h x 3 = 200h in total. Work also on the
    # Friday of week 2 (8h): the day stays within 8h and that week within 40h, but
    # the period reaches 208h -> 8h period overtime, on the last day worked.
    days = {
        **mon_to("2026-01-05", 6, 8),
        **mon_to("2026-01-12", 4, 8),
        **mon_to("2026-01-19", 5, 8),
        **mon_to("2026-01-26", 5, 8),
        **mon_to("2026-02-02", 5, 8),
    }
    cal = short_calendar(days)
    assert annual_calendar_problems(cal) == []
    worked = [(d, 8, True) for d in sorted(days)] + [("2026-01-16", 8, False)]
    allocated = _allocate_annual(rows(worked), [cal], 0)
    assert sum(r["daily_overtime"] + r["weekly_overtime"] for r in allocated) == 0
    assert [
        (r["day"].isoformat(), r["period_overtime"])
        for r in allocated
        if r["period_overtime"]
    ] == [("2026-02-06", 8 * HOUR)]


# --- statutory limits of the calendar ---------------------------------------------------


def six_on_one_off(first, count, hours):
    """`count` working days, six in a row then one rest day."""
    result, day = {}, date.fromisoformat(first)
    while len(result) < count:
        if (day - date.fromisoformat(first)).days % 7 != 6:
            result[day.isoformat()] = hours * HOUR
        day += timedelta(days=1)
    return result


@pytest.mark.parametrize(
    ("days", "change", "problem"),
    [
        (mon_to("2026-01-05", 1, 11), {}, "More than 10 hours scheduled on 2026-01-05"),
        (
            mon_to("2026-01-05", 6, 9),
            {},
            "More than 52 hours scheduled in the week from 2026-01-05",
        ),
        (mon_to("2026-01-05", 7, 8), {}, "7 consecutive working days from 2026-01-05"),
        (
            mon_to("2026-01-05", 5, 8)
            | mon_to("2026-01-12", 5, 8)
            | mon_to("2026-01-19", 5, 8)
            | mon_to("2026-01-26", 5, 8)
            | mon_to("2026-02-02", 5, 8)
            | {"2026-01-10": 1 * HOUR},
            {},
            "Scheduled hours exceed the frame of 40 hours a week on average",
        ),
    ],
)
def test_calendar_limits(days, change, problem):
    assert problem in annual_calendar_problems(short_calendar(days, **change))


def test_twelve_days_in_a_row_only_in_a_special_period():
    # Tue Jan 6 - Sat Jan 17: 12 days, with Mon Jan 5 and Sun Jan 18 off, so each
    # week (Mon-Sun) of the special period keeps one rest day (Regulations 12-4(5)).
    days = mon_to("2026-01-06", 12, 4)
    assert "12 consecutive working days from 2026-01-06" in annual_calendar_problems(
        short_calendar(days)
    )
    special = {"special_periods": [{"start": "2026-01-05", "end": "2026-01-19"}]}
    assert annual_calendar_problems(short_calendar(days, **special)) == []
    longer = mon_to("2026-01-06", 13, 4)
    assert "13 consecutive working days from 2026-01-06" in annual_calendar_problems(
        short_calendar(longer, **special)
    )


def test_every_week_of_a_special_period_keeps_a_rest_day():
    # Mon Jan 5 - Fri Jan 16 (12 days): the week Jan 5-11 has no rest day.
    special = {"special_periods": [{"start": "2026-01-05", "end": "2026-01-19"}]}
    problems = annual_calendar_problems(
        short_calendar(mon_to("2026-01-05", 12, 4), **special)
    )
    assert "No rest day in the week from 2026-01-05 of a special period" in problems


def test_a_divided_period_needs_a_first_period_of_a_month():
    with pytest.raises(ValueError, match="at least one month"):
        AnnualCalendar(
            **calendar(
                first_period_end="2026-01-20",
                days=[d for d in january() if d["day"] < "2026-01-20"],
                segments=[
                    {
                        "start": "2026-01-20",
                        "end": "2027-01-01",
                        "working_days": 200,
                        "total_seconds": 200 * 8 * HOUR,
                    }
                ],
            )
        )


def test_overlapping_calendars_of_one_person_are_not_accounted():
    payload = annual_payload([("A", 0, 9, 8, 8)])
    second = dict(
        payload["employments"][0],
        revision_id="emp-A2",
        start="2026-01-08T00:00:00+09:00",
        annual_calendar_id="cal-2026b",
    )
    payload["employments"][0]["end"] = "2026-01-08T00:00:00+09:00"
    payload["employments"].append(second)
    payload["annual_calendars"].append(
        calendar(
            calendar_id="cal-2026b",
            start="2026-01-05",
            end="2026-03-01",
            first_period_end="2026-03-01",
            days=[d for d in january() if d["day"] >= "2026-01-05"],
            segments=[],
        )
    )
    result = account(payload)
    assert any("calendars of one person overlap" in m for m in messages(result))


def test_work_already_beyond_the_calendar_only_closes_the_day():
    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.planning import _calendar_and_flex_limits

    # Monday already has 10h of work (history) on an 8h day: a further Monday
    # duty cannot be added, but the model stays solvable.
    data = parse_snapshot(annual_payload([("A", 0, 9, 8, 8), ("A", 0, 18, 2, 2)]))
    first, second = data.candidates
    model = cp_model.CpModel()
    x = {second.duty_id: model.new_bool_var(second.duty_id)}
    _calendar_and_flex_limits(
        model,
        data,
        "p0",
        [second],
        [first.model_copy(update={"end": first.end + timedelta(hours=2)})],
        x,
        set(x),
    )
    solver = cp_model.CpSolver()
    assert solver.solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    model.add(x[second.duty_id] == 1)
    assert cp_model.CpSolver().solve(model) == cp_model.INFEASIBLE


def one_year(days, **change):
    values = {
        "calendar_id": "y",
        "employer_id": "A",
        "establishment_id": "s",
        "start": "2026-01-01",
        "end": "2027-01-01",
        "first_period_end": "2027-01-01",
        "week_start": 3,
        "days": [{"day": d, "seconds": s} for d, s in days.items()],
        "evidence": EVIDENCE,
        **change,
    }
    return AnnualCalendar(**values)


def test_at_most_280_working_days_a_year():
    # Six days a week at 7h: 42h weeks, 281 days x 7h = 1967h < frame 2085.7h.
    assert "More than 280 working days in the period" in annual_calendar_problems(
        one_year(six_on_one_off("2026-01-01", 281, 7))
    )
    assert (
        annual_calendar_problems(one_year(six_on_one_off("2026-01-01", 280, 7))) == []
    )


def test_the_day_limit_is_prorated_below_one_year():
    # Four months (Jan 1 - May 1, 120 days): 280 x 120 / 365 = 92.05 -> 92 days.
    four_months = {"end": "2026-05-01", "first_period_end": "2026-05-01"}
    assert "More than 92 working days in the period" in annual_calendar_problems(
        one_year(six_on_one_off("2026-01-01", 93, 5), **four_months)
    )
    assert (
        annual_calendar_problems(
            one_year(six_on_one_off("2026-01-01", 92, 5), **four_months)
        )
        == []
    )


def test_weeks_above_48_hours():
    # Weeks from Thursday (week_start 3). Six days of 8.5h = 51h: four such weeks in
    # a row break "at most three consecutive"; they also exceed three in the first
    # three months.
    heavy = {}
    for w in range(4):
        heavy |= {
            k: int(8.5 * HOUR)
            for k in six_on_one_off(
                (date(2026, 1, 1) + timedelta(days=7 * w)).isoformat(), 6, 1
            )
        }
    problems = annual_calendar_problems(one_year(heavy))
    assert (
        "More than three consecutive weeks above 48 hours up to 2026-01-22" in problems
    )
    assert (
        "More than three weeks above 48 hours in the three months from 2026-01-01"
        in problems
    )


@pytest.mark.parametrize(
    "change",
    [
        {"end": "2026-02-01"},  # exactly one month: not longer
        {"end": "2027-01-02", "first_period_end": "2027-01-02"},  # longer than one year
        {"first_period_end": "2026-01-01"},  # first period empty
        {
            "segments": [
                {
                    "start": "2026-03-01",
                    "end": "2027-01-01",
                    "working_days": 1,
                    "total_seconds": 1,
                }
            ]
        },
        {
            "segments": [
                {
                    "start": "2026-02-01",
                    "end": "2026-02-20",
                    "working_days": 1,
                    "total_seconds": 1,
                },
                {
                    "start": "2026-02-20",
                    "end": "2027-01-01",
                    "working_days": 1,
                    "total_seconds": 1,
                },
            ]
        },
        {
            "days": january() + [{"day": "2026-02-02", "seconds": 8 * HOUR}]
        },  # a day in an open segment
    ],
)
def test_invalid_calendar_structures_are_refused(change):
    with pytest.raises(ValueError):
        AnnualCalendar(**calendar(**change))


def test_a_segment_is_fixed_30_days_ahead_with_its_agreed_totals():
    february = [
        {"day": d, "seconds": 8 * HOUR}
        for d in (date(2026, 2, 2) + timedelta(days=i) for i in range(27))
        if d.weekday() < 5
    ]
    february = [
        {"day": d["day"].isoformat(), "seconds": d["seconds"]} for d in february
    ]
    fixed = dict(
        open_months(months=1)[0],
        working_days=len(february),
        total_seconds=len(february) * 8 * HOUR,
        fixed_on="2026-01-02",
        consent=EVIDENCE,
    )
    ok = calendar(
        days=january() + february, segments=[fixed] + open_months("2026-03-01", 10)
    )
    assert AnnualCalendar(**ok).fixed_end == date(2026, 3, 1)
    with pytest.raises(ValueError, match="30 days"):
        AnnualCalendar(
            **dict(
                ok,
                segments=[dict(fixed, fixed_on="2026-01-03")]
                + open_months("2026-03-01", 10),
            )
        )
    with pytest.raises(ValueError, match="agreed working days"):
        AnnualCalendar(
            **dict(
                ok,
                segments=[dict(fixed, working_days=1)] + open_months("2026-03-01", 10),
            )
        )


# --- inputs ---------------------------------------------------------------------------


def test_unverified_agreement_is_unverified():
    result = account(
        annual_payload([("A", 0, 9, 8, 8)], evidence={"reference": "draft"})
    )
    assert any(
        "calendar agreement or segment consent unverified" in m
        for m in messages(result)
    )


def test_planned_dates_must_be_fixed_day_by_day():
    # Period from Dec 1; the first period ends Jan 5, so the planned week lies in the
    # open segment from Jan 5.
    payload = annual_payload(
        [("A", 0, 9, 8, 8)],
        start="2025-12-01",
        end="2026-12-01",
        first_period_end="2026-01-05",
        days=[d for d in january() if d["day"] < "2026-01-05"],
        segments=[
            {
                "start": "2026-01-05",
                "end": "2026-12-01",
                "working_days": 200,
                "total_seconds": 200 * 8 * HOUR,
            }
        ],
    )
    assert any("outside the fixed part" in m for m in messages(account(payload)))


def test_the_input_must_hold_the_period_from_its_start():
    payload = annual_payload([("A", 0, 9, 8, 8)])
    payload["context"]["start"] = "2026-01-02T00:00:00+09:00"
    assert any("is not fully in the input" in m for m in messages(account(payload)))


def test_a_calendar_working_day_on_a_statutory_holiday_is_a_violation():
    result = account(
        annual_payload([("A", 0, 9, 8, 8)], days=january({"2026-01-11": 4 * HOUR}))
    )
    assert [
        f.status for f in result["findings"] if "statutory holiday" in f.message
    ] == ["violation"]


def test_calendar_limit_breaches_are_violations():
    result = account(
        annual_payload([("A", 0, 9, 8, 8)], days=january({"2026-01-05": 11 * HOUR}))
    )
    assert [
        f.status for f in result["findings"] if "More than 10 hours" in f.message
    ] == ["violation"]


# --- 36 agreement: 42h a month and 320h a year ---------------------------------------------


def test_the_monthly_limit_is_42_hours():
    # Mon-Fri 15h (7h daily overtime each = 35h) and Saturday 8h (week 48h > 40h -> 8h
    # weekly): 43h in January. The agreement (45h) allows it under standard hours,
    # but one-year variable hours over more than three months are limited to 42h.
    specs = [("A", d, 9, 15, 8) for d in range(5)] + [("A", 5, 9, 8, 8)]
    annual = account(annual_payload(specs))
    assert total(annual, "overtime_seconds") == 43 * HOUR
    assert any(
        m.startswith("Monthly agreement limit exceeded (one-year variable")
        for m in messages(annual)
    )
    standard = account(upgrade(work_fixture(specs, orders=(1,))))
    assert not any(
        m.startswith("Monthly agreement limit exceeded") for m in messages(standard)
    )


# --- joining within the period (Art. 32-4-2) ----------------------------------------------


def test_a_joiner_is_settled_above_the_forty_hour_average():
    # Calendar Dec 1 2025 - Jan 12 2026 (42 days, frame 240h), scheduling Mon-Fri 10h
    # in the week of Jan 5 (50h). The person joins on Jan 5: 7 days, frame 40h. Work
    # 50h with no overtime counted -> 10h to settle when the period ends (Jan 12).
    days = [{"day": f"2026-01-0{d}", "seconds": 10 * HOUR} for d in range(5, 10)]
    payload = annual_payload(
        [("A", d, 9, 10, 10) for d in range(5)],
        start="2025-12-01",
        end="2026-01-12",
        first_period_end="2026-01-12",
        days=days,
        segments=[],
    )
    payload["employments"][0]["start"] = "2026-01-05T00:00:00+09:00"
    result = account(payload)
    assert total(result, "overtime_seconds") == 0
    assert [
        (s["frame_seconds"], s["worked_seconds"], s["settlement_seconds"])
        for s in result["settlements"]
    ] == [(40 * HOUR, 50 * HOUR, 10 * HOUR)]


# --- planning ---------------------------------------------------------------------------------


def test_the_solver_assigns_only_within_the_calendar():
    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.planning import _calendar_and_flex_limits

    # Mon 10h duty on an 8h day; Tue 8h duty on an 8h day; Sat 8h duty on a rest day.
    data = parse_snapshot(
        annual_payload([("A", 0, 9, 10, 10), ("A", 1, 9, 8, 8), ("A", 5, 9, 8, 8)])
    )
    ids = {d.start.day: d.duty_id for d in data.candidates}
    model = cp_model.CpModel()
    x = {d.duty_id: model.new_bool_var(d.duty_id) for d in data.candidates}
    eligible = set(x)
    _calendar_and_flex_limits(model, data, "p0", list(data.candidates), [], x, eligible)
    assert ids[10] not in eligible
    for day, allowed in ((5, False), (6, True), (10, False)):
        probe = model.clone()
        probe.add(probe.get_bool_var_from_proto_index(x[ids[day]].index) == 1)
        assert (
            cp_model.CpSolver().solve(probe) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        ) is allowed


def test_the_calendar_is_saved_through_the_records_api(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(BASE + "/workflow-context" + QUERY, headers=admin).json()
        site = context["establishments"][0]
        body = calendar(
            employer_id=site["employer_id"], establishment_id=site["establishment_id"]
        )
        saved = client.post(
            BASE + "/records/annual_calendar" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "annual-calendar-1",
                "payload": body,
            },
        )
        assert saved.status_code == 200, saved.text
        context = client.get(BASE + "/workflow-context" + QUERY, headers=admin).json()
        assert [c["calendar_id"] for c in context["annual_calendars"]] == ["cal-2026"]


def test_months_follow_the_civil_code_at_month_ends():
    # 民法143条: one month from Jan 31 ends on Feb 28 (no Feb 31), so the first
    # period of a divided calendar must reach Mar 1 (exclusive).
    def divided(first_period_end):
        days = [d for d in january() if d["day"] >= "2026-01-31"]
        return calendar(
            start="2026-01-31",
            end="2027-01-31",
            first_period_end=first_period_end,
            days=days,
            segments=[
                {
                    "start": first_period_end,
                    "end": "2027-01-31",
                    "working_days": 200,
                    "total_seconds": 200 * 8 * HOUR,
                }
            ],
        )

    with pytest.raises(ValueError, match="at least one month"):
        AnnualCalendar(**divided("2026-02-28"))
    assert AnnualCalendar(**divided("2026-03-01")).first_period_end == date(2026, 3, 1)
