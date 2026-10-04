"""L02: variable hours of up to one month in fixed-length periods, and systems
accepted by name only (no database).

Art. 32-2 allows any period of up to one month (e.g. four weeks). The frame is
40h x calendar days / 7 (a 28-day period: 160h). A fixed cycle longer than 28
days would exceed one month when it spans February, so 28 is the maximum.
One-year variable hours (Art. 32-4) need their agreed calendar (tests/test_annual_variable.py);
flextime (Art. 32-3) is settled from actual work (tests/test_flextime.py). Entered as
standard hours they would miss overtime beyond their frames (e.g. flextime 7h45m x
23 days = 178.25h > 177.1h in a 31-day month).
Expected values are computed by hand in each test.
"""

from datetime import date

import pytest

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.work_accounting import (
    _allocate_variable,
    input_findings,
    variable_period,
)
from tests.test_compliance_v2 import work_fixture
from tests.test_variable_hours import rows, weekdays

HOUR = 3600


def test_fixed_length_periods_are_counted_from_the_anchor():
    anchor = date(2026, 1, 5)
    assert variable_period(anchor, 28, date(2026, 1, 5)) == (
        date(2026, 1, 5),
        date(2026, 2, 2),
    )
    assert variable_period(anchor, 28, date(2026, 2, 1)) == (
        date(2026, 1, 5),
        date(2026, 2, 2),
    )
    assert variable_period(anchor, 28, date(2026, 2, 2)) == (
        date(2026, 2, 2),
        date(2026, 3, 2),
    )
    assert variable_period(anchor, 28, date(2026, 1, 4)) == (
        date(2025, 12, 8),
        date(2026, 1, 5),
    )
    # Without a length the periods are calendar months from the anchor day.
    assert variable_period(anchor, None, date(2026, 2, 1)) == (
        date(2026, 1, 5),
        date(2026, 2, 5),
    )


def test_the_frame_of_a_four_week_period_is_160_hours():
    # 17 scheduled 10h days in the four weeks from Mon 2026-01-05 = 170h. Day and week
    # stay within the schedule, so only the frame counts: 170h - 160h = 10h.
    days = list(weekdays("2026-01-05", "2026-02-01"))[:17]
    entries = [(d, 10, True) for d in days]
    four_weeks = _allocate_variable(rows(entries), 0, date(2026, 1, 5), 28)
    assert sum(r["daily_overtime"] + r["weekly_overtime"] for r in four_weeks) == 0
    assert sum(r["period_overtime"] for r in four_weeks) == 10 * HOUR
    # The same days in the calendar month from Jan 5 (31 days, frame 177h8m34s): no overtime.
    month = _allocate_variable(rows(entries), 0, date(2026, 1, 5))
    assert sum(r["period_overtime"] for r in month) == 0


def test_weeks_are_cut_at_the_four_week_boundary():
    # Periods start Mon 2026-01-05 and Mon 2026-02-02 (28 days). With weeks starting
    # on Wednesday (week_start=2) the week Wed Jan 28 - Tue Feb 3 is cut at Feb 2:
    # 5 x 8h in Jan 28 - Feb 1 = 40h, then Feb 2 - 3 start a new clipped week.
    entries = [
        (d, 8, False)
        for d in (
            "2026-01-28",
            "2026-01-29",
            "2026-01-30",
            "2026-01-31",
            "2026-02-01",
            "2026-02-02",
            "2026-02-03",
        )
    ]
    allocated = _allocate_variable(rows(entries), 2, date(2026, 1, 5), 28)
    assert (
        sum(r["weekly_overtime"] for r in allocated) == 0
    )  # uncut, the week would have 56h -> 16h


def variable(days, anchor):
    payload = work_fixture([("A", 0, 8, 9, 9)], orders=(1,)).model_dump(mode="json")
    for e in payload["employments"]:
        e.update(
            working_time_system="monthly_variable",
            variable_anchor=anchor,
            variable_evidence=e["declaration"],
            variable_period_days=days,
        )
    return parse_snapshot(payload)


def test_the_whole_four_week_period_must_be_in_the_input():
    # The planned week is Jan 5 - 12, the horizon ends Jan 12.
    covered = variable(28, "2025-12-15")  # period Dec 15 - Jan 12
    uncovered = variable(28, "2026-01-05")  # period Jan 5 - Feb 2 runs past the horizon

    def coverage(data):
        return [
            f
            for f in input_findings(data)
            if "not fully covered by the input" in f.message
        ]

    assert coverage(covered) == []
    assert coverage(uncovered) != []


@pytest.mark.parametrize(
    "change",
    [
        {"variable_period_days": 29},  # could exceed one month
        {
            "working_time_system": "standard",
            "variable_anchor": None,
            "variable_evidence": None,
        },
    ],
)
def test_invalid_period_lengths_are_refused(change):
    payload = variable(28, "2025-12-15").model_dump(mode="json")
    payload["employments"][0].update(change)
    with pytest.raises(ValueError):
        parse_snapshot(payload)


def test_one_year_variable_hours_need_version_3_inputs_with_a_calendar():
    # The calendar is a version-3 input (tests/test_annual_variable.py covers it).
    payload = work_fixture([("A", 0, 8, 8, 8)], orders=(1,)).model_dump(mode="json")
    payload["employments"][0].update(
        working_time_system="annual_variable", annual_calendar_id="cal"
    )
    data = parse_snapshot(payload)
    found = [f for f in input_findings(data) if f.status == "unsupported"]
    assert [f.message.split(":")[0] for f in found] == [
        "One-year variable working hours need version-3 inputs with their calendar"
    ]
    assert solve(data, 5).status == "BLOCKED"


def test_the_solver_keeps_the_four_week_frame():
    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.planning import _variable_hour_limits

    # Five 9h days fit 45h scheduled per week; the 28-day frame (160h) is not reached.
    data = variable(28, "2025-12-15")
    model = cp_model.CpModel()
    x = {d.duty_id: model.new_bool_var(d.duty_id) for d in data.candidates}
    _variable_hour_limits(model, data, "p0", list(data.candidates), [], x, set(x))
    for var in x.values():
        model.add(var == 1)
    assert cp_model.CpSolver().solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)
