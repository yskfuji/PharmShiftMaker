"""Utility helpers for CP-SAT variable construction (Phase3 DoD)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from ortools.sat.python import cp_model

from shift_scheduler.domain import (
    DayInfo,
    DayType,
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
)

WEEKEND_DAY_TYPES = {DayType.SATURDAY, DayType.SUNDAY}
HOLIDAY_DAY_TYPES = {DayType.HOLIDAY, DayType.YEAR_END}


class ActiveStaffView(Protocol):
    """Minimal interface required from optimizer staff records."""

    @property
    def person(self) -> Person: ...

    @property
    def profile(self) -> Profile: ...

    def is_active_on(self, day: date) -> bool: ...


@dataclass(slots=True)
class VariableCollections:
    assignment_vars: dict[tuple[str, int, str], cp_model.IntVar]
    offday_vars: dict[tuple[str, int], cp_model.IntVar]
    workday_vars: dict[tuple[str, int], cp_model.IntVar]
    person_day_assignments: defaultdict[tuple[str, int], list[cp_model.IntVar]]
    day_shift_assignments: defaultdict[tuple[int, str], list[cp_model.IntVar]]
    night_assignments: defaultdict[tuple[str, int], list[cp_model.IntVar]]
    oncall_assignments: defaultdict[tuple[str, int], list[cp_model.IntVar]]
    ward_assignments_newcomer: defaultdict[tuple[int, str], list[cp_model.IntVar]]
    ward_assignments_veteran: defaultdict[tuple[int, str], list[cp_model.IntVar]]
    pharmacist_day_assignments: defaultdict[int, list[cp_model.IntVar]]
    assistant_day_assignments: defaultdict[int, list[cp_model.IntVar]]
    holiday_request_vars: dict[tuple[str, int], cp_model.IntVar]
    approval_vars_by_day: defaultdict[int, list[cp_model.IntVar]]
    quota_request_vars: defaultdict[
        tuple[str, HolidayRequestKind], list[cp_model.IntVar]
    ]
    bonus_leave_vars: defaultdict[str, list[cp_model.IntVar]]
    assignable_day_indices: defaultdict[str, list[int]]
    assignable_offday_vars: defaultdict[str, list[cp_model.IntVar]]
    night_assignment_totals: defaultdict[str, list[cp_model.IntVar]]
    oncall_assignment_totals: defaultdict[str, list[cp_model.IntVar]]
    evening_assignment_totals: defaultdict[str, list[cp_model.IntVar]]
    workday_totals_fulltime: defaultdict[str, list[cp_model.IntVar]]


@dataclass(slots=True)
class BoundCollections:
    max_consecutive_by_person: dict[str, int]
    night_bounds: dict[str, tuple[int | None, int | None]]
    oncall_bounds: dict[str, tuple[int | None, int | None]]
    evening_bounds: dict[str, tuple[int | None, int | None]]


def build_shift_matrix(
    day_infos: Sequence[DayInfo],
    shift_types_by_id: Mapping[str, ShiftType],
) -> list[list[str]]:
    applicable_shift_ids_by_day: list[list[str]] = []
    for day_info in day_infos:
        ids: list[str] = []
        for shift in shift_types_by_id.values():
            if shift.category == ShiftCategory.OFF:
                continue
            if day_info.day_type in shift.applicable_day_types:
                ids.append(shift.shift_id)
        applicable_shift_ids_by_day.append(ids)
    return applicable_shift_ids_by_day


def build_shift_requirements(
    shift_matrix: Sequence[Sequence[str]],
    shift_types_by_id: Mapping[str, ShiftType],
) -> dict[tuple[int, str], int]:
    requirements: dict[tuple[int, str], int] = {}
    for day_idx, shift_ids in enumerate(shift_matrix):
        for shift_id in shift_ids:
            requirements[(day_idx, shift_id)] = shift_types_by_id[
                shift_id
            ].required_count
    return requirements


def summarize_category_requirements(
    shift_requirements: Mapping[tuple[int, str], int],
    shift_types_by_id: Mapping[str, ShiftType],
) -> dict[ShiftCategory, int]:
    totals: defaultdict[ShiftCategory, int] = defaultdict(int)
    for (_, shift_id), count in shift_requirements.items():
        category = shift_types_by_id[shift_id].category
        totals[category] += count
    return dict(totals)


def build_variable_collections(
    model: cp_model.CpModel,
    *,
    day_infos: Sequence[DayInfo],
    active_staff: Mapping[str, ActiveStaffView],
    shift_types_by_id: Mapping[str, ShiftType],
    applicable_shift_ids_by_day: Sequence[Sequence[str]],
    holiday_requests_by_person_day: Mapping[tuple[str, int], HolidayRequest],
    quota_tracked_kinds: set[HolidayRequestKind],
) -> tuple[VariableCollections, BoundCollections]:
    var_ctx = VariableCollections(
        assignment_vars={},
        offday_vars={},
        workday_vars={},
        person_day_assignments=defaultdict(list),
        day_shift_assignments=defaultdict(list),
        night_assignments=defaultdict(list),
        oncall_assignments=defaultdict(list),
        ward_assignments_newcomer=defaultdict(list),
        ward_assignments_veteran=defaultdict(list),
        pharmacist_day_assignments=defaultdict(list),
        assistant_day_assignments=defaultdict(list),
        holiday_request_vars={},
        approval_vars_by_day=defaultdict(list),
        quota_request_vars=defaultdict(list),
        bonus_leave_vars=defaultdict(list),
        assignable_day_indices=defaultdict(list),
        assignable_offday_vars=defaultdict(list),
        night_assignment_totals=defaultdict(list),
        oncall_assignment_totals=defaultdict(list),
        evening_assignment_totals=defaultdict(list),
        workday_totals_fulltime=defaultdict(list),
    )
    bound_ctx = BoundCollections(
        max_consecutive_by_person={},
        night_bounds={},
        oncall_bounds={},
        evening_bounds={},
    )

    for person_id, staff in active_staff.items():
        profile = staff.profile
        bound_ctx.max_consecutive_by_person[person_id] = (
            profile.max_consecutive_working_days
        )
        if (
            profile.employment_type == EmploymentType.FULL_TIME
            and profile.can_night_duty
        ):
            bound_ctx.night_bounds[person_id] = (
                profile.night_duty_min,
                profile.night_duty_max,
            )
        if profile.can_on_call and profile.employment_type == EmploymentType.FULL_TIME:
            bound_ctx.oncall_bounds[person_id] = (
                profile.on_call_min,
                profile.on_call_max,
            )
        if profile.can_evening and profile.employment_type == EmploymentType.FULL_TIME:
            bound_ctx.evening_bounds[person_id] = (
                profile.evening_min,
                profile.evening_max,
            )

        allowed_weekdays = (
            set(profile.allowed_weekdays)
            if profile.allowed_weekdays is not None
            else None
        )

        for day_idx, day_info in enumerate(day_infos):
            key = (person_id, day_idx)
            y_var = model.new_bool_var(f"off_{person_id}_{day_idx}")
            work_var = model.new_bool_var(f"work_{person_id}_{day_idx}")
            var_ctx.offday_vars[key] = y_var
            var_ctx.workday_vars[key] = work_var
            if profile.employment_type == EmploymentType.FULL_TIME:
                var_ctx.workday_totals_fulltime[person_id].append(work_var)

            if not staff.is_active_on(day_info.day_date):
                model.add(y_var == 1)
                model.add(work_var == 0)
                continue

            weekday_index = day_info.day_date.weekday()
            created_shift = False
            for shift_id in applicable_shift_ids_by_day[day_idx]:
                shift = shift_types_by_id[shift_id]
                if not _can_assign_shift(
                    staff.person,
                    profile,
                    day_info,
                    weekday_index,
                    shift,
                    allowed_weekdays,
                ):
                    continue
                var = model.new_bool_var(f"x_{person_id}_{day_idx}_{shift_id}")
                var_ctx.assignment_vars[(person_id, day_idx, shift_id)] = var
                var_ctx.person_day_assignments[key].append(var)
                var_ctx.day_shift_assignments[(day_idx, shift_id)].append(var)
                created_shift = True

                if shift.category == ShiftCategory.NIGHT_DUTY:
                    var_ctx.night_assignments[key].append(var)
                    var_ctx.night_assignment_totals[person_id].append(var)
                if shift.category == ShiftCategory.ON_CALL:
                    var_ctx.oncall_assignments[key].append(var)
                    var_ctx.oncall_assignment_totals[person_id].append(var)
                    var_ctx.night_assignment_totals[person_id].append(var)
                if shift.category == ShiftCategory.EVENING:
                    var_ctx.evening_assignment_totals[person_id].append(var)
                if (
                    shift.category == ShiftCategory.WARD
                    and staff.person.role == Role.PHARMACIST
                ):
                    bucket = (
                        var_ctx.ward_assignments_veteran
                        if profile.can_ward_alone
                        else var_ctx.ward_assignments_newcomer
                    )
                    bucket[(day_idx, shift_id)].append(var)
                if shift.category == ShiftCategory.DAY_SHIFT:
                    if staff.person.role == Role.PHARMACIST:
                        var_ctx.pharmacist_day_assignments[day_idx].append(var)
                    if staff.person.role == Role.ASSISTANT:
                        var_ctx.assistant_day_assignments[day_idx].append(var)

            if created_shift:
                var_ctx.assignable_day_indices[person_id].append(day_idx)
                var_ctx.assignable_offday_vars[person_id].append(y_var)

            request = holiday_requests_by_person_day.get(key)
            if request is not None and created_shift:
                approval_var = model.new_bool_var(f"holiday_{person_id}_{day_idx}")
                var_ctx.holiday_request_vars[key] = approval_var
                model.add(approval_var <= y_var)
                model.add(y_var <= approval_var)
                var_ctx.approval_vars_by_day[day_idx].append(approval_var)
                if request.kind in quota_tracked_kinds:
                    var_ctx.quota_request_vars[(person_id, request.kind)].append(
                        approval_var
                    )
                    var_ctx.bonus_leave_vars[person_id].append(approval_var)

    return var_ctx, bound_ctx


def _can_assign_shift(
    person: Person,
    profile: Profile,
    day_info: DayInfo,
    weekday_index: int,
    shift: ShiftType,
    allowed_weekdays: set[int] | None,
) -> bool:
    if allowed_weekdays is not None and weekday_index not in allowed_weekdays:
        return False
    if day_info.day_type in WEEKEND_DAY_TYPES and not profile.weekend_allowed:
        return False
    if day_info.day_type in HOLIDAY_DAY_TYPES and not profile.holiday_allowed:
        return False

    if shift.category == ShiftCategory.NIGHT_DUTY and not profile.can_night_duty:
        return False
    if shift.category == ShiftCategory.ON_CALL and not profile.can_on_call:
        return False
    if shift.category == ShiftCategory.EVENING and not profile.can_evening:
        return False
    if shift.category == ShiftCategory.WARD:
        return person.role == Role.PHARMACIST
    return True


__all__ = [
    "ActiveStaffView",
    "VariableCollections",
    "BoundCollections",
    "WEEKEND_DAY_TYPES",
    "HOLIDAY_DAY_TYPES",
    "build_variable_collections",
    "build_shift_matrix",
    "build_shift_requirements",
    "summarize_category_requirements",
]
