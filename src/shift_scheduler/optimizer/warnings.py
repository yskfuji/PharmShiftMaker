"""シフト結果から UX 用警告情報を生成するユーティリティ."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    HolidayRequestKind,
    ShiftCategory,
    ShiftType,
)
from shift_scheduler.optimizer.staff import ActiveStaff, extract_active_staff

_QUOTA_TRACKED_KINDS = {
    HolidayRequestKind.PAID_LEAVE_REQUEST,
    HolidayRequestKind.SUMMER_LEAVE_REQUEST,
    HolidayRequestKind.REFRESH_LEAVE_REQUEST,
}

_KIND_LABELS = {
    HolidayRequestKind.PAID_LEAVE_REQUEST: "有給休暇",
    HolidayRequestKind.SUMMER_LEAVE_REQUEST: "夏季休暇",
    HolidayRequestKind.REFRESH_LEAVE_REQUEST: "リフレッシュ休暇",
}


WarningSeverity = Literal["info", "warning", "critical"]


def _empty_context() -> dict[str, Any]:
    return {}


@dataclass(frozen=True)
class ScheduleWarningEntry:
    code: str
    message: str
    severity: WarningSeverity
    context: dict[str, Any] = field(default_factory=_empty_context)


def generate_schedule_warnings(
    assignments: list[Assignment], config: LoadedConfig
) -> list[ScheduleWarningEntry]:
    if not config.day_infos or not assignments:
        return []

    day_infos = sorted(config.day_infos, key=lambda d: d.day_date)
    shift_types = {shift.shift_id: shift for shift in config.shift_types}
    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    active_staff = extract_active_staff(
        config, profiles_by_id, day_infos[0].day_date, day_infos[-1].day_date
    )
    if not active_staff:
        return []

    warnings: list[ScheduleWarningEntry] = []
    warnings.extend(_detect_long_consecutive_work(day_infos, assignments, active_staff))
    warnings.extend(
        _detect_newcomer_ward_solitary(assignments, active_staff, shift_types)
    )
    warnings.extend(
        _detect_night_duty_imbalance(assignments, active_staff, shift_types)
    )
    warnings.extend(_detect_leave_quota_shortage(config))
    return warnings


def _detect_long_consecutive_work(
    day_infos: list[DayInfo],
    assignments: list[Assignment],
    active_staff: dict[str, ActiveStaff],
) -> list[ScheduleWarningEntry]:
    indexed_assignments: defaultdict[str, set[date]] = defaultdict(set)
    for assignment in assignments:
        indexed_assignments[assignment.person_id].add(assignment.assignment_date)

    warnings: list[ScheduleWarningEntry] = []
    ordered_days: list[date] = [info.day_date for info in day_infos]
    for person_id, staff in active_staff.items():
        profile = staff.profile
        allowed = profile.max_consecutive_working_days
        longest = 0
        longest_range: tuple[str | None, str | None] = (None, None)
        current = 0
        current_start: str | None = None
        for day in ordered_days:
            worked = day in indexed_assignments[person_id]
            if worked:
                if current == 0:
                    current_start = day.isoformat()
                current += 1
                if current > longest:
                    longest = current
                    longest_range = (current_start, day.isoformat())
            else:
                current = 0
                current_start = None
        if longest > allowed:
            warnings.append(
                ScheduleWarningEntry(
                    code="LONG_CONSECUTIVE_WORK",
                    severity="warning",
                    message=f"{staff.person.name} が {longest} 連勤になっています (最大 {allowed} 連勤まで)",
                    context={
                        "person_id": person_id,
                        "streak_length": longest,
                        "allowed": allowed,
                        "start_date": longest_range[0],
                        "end_date": longest_range[1],
                    },
                )
            )
    return warnings


def _detect_newcomer_ward_solitary(
    assignments: list[Assignment],
    active_staff: dict[str, ActiveStaff],
    shift_types: Mapping[str, ShiftType],
) -> list[ScheduleWarningEntry]:
    warnings: list[ScheduleWarningEntry] = []
    ward_assignments: defaultdict[str, list[str]] = defaultdict(list)
    for assignment in assignments:
        shift = shift_types.get(assignment.shift_id)
        if shift is None or shift.category != ShiftCategory.WARD:
            continue
        ward_assignments[assignment.assignment_date.isoformat()].append(
            assignment.person_id
        )

    for iso_date, persons in ward_assignments.items():
        veterans = [
            pid
            for pid in persons
            if active_staff.get(pid) and active_staff[pid].profile.can_ward_alone
        ]
        newcomers = [
            pid
            for pid in persons
            if active_staff.get(pid) and not active_staff[pid].profile.can_ward_alone
        ]
        if newcomers and not veterans:
            warnings.append(
                ScheduleWarningEntry(
                    code="ROOKIE_WARD_SOLO",
                    severity="critical",
                    message=f"新人 ({', '.join(newcomers)}) が {iso_date} に病棟単独シフトになっています",
                    context={"date": iso_date, "person_ids": newcomers},
                )
            )
    return warnings


def _detect_night_duty_imbalance(
    assignments: list[Assignment],
    active_staff: dict[str, ActiveStaff],
    shift_types: Mapping[str, ShiftType],
) -> list[ScheduleWarningEntry]:
    night_counts: dict[str, int] = {}
    for person_id, staff in active_staff.items():
        if staff.profile.can_night_duty:
            night_counts[person_id] = 0
    for assignment in assignments:
        shift = shift_types.get(assignment.shift_id)
        if shift is None or shift.category != ShiftCategory.NIGHT_DUTY:
            continue
        assigned_staff = active_staff.get(assignment.person_id)
        if assigned_staff is None or not assigned_staff.profile.can_night_duty:
            continue
        night_counts[assignment.person_id] += 1

    if not night_counts:
        return []

    max_count = max(night_counts.values())
    min_count = min(night_counts.values())
    if max_count - min_count < 2:
        return []

    heaviest = max(night_counts, key=lambda pid: night_counts[pid])
    lightest = min(night_counts, key=lambda pid: night_counts[pid])
    return [
        ScheduleWarningEntry(
            code="NIGHT_DUTY_IMBALANCE",
            severity="warning",
            message=(
                f"夜勤回数に偏りがあります: {active_staff[heaviest].person.name} が {max_count} 回、"
                f"{active_staff[lightest].person.name} が {min_count} 回"
            ),
            context={
                "heaviest_person_id": heaviest,
                "heaviest_count": max_count,
                "lightest_person_id": lightest,
                "lightest_count": min_count,
            },
        )
    ]


def _detect_leave_quota_shortage(config: LoadedConfig) -> list[ScheduleWarningEntry]:
    quota_limits: dict[tuple[str, HolidayRequestKind], int] = {}
    for quota in config.leave_quotas:
        if quota.kind not in _QUOTA_TRACKED_KINDS:
            continue
        quota_limits[(quota.person_id, quota.kind)] = max(
            0, quota.total_days - quota.used_before_month
        )
    if not quota_limits:
        return []

    request_counts: defaultdict[tuple[str, HolidayRequestKind], int] = defaultdict(int)
    for request in config.holiday_requests:
        if request.kind not in _QUOTA_TRACKED_KINDS:
            continue
        request_counts[(request.person_id, request.kind)] += 1

    if not request_counts:
        return []

    name_map = {person.person_id: person.name for person in config.people}
    warnings: list[ScheduleWarningEntry] = []
    for key, requested in request_counts.items():
        limit = quota_limits.get(key)
        if limit is None or requested <= limit:
            continue
        person_id, kind = key
        warnings.append(
            ScheduleWarningEntry(
                code="LEAVE_QUOTA_SHORTAGE",
                severity="warning",
                message=(
                    f"{name_map.get(person_id, person_id)} の {_KIND_LABELS.get(kind, kind.value)} 残数 {limit} 日を超える"
                    f"希望 ({requested} 日) が登録されています"
                ),
                context={
                    "person_id": person_id,
                    "kind": kind.value,
                    "remaining_quota": limit,
                    "requested": requested,
                },
            )
        )
    return warnings


__all__ = ["ScheduleWarningEntry", "generate_schedule_warnings"]
