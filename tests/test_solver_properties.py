"""Property-based regression tests for the CP-SAT hard-constraint layer."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from shift_scheduler.domain import (
    DayInfo,
    DayType,
    ShiftCategory,
    ShiftType,
    TimelineStatus,
)
from shift_scheduler.optimizer import solve_schedule
from tests.utils.fixture_factory import build_config_from_templates

_START_DATE = date(2025, 4, 1)
_WEEKEND_TYPES = {DayType.SATURDAY, DayType.SUNDAY, DayType.HOLIDAY, DayType.YEAR_END}
_DAY_TYPE_POOL = [DayType.WEEKDAY, DayType.SATURDAY, DayType.SUNDAY, DayType.HOLIDAY]


def _build_day_infos(day_types: list[DayType]) -> list[DayInfo]:
    return [
        DayInfo(
            day_date=_START_DATE + timedelta(days=offset),
            day_type=day_type,
            is_business_day=True,
        )
        for offset, day_type in enumerate(day_types)
    ]


def _longest_streak(dates: list[date]) -> int:
    if not dates:
        return 0
    sorted_dates = sorted(dates)
    longest = 1
    current = 1
    for prev, current_date in zip(sorted_dates, sorted_dates[1:], strict=False):
        if current_date == prev + timedelta(days=1):
            current += 1
        else:
            longest = max(longest, current)
            current = 1
    longest = max(longest, current)
    return longest


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    day_types=st.lists(st.sampled_from(_DAY_TYPE_POOL), min_size=3, max_size=6).filter(
        lambda seq: any(day in _WEEKEND_TYPES for day in seq)
    )
)
def test_weekend_ineligible_staff_are_never_assigned_on_weekends(
    day_types: list[DayType],
) -> None:
    """Profiles that deny weekend/holiday work must stay off no matter the calendar mix."""

    day_infos = _build_day_infos(day_types)
    shift = ShiftType(
        shift_id="PROP_DAY",
        name="Property Day",
        category=ShiftCategory.DAY_SHIFT,
        required_count=1,
        applicable_day_types=list({*day_types}),
    )
    config = build_config_from_templates(
        ["baseline_staff"], day_infos=day_infos, shift_types=[shift]
    )

    assignments = solve_schedule(config)
    day_lookup = {day.day_date: day for day in config.day_infos}
    restricted_person = "weekday_only"

    for assignment in assignments:
        day_type = day_lookup[assignment.assignment_date].day_type
        if day_type in _WEEKEND_TYPES:
            assert (
                assignment.person_id != restricted_person
            ), "Weekend-prohibited staff must not be scheduled on weekend/holiday dates"


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(day_count=st.integers(min_value=4, max_value=7))
def test_max_consecutive_days_limit_is_respected(day_count: int) -> None:
    """Randomized horizons must still obey each profile's max_consecutive_working_days."""

    day_types = [DayType.WEEKDAY for _ in range(day_count)]
    day_infos = _build_day_infos(day_types)
    shift = ShiftType(
        shift_id="PROP_DAY_LIMIT",
        name="Property Day Limit",
        category=ShiftCategory.DAY_SHIFT,
        required_count=1,
        applicable_day_types=[DayType.WEEKDAY],
    )
    config = build_config_from_templates(
        ["baseline_staff"], day_infos=day_infos, shift_types=[shift]
    )

    assignments = solve_schedule(config)
    assignments_by_person: dict[str, list[date]] = defaultdict(list)
    for assignment in assignments:
        assignments_by_person[assignment.person_id].append(assignment.assignment_date)

    profile_by_id = {profile.profile_id: profile for profile in config.profiles}
    active_profiles = {
        entry.person_id: profile_by_id[entry.profile_id]
        for entry in config.timeline_entries
        if entry.status == TimelineStatus.ACTIVE
    }

    for person_id, worked_dates in assignments_by_person.items():
        longest = _longest_streak(worked_dates)
        limit = active_profiles[person_id].max_consecutive_working_days
        assert (
            longest <= limit
        ), f"{person_id} exceeded max consecutive days ({longest} > {limit})"


@settings(max_examples=20, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    day_count=st.integers(min_value=8, max_value=14),
    start_offset=st.integers(min_value=0, max_value=4),
)
def test_day_shift_fairness_scales_with_randomized_horizon(
    day_count: int, start_offset: int
) -> None:
    """Day-shift fairness weights must keep workloads even for larger horizons."""

    start_date = _START_DATE + timedelta(days=start_offset)
    day_infos = [
        DayInfo(
            day_date=start_date + timedelta(days=offset),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        for offset in range(day_count)
    ]
    shift = ShiftType(
        shift_id="PROP_DAY_FAIRNESS",
        name="Property Day Fairness",
        category=ShiftCategory.DAY_SHIFT,
        required_count=1,
        applicable_day_types=[DayType.WEEKDAY],
    )
    config = build_config_from_templates(
        ["balanced_fulltime_pool"], day_infos=day_infos, shift_types=[shift]
    )

    assignments = solve_schedule(config)
    assert assignments, "Solver must assign every day"

    assignment_totals = {person.person_id: 0 for person in config.people}
    for assignment in assignments:
        assignment_totals[assignment.person_id] += 1

    spread = max(assignment_totals.values()) - min(assignment_totals.values())
    assert (
        spread <= 1
    ), f"Day-shift fairness should keep workload spread <= 1 (got {spread})"
