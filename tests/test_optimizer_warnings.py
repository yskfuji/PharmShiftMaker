"""警告生成ユーティリティのテスト."""

from __future__ import annotations

from datetime import date, timedelta

from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    DayType,
    EmploymentType,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)
from shift_scheduler.optimizer.warnings import generate_schedule_warnings


def _day_infos() -> list[DayInfo]:
    start = date(2025, 2, 1)
    return [
        DayInfo(
            day_date=start + timedelta(days=offset),
            day_type=DayType.WEEKDAY,
            is_business_day=True,
        )
        for offset in range(7)
    ]


def _shift_types() -> list[ShiftType]:
    return [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
        ShiftType(
            shift_id="WARD",
            name="病棟",
            category=ShiftCategory.WARD,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
        ShiftType(
            shift_id="NIGHT",
            name="夜勤",
            category=ShiftCategory.NIGHT_DUTY,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
    ]


def _profile(
    profile_id: str,
    *,
    can_ward_alone: bool = True,
    can_night_duty: bool = True,
    max_consecutive: int = 6,
) -> Profile:
    return Profile(
        profile_id=profile_id,
        name=profile_id,
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=can_night_duty,
        can_on_call=False,
        can_evening=True,
        can_ward_alone=can_ward_alone,
        weekend_allowed=True,
        holiday_allowed=True,
        allowed_weekdays=None,
        max_consecutive_working_days=max_consecutive,
        night_duty_min=0,
        night_duty_max=4,
        on_call_min=0,
        on_call_max=0,
        evening_min=0,
        evening_max=4,
    )


def _timeline(person_id: str, profile_id: str) -> TimelineEntry:
    return TimelineEntry(
        person_id=person_id,
        from_date=date(2025, 1, 1),
        to_date=None,
        profile_id=profile_id,
        status=TimelineStatus.ACTIVE,
    )


def _build_config(people: list[Person], profiles: list[Profile]) -> LoadedConfig:
    timelines = [
        _timeline(person.person_id, profile.profile_id)
        for person, profile in zip(people, profiles, strict=True)
    ]
    return LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timelines,
        day_infos=_day_infos(),
        shift_types=_shift_types(),
        holiday_requests=[],
        leave_quotas=[],
    )


def test_long_consecutive_work_warning() -> None:
    people = [Person(person_id="alice", name="Alice", role=Role.PHARMACIST)]
    profiles = [_profile("p1", max_consecutive=5)]
    config = _build_config(people, profiles)

    assignments = [
        Assignment(
            person_id="alice",
            assignment_date=date(2025, 2, 1) + timedelta(days=i),
            shift_id="DAY",
        )
        for i in range(6)
    ]

    warnings = generate_schedule_warnings(assignments, config)
    assert any(w.code == "LONG_CONSECUTIVE_WORK" for w in warnings)


def test_newcomer_ward_warning() -> None:
    people = [Person(person_id="rookie", name="Rookie", role=Role.PHARMACIST)]
    profiles = [_profile("rookie_profile", can_ward_alone=False)]
    config = _build_config(people, profiles)

    assignments = [
        Assignment(
            person_id="rookie", assignment_date=date(2025, 2, 1), shift_id="WARD"
        ),
    ]

    warnings = generate_schedule_warnings(assignments, config)
    assert any(w.code == "ROOKIE_WARD_SOLO" for w in warnings)


def test_night_duty_imbalance_warning() -> None:
    people = [
        Person(person_id="alice", name="Alice", role=Role.PHARMACIST),
        Person(person_id="bob", name="Bob", role=Role.PHARMACIST),
    ]
    profiles = [_profile("p1"), _profile("p2")]
    config = _build_config(people, profiles)

    assignments = [
        Assignment(
            person_id="alice", assignment_date=date(2025, 2, 1), shift_id="NIGHT"
        ),
        Assignment(
            person_id="alice", assignment_date=date(2025, 2, 2), shift_id="NIGHT"
        ),
    ]

    warnings = generate_schedule_warnings(assignments, config)
    assert any(w.code == "NIGHT_DUTY_IMBALANCE" for w in warnings)
