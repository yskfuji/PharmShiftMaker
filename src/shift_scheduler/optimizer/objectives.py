"""目的関数向けのペナルティ定義 (README 5.2).

このモジュールではフェアネス・連勤抑制・希望休優先度といった
ソフト制約を CP-SAT の線形目的関数として表現する。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ortools.sat.python import cp_model

from shift_scheduler.domain import HolidayRequest
from shift_scheduler.settings import PenaltyWeights


def build_fairness_penalties(
    model: cp_model.CpModel,
    assignments_by_person: Mapping[str, Sequence[cp_model.IntVar]],
    *,
    label: str,
    day_count: int,
    weight: int,
) -> list[cp_model.LinearExpr]:
    """夜勤/当直/夕診の分布偏りに対するペナルティを生成する.

    偏りは (最大回数 - 最小回数) とし、範囲が広いほどペナルティを加算する。
    人数が1人以下、もしくは weight<=0 の場合はペナルティを返さない。
    """

    if weight <= 0 or len(assignments_by_person) <= 1:
        return []

    count_vars: list[cp_model.IntVar] = []
    for person_id, vars_ in assignments_by_person.items():
        upper = len(vars_)
        total_var = model.new_int_var(
            0, max(day_count, upper), f"{label}_count_{person_id}"
        )
        if vars_:
            model.add(total_var == sum(vars_))
        else:
            model.add(total_var == 0)
        count_vars.append(total_var)

    if len(count_vars) <= 1:
        return []

    max_var = model.new_int_var(0, day_count, f"{label}_max")
    min_var = model.new_int_var(0, day_count, f"{label}_min")
    for count_var in count_vars:
        model.add(max_var >= count_var)
        model.add(min_var <= count_var)

    spread = model.new_int_var(0, day_count, f"{label}_spread")
    model.add(spread == max_var - min_var)
    return [weight * spread]


def build_consecutive_run_penalties(
    model: cp_model.CpModel,
    work_vars: Mapping[tuple[str, int], cp_model.IntVar],
    *,
    day_count: int,
    weights_by_length: Mapping[int, int],
) -> list[cp_model.LinearExpr]:
    """4/5/6連勤に対する段階的ペナルティを作成する (README 5.2, 5.6)."""

    penalties: list[cp_model.LinearExpr] = []
    if not weights_by_length:
        return penalties

    person_ids = sorted({key[0] for key in work_vars})
    for person_id in person_ids:
        daily_sequence: list[cp_model.IntVar] = []
        for day_idx in range(day_count):
            var = work_vars.get((person_id, day_idx))
            if var is None:
                break
            daily_sequence.append(var)
        if len(daily_sequence) != day_count:
            continue

        for streak_len, weight in weights_by_length.items():
            if weight <= 0 or day_count < streak_len:
                continue
            for start in range(day_count - streak_len + 1):
                window = daily_sequence[start : start + streak_len]
                if len(window) < streak_len:
                    continue
                streak_var = model.new_bool_var(
                    f"{person_id}_consecutive_{start}_{streak_len}"
                )
                window_sum = sum(window)
                model.add(window_sum == streak_len).OnlyEnforceIf(streak_var)
                model.add(window_sum <= streak_len - 1).OnlyEnforceIf(streak_var.Not())
                penalties.append(weight * streak_var)
    return penalties


def build_holiday_request_penalties(
    holiday_requests: Mapping[tuple[str, int], HolidayRequest],
    approval_vars: Mapping[tuple[str, int], cp_model.IntVar],
    *,
    weights: PenaltyWeights,
) -> list[cp_model.LinearExpr]:
    """希望休が採用されなかった場合のペナルティを生成する."""

    penalties: list[cp_model.LinearExpr] = []
    if not holiday_requests:
        return penalties

    for key, request in holiday_requests.items():
        approval_var = approval_vars.get(key)
        if approval_var is None:
            continue
        penalty_weight = _holiday_penalty_weight(request.order, weights)
        penalties.append(penalty_weight * (1 - approval_var))
    return penalties


def _holiday_penalty_weight(order: int, weights: PenaltyWeights) -> int:
    bonus_steps = max(0, weights.holiday_request_priority_span - order)
    return max(
        weights.holiday_request_min_penalty,
        weights.holiday_request_base
        + bonus_steps * weights.holiday_request_priority_bonus,
    )


__all__ = [
    "PenaltyWeights",
    "build_fairness_penalties",
    "build_consecutive_run_penalties",
    "build_holiday_request_penalties",
]
