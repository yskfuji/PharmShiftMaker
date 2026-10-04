"""README 5.3/5.4 に基づくハード制約ユーティリティ."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TypeAlias, cast

from ortools.sat.python import cp_model

from shift_scheduler.domain import HolidayRequestKind

LinearExprT: TypeAlias = cp_model.LinearExpr


def _sum(vars_: Sequence[cp_model.IntVar]) -> LinearExprT:
    if not vars_:
        return cast(LinearExprT, 0)
    return cast(LinearExprT, sum(vars_))


def add_cover_constraints(
    model: cp_model.CpModel,
    shift_requirements: Mapping[tuple[int, str], int],
    day_shift_assignments: Mapping[tuple[int, str], Sequence[cp_model.IntVar]],
) -> None:
    """README 5.3-1『カバー率』の制約を追加する."""

    for key, required in shift_requirements.items():
        vars_ = day_shift_assignments.get(key, [])
        model.add(_sum(vars_) == required)


def add_single_shift_per_day_constraints(
    model: cp_model.CpModel,
    person_day_assignments: Mapping[tuple[str, int], Sequence[cp_model.IntVar]],
    y_vars: Mapping[tuple[str, int], cp_model.IntVar],
    work_vars: Mapping[tuple[str, int], cp_model.IntVar],
) -> None:
    """README 5.3-2『1人1日あたりのシフト数』を y 変数と結びつける."""

    for key, y_var in y_vars.items():
        vars_ = person_day_assignments.get(key, [])
        work_var = work_vars[key]
        sum_x = _sum(vars_)
        model.add(sum_x + y_var == 1)
        model.add(sum_x == work_var)


def add_night_oncall_nextday_off_constraints(
    model: cp_model.CpModel,
    night_assignments: Mapping[tuple[str, int], Sequence[cp_model.IntVar]],
    oncall_assignments: Mapping[tuple[str, int], Sequence[cp_model.IntVar]],
    y_vars: Mapping[tuple[str, int], cp_model.IntVar],
    day_count: int,
) -> None:
    """README 5.3-4『夜勤/当直翌日の休日』制約（終了翌日まで休暇）."""

    def _link(
        assignments: Mapping[tuple[str, int], Sequence[cp_model.IntVar]], offset: int
    ) -> None:
        for (person_id, day_idx), vars_ in assignments.items():
            if not vars_:
                continue
            rest_idx = day_idx + offset
            if rest_idx >= day_count:
                continue
            rest_key = (person_id, rest_idx)
            rest_var = y_vars.get(rest_key)
            if rest_var is None:
                continue
            model.add(_sum(vars_) <= rest_var)

    for assignments in (night_assignments, oncall_assignments):
        # 1日目: 夜勤/当直が終わった当日を休日扱い
        _link(assignments, offset=1)
        # 2日目: 終了日の翌日も完全休養扱い
        _link(assignments, offset=2)


def add_consecutive_days_constraints(
    model: cp_model.CpModel,
    work_vars: Mapping[tuple[str, int], cp_model.IntVar],
    max_consecutive_by_person: Mapping[str, int],
    day_count: int,
) -> None:
    """README 5.3-10『連勤6日まで』の制約."""

    for person_id, max_run in max_consecutive_by_person.items():
        if max_run <= 0:
            continue
        work_list = [work_vars[(person_id, day)] for day in range(day_count)]
        window = max_run + 1
        for start in range(0, day_count - window + 1):
            model.add(_sum(work_list[start : start + window]) <= max_run)


def add_newcomer_ward_pairing_constraints(
    model: cp_model.CpModel,
    ward_assignments_newcomer: Mapping[tuple[int, str], Sequence[cp_model.IntVar]],
    ward_assignments_veteran: Mapping[tuple[int, str], Sequence[cp_model.IntVar]],
) -> None:
    """README 5.3-7『新人病棟ペアリング』をシフト単位で課す."""

    for shift_key, newcomers in ward_assignments_newcomer.items():
        if not newcomers:
            continue
        veterans = ward_assignments_veteran.get(shift_key, [])
        model.add(_sum(newcomers) <= _sum(veterans))


def add_assistant_day_shift_pairing_constraints(
    model: cp_model.CpModel,
    assistant_day_assignments: Mapping[int, Sequence[cp_model.IntVar]],
    pharmacist_day_assignments: Mapping[int, Sequence[cp_model.IntVar]],
) -> None:
    """README 3.5/5.3-8『調剤補佐は薬剤師とペア』の制約."""

    for day_idx, assistant_vars in assistant_day_assignments.items():
        if not assistant_vars:
            continue
        pharmacists = pharmacist_day_assignments.get(day_idx, [])
        model.add(_sum(assistant_vars) <= _sum(pharmacists))


def add_offday_count_constraints(
    model: cp_model.CpModel,
    offday_vars_by_person: Mapping[str, Sequence[cp_model.IntVar]],
    baseline_offdays: Mapping[str, int],
    bonus_vars_by_person: Mapping[str, Sequence[cp_model.IntVar]],
) -> None:
    """README 5.3-9『休日数 = 基準休日 + 有給採用数』を等式で課す."""

    for person_id, vars_ in offday_vars_by_person.items():
        if not vars_:
            continue
        baseline = baseline_offdays.get(person_id)
        if baseline is None:
            continue
        bonus_vars = bonus_vars_by_person.get(person_id, [])
        rhs_expr: LinearExprT = cast(LinearExprT, baseline)
        if bonus_vars:
            rhs_expr = rhs_expr + _sum(bonus_vars)
        model.add(_sum(vars_) >= rhs_expr)


def add_holiday_request_hard_constraints(
    model: cp_model.CpModel,
    approval_vars_by_day: Mapping[int, Sequence[cp_model.IntVar]],
    day_limits: Mapping[int, int],
) -> None:
    """README 5.4 の日別採用人数上限."""

    for day_idx, vars_ in approval_vars_by_day.items():
        if not vars_:
            continue
        limit = day_limits.get(day_idx, len(vars_))
        model.add(_sum(vars_) <= limit)


def add_shift_count_constraints(
    model: cp_model.CpModel,
    assignment_map: Mapping[str, Sequence[cp_model.IntVar]],
    bounds: Mapping[str, tuple[int | None, int | None]],
) -> None:
    """README 5.3-5/6『夜勤・当直・夕診回数』の上下限制約."""

    for person_id, vars_ in assignment_map.items():
        if not vars_:
            continue
        lower, upper = bounds.get(person_id, (None, None))
        if lower is not None:
            model.add(_sum(vars_) >= lower)
        if upper is not None:
            model.add(_sum(vars_) <= upper)


def add_leave_quota_constraints(
    model: cp_model.CpModel,
    request_groups: Mapping[tuple[str, HolidayRequestKind], Sequence[cp_model.IntVar]],
    quota_limits: Mapping[tuple[str, HolidayRequestKind], int],
) -> None:
    """Restrict the number of approved special-leave requests per person."""

    for key, vars_ in request_groups.items():
        if not vars_:
            continue
        limit = quota_limits.get(key)
        if limit is None:
            continue
        if limit <= 0:
            for var in vars_:
                model.add(var == 0)
            continue
        model.add(_sum(vars_) <= limit)
