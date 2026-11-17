"""Assignment-level validation helpers for manual overrides (README 6.4)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, timedelta

from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    Person,
    Role,
    ShiftCategory,
    ShiftType,
)
from shift_scheduler.optimizer.staff import ActiveStaff, extract_active_staff
from shift_scheduler.optimizer.warnings import ScheduleWarningEntry


def validate_manual_assignments(
    assignments: list[Assignment], config: LoadedConfig
) -> list[ScheduleWarningEntry]:
    """Run lightweight hard-constraint validation for manual overrides.

    Returns warning entries describing any detected violations. Empty list when no problems.
    """

    if not assignments or not config.day_infos:
        return []

    day_infos = sorted(config.day_infos, key=lambda info: info.day_date)
    shift_types_by_id = {shift.shift_id: shift for shift in config.shift_types}
    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    active_staff = extract_active_staff(
        config, profiles_by_id, day_infos[0].day_date, day_infos[-1].day_date
    )
    people_by_id = {person.person_id: person for person in config.people}
    warnings: list[ScheduleWarningEntry] = []

    assignments_by_day: defaultdict[date, list[Assignment]] = defaultdict(list)
    person_day_assignments: defaultdict[tuple[str, date], list[Assignment]] = (
        defaultdict(list)
    )
    unknown_day_assignments: list[Assignment] = []

    day_info_by_date = {info.day_date: info for info in day_infos}
    for assignment in assignments:
        if assignment.assignment_date not in day_info_by_date:
            unknown_day_assignments.append(assignment)
        assignments_by_day[assignment.assignment_date].append(assignment)
        person_day_assignments[
            (assignment.person_id, assignment.assignment_date)
        ].append(assignment)

    if unknown_day_assignments:
        warnings.extend(
            _build_unknown_day_warning(entry) for entry in unknown_day_assignments
        )

    warnings.extend(_validate_per_person_single_shift(person_day_assignments))
    warnings.extend(
        _validate_known_entities(assignments, people_by_id, shift_types_by_id)
    )
    warnings.extend(
        _validate_cover_constraints(day_infos, assignments_by_day, shift_types_by_id)
    )
    warnings.extend(
        _validate_night_followup(assignments, shift_types_by_id, person_day_assignments)
    )
    warnings.extend(
        _validate_assistant_pairing(assignments_by_day, shift_types_by_id, people_by_id)
    )
    warnings.extend(
        _validate_ward_newcomer_pairing(
            assignments_by_day, shift_types_by_id, active_staff
        )
    )

    return warnings


def _build_unknown_day_warning(assignment: Assignment) -> ScheduleWarningEntry:
    return ScheduleWarningEntry(
        code="MANUAL_UNKNOWN_DATE",
        severity="warning",
        message=(
            f"{assignment.person_id} の手動割当 {assignment.assignment_date.isoformat()} は対象月に含まれません"
        ),
        context={
            "person_id": assignment.person_id,
            "assignment_date": assignment.assignment_date.isoformat(),
            "shift_id": assignment.shift_id,
        },
    )


def _validate_per_person_single_shift(
    person_day_assignments: defaultdict[tuple[str, date], list[Assignment]],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    for (person_id, day), assignments in person_day_assignments.items():
        if len(assignments) <= 1:
            continue
        warnings.append(
            ScheduleWarningEntry(
                code="MANUAL_MULTIPLE_ASSIGNMENTS",
                severity="critical",
                message=(
                    f"{person_id} は {day.isoformat()} に複数のシフトが割り当てられています"
                ),
                context={
                    "person_id": person_id,
                    "assignment_date": day.isoformat(),
                    "shift_ids": [assignment.shift_id for assignment in assignments],
                },
            )
        )
    return warnings


def _validate_known_entities(
    assignments: Iterable[Assignment],
    people_by_id: dict[str, Person],
    shift_types_by_id: dict[str, ShiftType],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    for assignment in assignments:
        if assignment.person_id not in people_by_id:
            warnings.append(
                ScheduleWarningEntry(
                    code="MANUAL_UNKNOWN_PERSON",
                    severity="critical",
                    message=f"存在しない職員ID {assignment.person_id} が手動割当で指定されています",
                    context={
                        "person_id": assignment.person_id,
                        "assignment_date": assignment.assignment_date.isoformat(),
                        "shift_id": assignment.shift_id,
                    },
                )
            )
        if assignment.shift_id not in shift_types_by_id:
            warnings.append(
                ScheduleWarningEntry(
                    code="MANUAL_UNKNOWN_SHIFT",
                    severity="warning",
                    message=f"定義されていないシフトID {assignment.shift_id} が使用されています",
                    context={
                        "assignment_date": assignment.assignment_date.isoformat(),
                        "shift_id": assignment.shift_id,
                    },
                )
            )
    return warnings


def _validate_cover_constraints(
    day_infos: list[DayInfo],
    assignments_by_day: dict[date, list[Assignment]],
    shift_types_by_id: dict[str, ShiftType],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    for day_info in day_infos:
        day_assignments = assignments_by_day.get(day_info.day_date, [])
        actual_counts: defaultdict[str, int] = defaultdict(int)
        for assignment in day_assignments:
            actual_counts[assignment.shift_id] += 1

        for shift in shift_types_by_id.values():
            if shift.category == ShiftCategory.OFF:
                continue
            if day_info.day_type not in shift.applicable_day_types:
                continue
            required = shift.required_count
            actual = actual_counts.get(shift.shift_id, 0)
            if actual != required:
                warnings.append(
                    ScheduleWarningEntry(
                        code="MANUAL_COVERAGE_MISMATCH",
                        severity="critical",
                        message=(
                            f"{day_info.day_date.isoformat()} の {shift.shift_id} は必要 {required} 名に対し {actual} 名です"
                        ),
                        context={
                            "date": day_info.day_date.isoformat(),
                            "shift_id": shift.shift_id,
                            "required": required,
                            "actual": actual,
                        },
                    )
                )
    return warnings


def _validate_night_followup(
    assignments: Iterable[Assignment],
    shift_types_by_id: dict[str, ShiftType],
    person_day_assignments: dict[tuple[str, date], list[Assignment]],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    night_like_days: list[tuple[str, date]] = []
    for assignment in assignments:
        shift = shift_types_by_id.get(assignment.shift_id)
        if shift is None:
            continue
        if shift.category in {ShiftCategory.NIGHT_DUTY, ShiftCategory.ON_CALL}:
            night_like_days.append((assignment.person_id, assignment.assignment_date))

    for person_id, night_day in night_like_days:
        for offset, label in ((1, "終了当日"), (2, "終了翌日")):
            rest_day = night_day + timedelta(days=offset)
            if (person_id, rest_day) not in person_day_assignments:
                continue
            warnings.append(
                ScheduleWarningEntry(
                    code="MANUAL_NIGHT_AFTER_OFF_VIOLATION",
                    severity="critical",
                    message=(
                        f"{person_id} は夜勤/当直({night_day.isoformat()})の{label}({rest_day.isoformat()})にも勤務が割り当てられています"
                    ),
                    context={
                        "person_id": person_id,
                        "night_date": night_day.isoformat(),
                        "next_assignment": rest_day.isoformat(),
                    },
                )
            )
    return warnings


def _validate_assistant_pairing(
    assignments_by_day: dict[date, list[Assignment]],
    shift_types_by_id: dict[str, ShiftType],
    people_by_id: dict[str, Person],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    for day, assignments in assignments_by_day.items():
        assistant_count = 0
        pharmacist_count = 0
        for assignment in assignments:
            person = people_by_id.get(assignment.person_id)
            shift = shift_types_by_id.get(assignment.shift_id)
            if person is None or shift is None:
                continue
            if shift.category != ShiftCategory.DAY_SHIFT:
                continue
            if person.role == Role.ASSISTANT:
                assistant_count += 1
            elif person.role == Role.PHARMACIST:
                pharmacist_count += 1
        if assistant_count and pharmacist_count == 0:
            warnings.append(
                ScheduleWarningEntry(
                    code="MANUAL_ASSISTANT_WITHOUT_PHARMACIST",
                    severity="critical",
                    message=f"{day.isoformat()} の日勤で調剤補佐のみが配置されています",
                    context={
                        "date": day.isoformat(),
                        "assistant_count": assistant_count,
                        "pharmacist_count": pharmacist_count,
                    },
                )
            )
    return warnings


def _validate_ward_newcomer_pairing(
    assignments_by_day: dict[date, list[Assignment]],
    shift_types_by_id: dict[str, ShiftType],
    active_staff: dict[str, ActiveStaff],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    for day, assignments in assignments_by_day.items():
        ward_by_shift: defaultdict[str, list[str]] = defaultdict(list)
        for assignment in assignments:
            shift = shift_types_by_id.get(assignment.shift_id)
            if shift is None or shift.category != ShiftCategory.WARD:
                continue
            ward_by_shift[shift.shift_id].append(assignment.person_id)
        for shift_id, persons in ward_by_shift.items():
            veterans = [
                pid
                for pid in persons
                if active_staff.get(pid) and active_staff[pid].profile.can_ward_alone
            ]
            newcomers = [
                pid
                for pid in persons
                if active_staff.get(pid)
                and not active_staff[pid].profile.can_ward_alone
            ]
            if newcomers and not veterans:
                warnings.append(
                    ScheduleWarningEntry(
                        code="MANUAL_WARD_NEWCOMER_SOLO",
                        severity="critical",
                        message=(
                            f"{day.isoformat()} の {shift_id} で新人のみが配置されています"
                        ),
                        context={
                            "date": day.isoformat(),
                            "shift_id": shift_id,
                            "newcomers": newcomers,
                        },
                    )
                )
    return warnings


__all__ = ["validate_manual_assignments"]
