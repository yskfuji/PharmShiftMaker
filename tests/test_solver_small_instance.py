"""CP-SAT ソルバの小規模結合テスト."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

from shift_scheduler.data import LoadedConfig, loaders
from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    DayType,
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    LeaveQuota,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)
from shift_scheduler.optimizer import solve_schedule
from shift_scheduler.optimizer.solver import SolverError

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "small_instance"


def _load_fixture_config(
    extra_requests: list[HolidayRequest] | None = None,
) -> LoadedConfig:
    config = loaders.load_all(2025, 2, config_dir=FIXTURE_DIR)
    if not extra_requests:
        return config
    return replace(
        config,
        holiday_requests=[*config.holiday_requests, *extra_requests],
    )


def _build_request_cap_config(
    *,
    day_type: DayType,
    request_date: date,
    requester_ids: list[str],
) -> tuple[LoadedConfig, str]:
    backup_id = "backup"

    people = [
        *(
            Person(person_id=person_id, name=person_id.title(), role=Role.PHARMACIST)
            for person_id in requester_ids
        ),
        Person(person_id=backup_id, name="Backup", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="part_timer",
        name="パート",
        employment_type=EmploymentType.PART_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=5,
    )
    timelines = [
        TimelineEntry(
            person_id=person.person_id,
            from_date=request_date,
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        )
        for person in people
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[day_type],
        )
    ]
    day_infos = [
        DayInfo(
            day_date=request_date,
            day_type=day_type,
            is_business_day=True,
        )
    ]
    holiday_requests = [
        HolidayRequest(
            person_id=person_id,
            request_date=request_date,
            kind=HolidayRequestKind.PUBLIC_HOLIDAY_REQUEST,
            order=idx + 1,
        )
        for idx, person_id in enumerate(requester_ids)
    ]

    return (
        LoadedConfig(
            people=people,
            profiles=[profile],
            timeline_entries=timelines,
            day_infos=day_infos,
            shift_types=shift_types,
            holiday_requests=holiday_requests,
            leave_quotas=[],
        ),
        backup_id,
    )


def _build_oncall_fairness_config() -> LoadedConfig:
    start = date(2025, 2, 10)
    day_infos = [
        DayInfo(
            day_date=start + timedelta(days=offset),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        for offset in range(3)
    ]
    shift_types = [
        ShiftType(
            shift_id="ONCALL",
            name="当直",
            category=ShiftCategory.ON_CALL,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="oncall-1", name="当直1", role=Role.PHARMACIST),
        Person(person_id="oncall-2", name="当直2", role=Role.PHARMACIST),
        Person(person_id="oncall-3", name="当直3", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="oncall_part",
        name="当直専任パート",
        employment_type=EmploymentType.PART_TIME,
        can_night_duty=False,
        can_on_call=True,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
        on_call_min=0,
        on_call_max=3,
    )
    timeline_entries = [
        TimelineEntry(
            person_id=person.person_id,
            from_date=start,
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        )
        for person in people
    ]

    return LoadedConfig(
        people=people,
        profiles=[profile],
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )


def _build_day_shift_balance_config(day_count: int = 6) -> LoadedConfig:
    start = date(2025, 3, 1)
    day_infos = [
        DayInfo(
            day_date=start + timedelta(days=offset),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        for offset in range(day_count)
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="day-1", name="日勤1", role=Role.PHARMACIST),
        Person(person_id="day-2", name="日勤2", role=Role.PHARMACIST),
        Person(person_id="day-3", name="日勤3", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="day_profile",
        name="日勤専任",
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
    )
    timeline_entries = [
        TimelineEntry(
            person_id=person.person_id,
            from_date=start,
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        )
        for person in people
    ]

    return LoadedConfig(
        people=people,
        profiles=[profile],
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )


def _build_priority_holiday_request_config() -> tuple[LoadedConfig, date, str, str]:
    target_date = date(2025, 3, 10)
    day_infos = [
        DayInfo(day_date=target_date, day_type=DayType.WEEKDAY, is_business_day=True),
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    priority_id = "priority"
    fallback_id = "fallback"
    people = [
        Person(person_id=priority_id, name="優先", role=Role.PHARMACIST),
        Person(person_id=fallback_id, name="調整", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="fulltimer",
        name="常勤",
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
    )
    timeline_entries = [
        TimelineEntry(
            person_id=person.person_id,
            from_date=target_date,
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        )
        for person in people
    ]
    holiday_requests = [
        HolidayRequest(
            person_id=priority_id,
            request_date=target_date,
            kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
            order=1,
        ),
        HolidayRequest(
            person_id=fallback_id,
            request_date=target_date,
            kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
            order=2,
        ),
    ]

    return (
        LoadedConfig(
            people=people,
            profiles=[profile],
            timeline_entries=timeline_entries,
            day_infos=day_infos,
            shift_types=shift_types,
            holiday_requests=holiday_requests,
            leave_quotas=[],
        ),
        target_date,
        priority_id,
        fallback_id,
    )


def _build_parttime_consecutive_config(day_count: int = 5) -> LoadedConfig:
    start = date(2025, 3, 20)
    day_infos = [
        DayInfo(
            day_date=start + timedelta(days=offset),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        for offset in range(day_count)
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="part-1", name="パート1", role=Role.PHARMACIST),
        Person(person_id="part-2", name="パート2", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="part_timer",
        name="パート",
        employment_type=EmploymentType.PART_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
    )
    timeline_entries = [
        TimelineEntry(
            person_id=person.person_id,
            from_date=start,
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        )
        for person in people
    ]

    return LoadedConfig(
        people=people,
        profiles=[profile],
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )


def test_solver_respects_night_after_off_and_caps() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    assert assignments, "Solver should return at least one assignment"

    assignments_by_person_day: dict[tuple[str, date], Assignment] = {
        (assignment.person_id, assignment.assignment_date): assignment
        for assignment in assignments
    }
    horizon_dates = {info.day_date for info in config.day_infos}

    for assignment in assignments:
        if assignment.shift_id != "NIGHT":
            continue
        next_day = assignment.assignment_date + timedelta(days=1)
        if next_day in horizon_dates:
            assert (
                assignment.person_id,
                next_day,
            ) not in assignments_by_person_day, (
                "Night duty must be followed by a day off"
            )
        recovery_day = assignment.assignment_date + timedelta(days=2)
        if recovery_day in horizon_dates:
            assert (
                assignment.person_id,
                recovery_day,
            ) not in assignments_by_person_day, (
                "A recovery day after the night-duty end day must be off"
            )

    bob_night_shifts = [
        a for a in assignments if a.person_id == "bob" and a.shift_id == "NIGHT"
    ]
    assert (
        not bob_night_shifts
    ), "Night-ineligible staff must never receive NIGHT shifts"

    day_infos = config.day_infos
    worked_days: dict[str, set[date]] = defaultdict(set)
    for assignment in assignments:
        worked_days[assignment.person_id].add(assignment.assignment_date)

    for person in ("alice", "bob", "dave", "erika", "claire"):
        assert len(worked_days[person]) < len(
            day_infos
        ), "No one should work 7 consecutive days"


def test_solver_respects_weekend_restrictions() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    weekend_dates = {
        info.day_date
        for info in config.day_infos
        if info.day_type in {DayType.SATURDAY, DayType.SUNDAY}
    }

    bob_weekend = [
        assignment
        for assignment in assignments
        if assignment.person_id == "bob" and assignment.assignment_date in weekend_dates
    ]
    assert not bob_weekend, "Weekend-restricted staff must never receive weekend shifts"


def test_solver_caps_weekday_holiday_requests_per_day() -> None:
    request_date = date(2025, 2, 3)
    requesters = ["req1", "req2", "req3", "req4"]
    config, backup_id = _build_request_cap_config(
        day_type=DayType.WEEKDAY,
        request_date=request_date,
        requester_ids=requesters,
    )
    assignments = solve_schedule(config)

    assigned_on_day = {
        assignment.person_id
        for assignment in assignments
        if assignment.assignment_date == request_date
    }
    off_count = sum(1 for person_id in requesters if person_id not in assigned_on_day)

    assert off_count == 3
    assert (
        backup_id not in assigned_on_day
    ), "Backup staff should be unused when cap binds"


def test_solver_caps_sunday_holiday_requests_per_day() -> None:
    request_date = date(2025, 2, 9)
    requesters = ["reqA", "reqB", "reqC", "reqD", "reqE"]
    config, backup_id = _build_request_cap_config(
        day_type=DayType.SUNDAY,
        request_date=request_date,
        requester_ids=requesters,
    )
    assignments = solve_schedule(config)

    assigned_on_day = {
        assignment.person_id
        for assignment in assignments
        if assignment.assignment_date == request_date
    }
    off_count = sum(1 for person_id in requesters if person_id not in assigned_on_day)

    assert off_count == 4
    assert (
        backup_id not in assigned_on_day
    ), "Backup staff should be unused when cap binds"


def test_solver_enforces_single_shift_and_offday_targets() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    person_day_counts: defaultdict[tuple[str, date], int] = defaultdict(int)
    assignments_by_person: defaultdict[str, set[date]] = defaultdict(set)
    for assignment in assignments:
        key = (assignment.person_id, assignment.assignment_date)
        person_day_counts[key] += 1
        assignments_by_person[assignment.person_id].add(assignment.assignment_date)

    assert all(
        count == 1 for count in person_day_counts.values()
    ), "No one can work multiple shifts in a day"

    day_count = len(config.day_infos)
    baseline_off = sum(
        1
        for info in config.day_infos
        if info.day_type
        in {DayType.SATURDAY, DayType.SUNDAY, DayType.HOLIDAY, DayType.YEAR_END}
    )
    paid_leave_counts: defaultdict[str, int] = defaultdict(int)
    for request in config.holiday_requests:
        if request.kind is HolidayRequestKind.PAID_LEAVE_REQUEST:
            paid_leave_counts[request.person_id] += 1

    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    for entry in config.timeline_entries:
        if entry.status is not TimelineStatus.ACTIVE:
            continue
        profile = profiles_by_id[entry.profile_id]
        if profile.employment_type is not EmploymentType.FULL_TIME:
            continue
        worked_days = len(assignments_by_person.get(entry.person_id, set()))
    off_days = day_count - worked_days
    expected_off = min(
        day_count, baseline_off + paid_leave_counts.get(entry.person_id, 0)
    )
    assert (
        off_days >= expected_off
    ), f"Full-time staff must keep at least the target off days ({entry.person_id})"


def test_solver_enforces_night_assignment_bounds() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    night_like_counts: defaultdict[str, int] = defaultdict(int)
    shift_by_id = {shift.shift_id: shift for shift in config.shift_types}
    for assignment in assignments:
        shift = shift_by_id[assignment.shift_id]
        if shift.category in {ShiftCategory.NIGHT_DUTY, ShiftCategory.ON_CALL}:
            night_like_counts[assignment.person_id] += 1

    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    for entry in config.timeline_entries:
        if entry.status is not TimelineStatus.ACTIVE:
            continue
        profile = profiles_by_id[entry.profile_id]
        if (
            profile.employment_type is not EmploymentType.FULL_TIME
            or not profile.can_night_duty
        ):
            continue
        count = night_like_counts.get(entry.person_id, 0)
        if profile.night_duty_min:
            assert (
                count >= profile.night_duty_min
            ), f"{entry.person_id} must take at least {profile.night_duty_min} night/on-call duties"
        if profile.night_duty_max:
            assert (
                count <= profile.night_duty_max
            ), f"{entry.person_id} must not exceed {profile.night_duty_max} night/on-call duties"


def test_oncall_assignments_can_meet_night_minimum() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 8), day_type=DayType.SATURDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="ONCALL",
            name="当直",
            category=ShiftCategory.ON_CALL,
            required_count=1,
            applicable_day_types=[DayType.SATURDAY],
        )
    ]
    people = [Person(person_id="solo", name="Solo", role=Role.PHARMACIST)]
    profiles = [
        Profile(
            profile_id="oncall_only",
            name="当直専従",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_on_call=True,
            can_evening=False,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=None,
            max_consecutive_working_days=6,
            night_duty_min=1,
            night_duty_max=4,
            on_call_min=0,
            on_call_max=4,
        )
    ]
    timeline_entries = [
        TimelineEntry(
            person_id="solo",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="oncall_only",
            status=TimelineStatus.ACTIVE,
        )
    ]

    config = LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    assignments = solve_schedule(config)
    assert len(assignments) == 1
    assert assignments[0].shift_id == "ONCALL"
    assert assignments[0].person_id == "solo"


def test_solver_prioritizes_high_priority_holiday_requests() -> None:
    config, request_date, priority_id, fallback_id = (
        _build_priority_holiday_request_config()
    )
    assignments = solve_schedule(config)

    assigned = [
        assignment
        for assignment in assignments
        if assignment.assignment_date == request_date
    ]
    assert len(assigned) == 1
    assert assigned[0].person_id == fallback_id
    assert all(assignment.person_id != priority_id for assignment in assigned)


def test_solver_balances_night_shifts_across_staff() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    night_counts: dict[str, int] = defaultdict(int)
    for assignment in assignments:
        if assignment.shift_id == "NIGHT":
            night_counts[assignment.person_id] += 1

    alice_nights = night_counts.get("alice", 0)
    dave_nights = night_counts.get("dave", 0)
    assert (
        abs(alice_nights - dave_nights) <= 1
    ), "Night duties should be roughly even due to fairness penalties"


def test_solver_balances_evening_shifts_across_staff() -> None:
    config = _load_fixture_config()
    assignments = solve_schedule(config)

    evening_counts: dict[str, int] = defaultdict(int)
    total_evenings = 0
    for assignment in assignments:
        if assignment.shift_id == "EVENING":
            evening_counts[assignment.person_id] += 1
            total_evenings += 1

    assert total_evenings > 0, "Fixture should include evening shifts"
    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    eligible = {
        entry.person_id
        for entry in config.timeline_entries
        if entry.status is TimelineStatus.ACTIVE
        and profiles_by_id[entry.profile_id].can_evening
    }
    # default zero counts for eligible staff with no assignment
    for person_id in eligible:
        evening_counts.setdefault(person_id, 0)

    spread = max(evening_counts.values()) - min(evening_counts.values())
    assert spread <= 1, "Evening duties should be balanced by soft constraints"


def test_solver_balances_day_shifts_for_small_fulltime_pool() -> None:
    config = _build_day_shift_balance_config(day_count=6)
    assignments = solve_schedule(config)

    counts: defaultdict[str, int] = defaultdict(int)
    for assignment in assignments:
        counts[assignment.person_id] += 1

    for person in config.people:
        counts.setdefault(person.person_id, 0)

    assert len(assignments) == len(config.day_infos)
    spread = max(counts.values()) - min(counts.values())
    assert spread <= 1, "Day-shift fairness should keep workloads even"


def test_solver_balances_oncall_assignments_with_soft_penalties() -> None:
    config = _build_oncall_fairness_config()
    assignments = solve_schedule(config)

    counts: defaultdict[str, int] = defaultdict(int)
    for assignment in assignments:
        counts[assignment.person_id] += 1

    assert set(counts.keys()) == {person.person_id for person in config.people}
    assert all(
        count == 1 for count in counts.values()
    ), "On-call shifts should be evenly distributed"


def test_solver_discourages_four_day_streaks_for_part_time_staff() -> None:
    config = _build_parttime_consecutive_config()
    assignments = solve_schedule(config)

    assignments_by_person: defaultdict[str, list[date]] = defaultdict(list)
    for assignment in assignments:
        assignments_by_person[assignment.person_id].append(assignment.assignment_date)

    for dates in assignments_by_person.values():
        dates.sort()
        streak = 1
        for prev, curr in zip(dates, dates[1:], strict=False):
            if (curr - prev).days == 1:
                streak += 1
                assert streak <= 3, "Four-day streaks should be avoided by penalties"
            else:
                streak = 1


def test_solver_requires_pharmacist_partner_for_assistant() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 3), day_type=DayType.WEEKDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="assistant-a", name="補佐A", role=Role.ASSISTANT),
        Person(person_id="pharmacist-a", name="薬剤師A", role=Role.PHARMACIST),
    ]
    profiles = [
        Profile(
            profile_id="assistant",
            name="調剤補佐",
            employment_type=EmploymentType.PART_TIME,
            can_night_duty=False,
            can_on_call=False,
            can_evening=False,
            can_ward_alone=False,
            weekend_allowed=False,
            holiday_allowed=False,
            allowed_weekdays=[0],
            max_consecutive_working_days=3,
        ),
        Profile(
            profile_id="weekday_pharmacist",
            name="平日薬剤師",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_on_call=False,
            can_evening=True,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=[1],
            max_consecutive_working_days=6,
        ),
    ]
    timeline_entries = [
        TimelineEntry(
            person_id="assistant-a",
            from_date=date(2025, 1, 1),
            to_date=None,
            profile_id="assistant",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="pharmacist-a",
            from_date=date(2025, 1, 1),
            to_date=None,
            profile_id="weekday_pharmacist",
            status=TimelineStatus.ACTIVE,
        ),
    ]

    config = LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    with pytest.raises(SolverError):
        solve_schedule(config)


def test_solver_requires_veteran_partner_for_newcomer_on_ward() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 4), day_type=DayType.WEEKDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="WARD",
            name="病棟",
            category=ShiftCategory.WARD,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="newbie", name="新人", role=Role.PHARMACIST),
        Person(person_id="veteran", name="ベテラン", role=Role.PHARMACIST),
    ]
    profiles = [
        Profile(
            profile_id="newcomer",
            name="新人薬剤師",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_on_call=False,
            can_evening=False,
            can_ward_alone=False,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=[1],
            max_consecutive_working_days=6,
        ),
        Profile(
            profile_id="veteran_profile",
            name="ベテラン薬剤師",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=True,
            can_on_call=False,
            can_evening=True,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=[1],
            max_consecutive_working_days=6,
        ),
    ]
    timeline_entries = [
        TimelineEntry(
            person_id="newbie",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="newcomer",
            status=TimelineStatus.ACTIVE,
        ),
        # ベテランは在籍するが休職中として無効化
        TimelineEntry(
            person_id="veteran",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="veteran_profile",
            status=TimelineStatus.LEAVE,
        ),
    ]

    config = LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    with pytest.raises(SolverError):
        solve_schedule(config)


def test_solver_respects_partial_timeline_overlap() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 3), day_type=DayType.WEEKDAY, is_business_day=True
        ),
        DayInfo(
            day_date=date(2025, 2, 4), day_type=DayType.WEEKDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="full", name="フル", role=Role.PHARMACIST),
        Person(person_id="late", name="途中入職", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="full_timer",
        name="正社員",
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=True,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
    )
    timeline_entries = [
        TimelineEntry(
            person_id="full",
            from_date=date(2025, 1, 1),
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="late",
            from_date=date(2025, 2, 4),
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        ),
    ]

    config = LoadedConfig(
        people=people,
        profiles=[profile],
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    assignments = solve_schedule(config)
    assert len(assignments) == 2
    assert any(
        a.person_id == "full" and a.assignment_date == day_infos[0].day_date
        for a in assignments
    )
    assert all(
        a.person_id != "late" or a.assignment_date >= day_infos[1].day_date
        for a in assignments
    )
    assert any(
        a.person_id == "late" and a.assignment_date == day_infos[1].day_date
        for a in assignments
    )


def test_solver_requires_veteran_for_each_ward_shift() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 5), day_type=DayType.WEEKDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="WARD_A",
            name="病棟A",
            category=ShiftCategory.WARD,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
        ShiftType(
            shift_id="WARD_B",
            name="病棟B",
            category=ShiftCategory.WARD,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
    ]
    people = [
        Person(person_id="rookie-a", name="新人A", role=Role.PHARMACIST),
        Person(person_id="rookie-b", name="新人B", role=Role.PHARMACIST),
        Person(person_id="veteran", name="ベテラン", role=Role.PHARMACIST),
    ]
    profiles = [
        Profile(
            profile_id="newcomer_profile",
            name="新人",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_on_call=False,
            can_evening=False,
            can_ward_alone=False,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=None,
            max_consecutive_working_days=6,
        ),
        Profile(
            profile_id="veteran_profile",
            name="ベテラン",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=True,
            can_on_call=True,
            can_evening=True,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=None,
            max_consecutive_working_days=6,
        ),
    ]
    timeline_entries = [
        TimelineEntry(
            person_id="rookie-a",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="newcomer_profile",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="rookie-b",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="newcomer_profile",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="veteran",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="veteran_profile",
            status=TimelineStatus.ACTIVE,
        ),
    ]

    config = LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    with pytest.raises(SolverError):
        solve_schedule(config)


def test_paid_leave_request_results_in_day_off() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 10), day_type=DayType.WEEKDAY, is_business_day=True
        ),
        DayInfo(
            day_date=date(2025, 2, 11), day_type=DayType.WEEKDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        )
    ]
    people = [
        Person(person_id="requester", name="希望者", role=Role.PHARMACIST),
        Person(person_id="cover", name="カバー", role=Role.PHARMACIST),
    ]
    profile = Profile(
        profile_id="full_timer",
        name="正社員",
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=True,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=6,
    )
    timeline_entries = [
        TimelineEntry(
            person_id="requester",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="cover",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id=profile.profile_id,
            status=TimelineStatus.ACTIVE,
        ),
    ]
    holiday_requests = [
        HolidayRequest(
            person_id="requester",
            request_date=day_infos[1].day_date,
            kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
            order=1,
        )
    ]
    leave_quotas = [
        LeaveQuota(
            person_id="requester",
            year=2025,
            kind=HolidayRequestKind.PAID_LEAVE_REQUEST,
            total_days=5,
            used_before_month=0,
        )
    ]

    config = LoadedConfig(
        people=people,
        profiles=[profile],
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=holiday_requests,
        leave_quotas=leave_quotas,
    )

    assignments = solve_schedule(config)
    assert len(assignments) == 2
    assert any(
        a.assignment_date == day_infos[1].day_date and a.person_id == "cover"
        for a in assignments
    )
    assert all(
        not (a.assignment_date == day_infos[1].day_date and a.person_id == "requester")
        for a in assignments
    )


def test_solver_enforces_oncall_assignment_bounds() -> None:
    day_infos = [
        DayInfo(
            day_date=date(2025, 2, 6), day_type=DayType.WEEKDAY, is_business_day=True
        ),
        DayInfo(
            day_date=date(2025, 2, 7), day_type=DayType.WEEKDAY, is_business_day=True
        ),
        DayInfo(
            day_date=date(2025, 2, 8), day_type=DayType.SATURDAY, is_business_day=True
        ),
        DayInfo(
            day_date=date(2025, 2, 9), day_type=DayType.SUNDAY, is_business_day=True
        ),
    ]
    shift_types = [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
        ShiftType(
            shift_id="ONCALL",
            name="当直",
            category=ShiftCategory.ON_CALL,
            required_count=1,
            applicable_day_types=[DayType.SATURDAY, DayType.SUNDAY],
        ),
    ]
    people = [
        Person(person_id="oncall-a", name="当直A", role=Role.PHARMACIST),
        Person(person_id="oncall-b", name="当直B", role=Role.PHARMACIST),
    ]
    profiles = [
        Profile(
            profile_id="oncall_profile",
            name="当直必須",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_on_call=True,
            can_evening=False,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            allowed_weekdays=None,
            max_consecutive_working_days=6,
            on_call_min=1,
            on_call_max=1,
        ),
    ]
    timeline_entries = [
        TimelineEntry(
            person_id="oncall-a",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="oncall_profile",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="oncall-b",
            from_date=date(2025, 2, 1),
            to_date=None,
            profile_id="oncall_profile",
            status=TimelineStatus.ACTIVE,
        ),
    ]

    config = LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=[],
        leave_quotas=[],
    )

    assignments = solve_schedule(config)
    oncall_counts: defaultdict[str, int] = defaultdict(int)
    for assignment in assignments:
        if assignment.shift_id == "ONCALL":
            oncall_counts[assignment.person_id] += 1

    assert oncall_counts == {"oncall-a": 1, "oncall-b": 1}


def test_solver_balances_oncall_shifts_via_soft_constraints() -> None:
    config = _build_oncall_fairness_config()
    assignments = solve_schedule(config)

    counts: defaultdict[str, int] = defaultdict(int)
    for assignment in assignments:
        assert assignment.shift_id == "ONCALL"
        counts[assignment.person_id] += 1

    assert sum(counts.values()) == len(config.day_infos)
    spread = max(counts.values()) - min(counts.values())
    assert spread <= 1, "On-call fairness penalties should even out distribution"
