"""CP-SAT ベースのハード制約ソルバ (README 5.3/5.4)."""

from __future__ import annotations

import math
import os
from collections.abc import Mapping, Sequence

from ortools.sat.python import cp_model

from shift_scheduler.constraints import hard_constraints, soft_constraints
from shift_scheduler.constraints import variables as constraint_variables
from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    Assignment,
    DayType,
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    ShiftCategory,
)
from shift_scheduler.optimizer.staff import extract_active_staff


class SolverError(RuntimeError):
    """ソルバが実行できない際に送出する例外."""


_WEEKEND_TYPES = constraint_variables.WEEKEND_DAY_TYPES
_HOLIDAY_TYPES = constraint_variables.HOLIDAY_DAY_TYPES
_QUOTA_TRACKED_KINDS = {
    HolidayRequestKind.PAID_LEAVE_REQUEST,
    HolidayRequestKind.SUMMER_LEAVE_REQUEST,
    HolidayRequestKind.REFRESH_LEAVE_REQUEST,
}

_SOLVER_TIMEOUT_SECONDS = float(os.getenv("SHIFT_SOLVER_TIMEOUT_SECONDS", "30.0"))
_SOLVER_WORKERS = int(os.getenv("SHIFT_SOLVER_WORKERS", "0"))
_SOLVER_LOGGING_ENABLED = os.getenv("SHIFT_SOLVER_LOGGING", "").lower() in {
    "1",
    "true",
    "yes",
}


def _configure_solver(solver: cp_model.CpSolver) -> None:
    solver.parameters.max_time_in_seconds = _SOLVER_TIMEOUT_SECONDS
    if _SOLVER_WORKERS > 0:
        solver.parameters.num_search_workers = _SOLVER_WORKERS
    if _SOLVER_LOGGING_ENABLED:
        solver.parameters.log_search_progress = True


def solve_schedule(config: LoadedConfig) -> list[Assignment]:
    """CP-SAT を用いて Assignment のリストを生成する."""

    if not config.day_infos:
        return []

    day_infos = sorted(config.day_infos, key=lambda d: d.day_date)
    day_count = len(day_infos)
    horizon_start = day_infos[0].day_date
    horizon_end = day_infos[-1].day_date

    profiles_by_id = {profile.profile_id: profile for profile in config.profiles}
    active_staff = extract_active_staff(
        config, profiles_by_id, horizon_start, horizon_end
    )
    if not active_staff:
        raise SolverError("No active staff found for the requested horizon.")
    full_time_person_ids = {
        person_id
        for person_id, staff in active_staff.items()
        if staff.profile.employment_type == EmploymentType.FULL_TIME
    }

    day_index_by_date = {info.day_date: idx for idx, info in enumerate(day_infos)}

    shift_types_by_id = {shift.shift_id: shift for shift in config.shift_types}
    applicable_shift_ids_by_day = constraint_variables.build_shift_matrix(
        day_infos, shift_types_by_id
    )
    shift_requirements = constraint_variables.build_shift_requirements(
        applicable_shift_ids_by_day, shift_types_by_id
    )
    category_requirements = constraint_variables.summarize_category_requirements(
        shift_requirements, shift_types_by_id
    )
    total_required_assignments = sum(shift_requirements.values())

    holiday_requests_by_person_day: dict[tuple[str, int], HolidayRequest] = {}
    for request in config.holiday_requests:
        day_idx = day_index_by_date.get(request.request_date)
        if day_idx is None:
            continue
        staff = active_staff.get(request.person_id)
        if staff is None or not staff.is_active_on(request.request_date):
            continue
        holiday_requests_by_person_day[(request.person_id, day_idx)] = request

    quota_limits: dict[tuple[str, HolidayRequestKind], int] = {}
    for quota in config.leave_quotas:
        if quota.kind not in _QUOTA_TRACKED_KINDS:
            continue
        remaining = max(0, quota.total_days - quota.used_before_month)
        quota_limits[(quota.person_id, quota.kind)] = remaining

    holiday_limits = {
        day_idx: (
            4
            if day_infos[day_idx].day_type in {DayType.SUNDAY, DayType.YEAR_END}
            else 3
        )
        for day_idx in range(day_count)
    }

    model = cp_model.CpModel()
    var_ctx, bound_ctx = constraint_variables.build_variable_collections(
        model,
        day_infos=day_infos,
        active_staff=active_staff,
        shift_types_by_id=shift_types_by_id,
        applicable_shift_ids_by_day=applicable_shift_ids_by_day,
        holiday_requests_by_person_day=holiday_requests_by_person_day,
        quota_tracked_kinds=_QUOTA_TRACKED_KINDS,
    )

    hard_constraints.add_cover_constraints(
        model, shift_requirements, var_ctx.day_shift_assignments
    )
    hard_constraints.add_single_shift_per_day_constraints(
        model, var_ctx.person_day_assignments, var_ctx.offday_vars, var_ctx.workday_vars
    )
    hard_constraints.add_night_oncall_nextday_off_constraints(
        model,
        var_ctx.night_assignments,
        var_ctx.oncall_assignments,
        var_ctx.offday_vars,
        day_count,
    )
    hard_constraints.add_consecutive_days_constraints(
        model, var_ctx.workday_vars, bound_ctx.max_consecutive_by_person, day_count
    )
    hard_constraints.add_newcomer_ward_pairing_constraints(
        model, var_ctx.ward_assignments_newcomer, var_ctx.ward_assignments_veteran
    )
    hard_constraints.add_assistant_day_shift_pairing_constraints(
        model, var_ctx.assistant_day_assignments, var_ctx.pharmacist_day_assignments
    )
    baseline_offdays: dict[str, int] = {}
    total_assignable_slots = 0
    for person_id, day_indices in var_ctx.assignable_day_indices.items():
        if not day_indices or person_id not in full_time_person_ids:
            continue
        total_assignable_slots += len(day_indices)
        weekend_like_days = sum(
            1
            for idx in day_indices
            if day_infos[idx].day_type in _WEEKEND_TYPES
            or day_infos[idx].day_type in _HOLIDAY_TYPES
        )
        if weekend_like_days:
            baseline_offdays[person_id] = weekend_like_days

    if baseline_offdays:
        max_offday_budget = max(0, total_assignable_slots - total_required_assignments)
        baseline_sum = sum(baseline_offdays.values())
        if baseline_sum > max_offday_budget:
            adjusted: dict[str, int] = {}
            fractional: list[tuple[float, str]] = []
            if baseline_sum == 0:
                baseline_offdays = {}
            else:
                scale = max_offday_budget / baseline_sum if baseline_sum else 0
                used = 0
                for person_id, baseline in baseline_offdays.items():
                    scaled_value = baseline * scale
                    floored = int(scaled_value)
                    floored = min(
                        floored, len(var_ctx.assignable_day_indices[person_id])
                    )
                    adjusted[person_id] = floored
                    used += floored
                    fractional.append((scaled_value - floored, person_id))
                remaining = max(0, max_offday_budget - used)
                fractional.sort(reverse=True)
                for _, person_id in fractional:
                    if remaining <= 0:
                        break
                    cap = len(var_ctx.assignable_day_indices[person_id])
                    if adjusted[person_id] >= cap:
                        continue
                    adjusted[person_id] += 1
                    remaining -= 1
                baseline_offdays = adjusted

    hard_constraints.add_offday_count_constraints(
        model,
        var_ctx.assignable_offday_vars,
        baseline_offdays,
        var_ctx.bonus_leave_vars,
    )
    hard_constraints.add_holiday_request_hard_constraints(
        model, var_ctx.approval_vars_by_day, holiday_limits
    )
    hard_constraints.add_leave_quota_constraints(
        model, var_ctx.quota_request_vars, quota_limits
    )

    night_slots = category_requirements.get(
        ShiftCategory.NIGHT_DUTY, 0
    ) + category_requirements.get(ShiftCategory.ON_CALL, 0)
    night_bounds = _rebalance_shift_minimums(
        bound_ctx.night_bounds, var_ctx.night_assignment_totals, night_slots
    )
    oncall_slots = category_requirements.get(ShiftCategory.ON_CALL, 0)
    oncall_bounds = _rebalance_shift_minimums(
        bound_ctx.oncall_bounds, var_ctx.oncall_assignment_totals, oncall_slots
    )
    evening_slots = category_requirements.get(ShiftCategory.EVENING, 0)
    evening_bounds = _rebalance_shift_minimums(
        bound_ctx.evening_bounds, var_ctx.evening_assignment_totals, evening_slots
    )

    hard_constraints.add_shift_count_constraints(
        model, var_ctx.night_assignment_totals, night_bounds
    )
    hard_constraints.add_shift_count_constraints(
        model, var_ctx.oncall_assignment_totals, oncall_bounds
    )
    hard_constraints.add_shift_count_constraints(
        model, var_ctx.evening_assignment_totals, evening_bounds
    )

    penalty_terms = soft_constraints.build_objective_terms(
        model,
        day_count=day_count,
        night_assignment_totals=var_ctx.night_assignment_totals,
        oncall_assignment_totals=var_ctx.oncall_assignment_totals,
        evening_assignment_totals=var_ctx.evening_assignment_totals,
        workday_totals_fulltime=var_ctx.workday_totals_fulltime,
        work_vars=var_ctx.workday_vars,
        holiday_requests=holiday_requests_by_person_day,
        holiday_request_vars=var_ctx.holiday_request_vars,
        weights=config.penalty_weights,
    )
    if penalty_terms:
        model.minimize(sum(penalty_terms))
    else:
        model.minimize(0)

    solver = cp_model.CpSolver()
    _configure_solver(solver)
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        status_name = solver.StatusName(status)
        if status == cp_model.UNKNOWN:
            raise SolverError(
                "Solver timed out before finding a feasible schedule. "
                f"(status={status_name}, limit={_SOLVER_TIMEOUT_SECONDS}s)"
            )
        raise SolverError(
            "No feasible schedule found for the given constraints. "
            f"(status={status_name})"
        )

    assignments: list[Assignment] = []
    for (person_id, day_idx, shift_id), var in var_ctx.assignment_vars.items():
        if solver.BooleanValue(var):
            assignments.append(
                Assignment(
                    person_id=person_id,
                    assignment_date=day_infos[day_idx].day_date,
                    shift_id=shift_id,
                )
            )

    assignments.sort(key=lambda a: (a.assignment_date, a.person_id, a.shift_id))
    return assignments


def _rebalance_shift_minimums(
    bounds: Mapping[str, tuple[int | None, int | None]],
    assignment_map: Mapping[str, Sequence[cp_model.IntVar]],
    total_required: int,
) -> dict[str, tuple[int | None, int | None]]:
    """Scale per-person minimum counts so their sum never exceeds total slots."""

    per_person: dict[str, dict[str, int | None]] = {}
    minima_total = 0
    for person_id, vars_ in assignment_map.items():
        if not vars_:
            continue
        lower, upper = bounds.get(person_id, (0, None))
        lower_val = max(0, lower or 0)
        per_person[person_id] = {"lower": lower_val, "upper": upper}
        minima_total += lower_val

    if not per_person:
        return {}

    if total_required <= 0:
        return {person_id: (0, info["upper"]) for person_id, info in per_person.items()}

    if minima_total <= total_required:
        return {
            person_id: (info["lower"], info["upper"])
            for person_id, info in per_person.items()
        }

    scale = total_required / minima_total
    fractional: list[tuple[float, str]] = []
    used = 0
    allocations: dict[str, dict[str, int]] = {}
    ceiling_sum = 0
    for person_id, info in per_person.items():
        target = (info["lower"] or 0) * scale
        floor_val = int(target)
        ceil_val = math.ceil(target)
        upper = info["upper"]
        if upper is not None:
            floor_val = min(floor_val, upper)
            ceil_val = min(ceil_val, upper)
        if ceil_val < floor_val:
            ceil_val = floor_val
        allocations[person_id] = {"value": floor_val, "ceil": ceil_val}
        used += floor_val
        ceiling_sum += ceil_val
        fractional.append((target - floor_val, person_id))

    target_sum = min(total_required, ceiling_sum)
    remaining = max(0, target_sum - used)
    fractional.sort(reverse=True)
    for _, person_id in fractional:
        if remaining <= 0:
            break
        entry = allocations[person_id]
        if entry["value"] >= entry["ceil"]:
            continue
        entry["value"] += 1
        remaining -= 1

    return {
        person_id: (entry["value"], per_person[person_id]["upper"])
        for person_id, entry in allocations.items()
    }
