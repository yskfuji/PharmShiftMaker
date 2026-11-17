"""Flexible holidays and one-month variable working hours (no database).

Sources: Labour Standards Act Art. 32-2, Art. 35(2), Enforcement Regulations
Art. 12-2(2); overtime under one-month variable hours per 昭63.1.1基発1号 (day:
beyond the scheduled hours when over 8h, else 8h; week: beyond the scheduled
hours when over 40h, else 40h, less the daily part; period: beyond 40h x days/7,
less both). Expected values are computed by hand in each test.
"""

from datetime import date, datetime, timedelta

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import (
    _allocate_variable,
    account_work,
    input_findings,
)
from tests.test_compliance_v2 import work_fixture

HOUR = 3600


def variable(specs, anchor="2026-01-01"):
    payload = work_fixture(specs, orders=(1,)).model_dump(mode="json")
    for e in payload["employments"]:
        e.update(
            working_time_system="monthly_variable",
            variable_anchor=anchor,
            variable_evidence=e["declaration"],
        )
    return parse_snapshot(payload)


def daily(result, day_offset_start):
    return sum(
        r["daily_overtime_seconds"]
        for r in result["trace"]
        if r["start"].startswith(day_offset_start)
    )


def run(data):
    return account_work(data, list(data.candidates))


def test_day_rule_uses_scheduled_hours_above_eight():
    # Day 0: scheduled 10h, worked 10h -> no overtime (standard hours would give 2h).
    # Day 1: scheduled 6h, worked 9h -> 1h (beyond 8h, not beyond 6h).
    standard = run(work_fixture([("A", 0, 8, 10, 10)], orders=(1,)))
    assert sum(r["daily_overtime_seconds"] for r in standard["trace"]) == 2 * HOUR
    result = run(variable([("A", 0, 8, 10, 10), ("A", 1, 8, 9, 6)]))
    by_day = {}
    for r in result["trace"]:
        by_day[r["date"]] = by_day.get(r["date"], 0) + r["daily_overtime_seconds"]
    assert sorted(by_day.values()) == [0, HOUR]


def test_week_rule_uses_scheduled_week_above_forty():
    # Five days scheduled 9h (45h in the week): working exactly that is no overtime.
    result = run(variable([("A", d, 8, 9, 9) for d in range(5)]))
    assert sum(r["overtime_seconds"] for r in result["trace"]) == 0
    # One of those days worked 10h: 1h daily overtime, nothing weekly.
    result = run(variable([("A", d, 8, 10 if d == 2 else 9, 9) for d in range(5)]))
    assert sum(r["daily_overtime_seconds"] for r in result["trace"]) == HOUR
    assert sum(r["weekly_overtime_seconds"] for r in result["trace"]) == 0


def rows(entries):
    """entries: (date, hours, scheduled); one duty per day starting 09:00 JST."""
    result = []
    for i, (day, hours, scheduled) in enumerate(entries):
        start = datetime.fromisoformat(f"{day}T09:00:00+09:00")
        result.append(
            {
                "duty_id": str(i),
                "start": start,
                "end": start + timedelta(hours=hours),
                "day": date.fromisoformat(day),
                "calendar_day": date.fromisoformat(day),
                "seconds": hours * HOUR,
                "scheduled": scheduled,
                "holiday": False,
            }
        )
    return result


def weekdays(first, last):
    day = date.fromisoformat(first)
    while day <= date.fromisoformat(last):
        if day.weekday() < 5:
            yield day.isoformat()
        day += timedelta(days=1)


def test_period_frame_is_forty_hours_times_days_over_seven():
    # January 2026 (31 days): frame 144000 * 31 // 7 = 637714 s. 22 weekdays x 8h =
    # 176h = 633600 s fit; one more 8h Saturday (Jan 31) makes 184h = 662400 s.
    # Weekly: the week of Jan 26 has 48h > 40h, so Saturday's 8h are weekly overtime
    # and the period frame is not exceeded (633600 < 637714).
    entries = [(d, 8, True) for d in weekdays("2026-01-01", "2026-01-31")]
    assert len(entries) == 22
    allocated = _allocate_variable(
        rows(entries + [("2026-01-31", 8, False)]), 0, date(2026, 1, 1)
    )
    assert sum(r["weekly_overtime"] for r in allocated) == 8 * HOUR
    assert sum(r["period_overtime"] for r in allocated) == 0
    # Scheduled 9h on every weekday (198h) keeps day and week within the schedule, so
    # only the frame counts: 712800 - 637714 = 75086 s, taken from the last days worked.
    allocated = _allocate_variable(
        rows([(d, 9, True) for d in weekdays("2026-01-01", "2026-01-31")]),
        0,
        date(2026, 1, 1),
    )
    assert sum(r["daily_overtime"] + r["weekly_overtime"] for r in allocated) == 0
    assert sum(r["period_overtime"] for r in allocated) == 712800 - 637714
    assert allocated[-1]["period_overtime"] == 9 * HOUR


def test_weeks_are_cut_at_the_period_boundary():
    # Mon Jan 26 - Fri Jan 30 scheduled 8h, Sat Jan 31 extra 8h (48h in the clipped
    # week -> 8h weekly overtime). Sun Feb 1 extra 8h starts a new period and a new
    # clipped week: no weekly overtime there (an uncut week would add 8h more).
    entries = [(d, 8, True) for d in weekdays("2026-01-26", "2026-01-30")]
    entries += [("2026-01-31", 8, False), ("2026-02-01", 8, False)]
    allocated = _allocate_variable(rows(entries), 0, date(2026, 1, 1))
    weekly = {
        r["day"].isoformat(): r["weekly_overtime"]
        for r in allocated
        if r["weekly_overtime"]
    }
    assert weekly == {"2026-01-31": 8 * HOUR}


def four_week(holidays):
    payload = work_fixture([], orders=(1,)).model_dump(mode="json")
    start = date.fromisoformat(
        payload["employments"][0]["start"][:10]
    )  # the employment start
    period = date.fromisoformat(payload["period"]["start"][:10])
    for e in payload["employments"]:
        e.update(
            holiday_system="four_week",
            four_week_start=start.isoformat(),
            statutory_holidays=[d.isoformat() for d in holidays(start, period)],
        )
    return [f.message for f in input_findings(parse_snapshot(payload))]


def test_four_holidays_in_four_weeks_replaces_the_weekly_designation():
    def four_at_window_start(start, period):
        day = start
        while day < period + timedelta(
            days=120
        ):  # beyond the planned period and lookahead
            yield from (day + timedelta(days=i) for i in range(4))
            day += timedelta(days=28)

    found = four_week(four_at_window_start)
    assert not [
        m for m in found if "statutory holiday" in m.lower() or "four weeks" in m
    ]

    def three_in_the_planned_window(start, period):
        window = start + timedelta(days=28 * ((period - start).days // 28))
        for d in four_at_window_start(start, period):
            if d != window:
                yield d

    assert [
        m
        for m in four_week(three_in_the_planned_window)
        if "Fewer than four statutory holidays" in m
    ]


def test_four_week_window_reaching_outside_the_context_is_still_judged():
    # No designated holidays at all: the window overlapping the planned period is
    # judged on the listed dates even if it extends past the checked context.
    assert [
        m
        for m in four_week(lambda start, period: iter(()))
        if "Fewer than four statutory holidays" in m
    ]


def test_four_week_start_after_the_employment_start_is_referred():
    payload = work_fixture([], orders=(1,)).model_dump(mode="json")
    later = (
        date.fromisoformat(payload["employments"][0]["start"][:10]) + timedelta(days=7)
    ).isoformat()
    for e in payload["employments"]:
        e.update(
            holiday_system="four_week", four_week_start=later, statutory_holidays=[]
        )
    assert [
        f
        for f in input_findings(parse_snapshot(payload))
        if "start day is after the employment start" in f.message
    ]


def test_variable_period_not_fully_covered_by_the_input_is_unverified():
    # Anchor on the 20th: the period containing the planned days starts before the
    # checked context or ends after the horizon, so its frame cannot be checked.
    data = variable([("A", 0, 8, 9, 9)], anchor="2025-12-20")
    context_start = data.context.start.date()
    anchor = (context_start + timedelta(days=5)).replace(
        day=min(28, (context_start + timedelta(days=5)).day)
    )
    data = variable([("A", 0, 8, 9, 9)], anchor=anchor.isoformat())
    assert [
        f for f in input_findings(data) if "not fully covered by the input" in f.message
    ]


def test_variable_regime_is_supported_only_with_matching_employment():
    from shift_scheduler.validation.planning import input_findings as planning_inputs

    base = variable([("A", 0, 8, 9, 9)]).model_dump(mode="json")
    for regime, system, expected in (
        ("variable", "monthly_variable", None),
        ("general", "monthly_variable", "unverified"),
        ("variable", "standard", "unsupported"),
    ):
        payload = {
            **base,
            "contracts": [dict(c, regime=regime) for c in base["contracts"]],
        }
        payload["employments"] = [
            dict(
                e,
                working_time_system=system,
                variable_anchor=e["variable_anchor"] if system != "standard" else None,
                variable_evidence=(
                    e["variable_evidence"] if system != "standard" else None
                ),
            )
            for e in base["employments"]
        ]
        statuses = {
            f.status
            for f in planning_inputs(parse_snapshot(payload))
            if f.rule_id == "regime"
        }
        assert statuses == ({expected} if expected else set()), regime


def test_solver_limits_follow_the_variable_rules_without_an_agreement():
    # With every candidate forced on: 10h scheduled days are allowed; 10h worked on
    # 6h scheduled days are not (beyond 8h and beyond the schedule).
    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.planning import _variable_hour_limits

    def feasible(specs):
        data = variable(specs)
        model = cp_model.CpModel()
        x = {d.duty_id: model.new_bool_var(d.duty_id) for d in data.candidates}
        _variable_hour_limits(model, data, "p0", list(data.candidates), [], x, set(x))
        for var in x.values():
            model.add(var == 1)
        return cp_model.CpSolver().solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    assert feasible([("A", d, 8, 10, 10) for d in range(4)])
    assert not feasible([("A", d, 8, 10, 6) for d in range(4)])
    assert feasible(
        [("A", d, 8, 8, 6) for d in range(4)]
    )  # 8h worked is within the day limit
    assert not feasible(
        [("A", d, 0, 9, 9) for d in range(5)] + [("A", 5, 0, 9, 0)]
    )  # week over 45h scheduled
