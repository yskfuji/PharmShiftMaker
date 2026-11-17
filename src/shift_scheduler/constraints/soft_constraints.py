"""ソフト制約と目的関数を橋渡しするユーティリティ (README 5.2)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ortools.sat.python import cp_model

from shift_scheduler.domain import HolidayRequest
from shift_scheduler.optimizer.objectives import (
    build_consecutive_run_penalties,
    build_fairness_penalties,
    build_holiday_request_penalties,
)
from shift_scheduler.settings import PenaltyWeights

AssignmentMap = Mapping[str, Sequence[cp_model.IntVar]]
PersonDayVarMap = Mapping[tuple[str, int], cp_model.IntVar]


def build_objective_terms(
    model: cp_model.CpModel,
    *,
    day_count: int,
    night_assignment_totals: AssignmentMap,
    oncall_assignment_totals: AssignmentMap,
    evening_assignment_totals: AssignmentMap,
    workday_totals_fulltime: AssignmentMap,
    work_vars: PersonDayVarMap,
    holiday_requests: Mapping[tuple[str, int], HolidayRequest],
    holiday_request_vars: Mapping[tuple[str, int], cp_model.IntVar],
    weights: PenaltyWeights | None = None,
) -> list[cp_model.LinearExpr]:
    """各種ペナルティを組み立てて線形目的関数項を返す."""

    penalty_weights = weights or PenaltyWeights()
    penalty_terms: list[cp_model.LinearExpr] = []

    penalty_terms.extend(
        build_fairness_penalties(
            model,
            night_assignment_totals,
            label="night",
            day_count=day_count,
            weight=penalty_weights.night_fairness,
        )
    )
    penalty_terms.extend(
        build_fairness_penalties(
            model,
            oncall_assignment_totals,
            label="oncall",
            day_count=day_count,
            weight=penalty_weights.oncall_fairness,
        )
    )
    penalty_terms.extend(
        build_fairness_penalties(
            model,
            evening_assignment_totals,
            label="evening",
            day_count=day_count,
            weight=penalty_weights.evening_fairness,
        )
    )
    penalty_terms.extend(
        build_fairness_penalties(
            model,
            workday_totals_fulltime,
            label="workday",
            day_count=day_count,
            weight=penalty_weights.day_shift_fairness,
        )
    )

    penalty_terms.extend(
        build_consecutive_run_penalties(
            model,
            work_vars,
            day_count=day_count,
            weights_by_length={
                4: penalty_weights.consecutive_four,
                5: penalty_weights.consecutive_five,
                6: penalty_weights.consecutive_six,
            },
        )
    )

    penalty_terms.extend(
        build_holiday_request_penalties(
            holiday_requests,
            holiday_request_vars,
            weights=penalty_weights,
        )
    )

    return penalty_terms


__all__ = ["build_objective_terms", "PenaltyWeights"]
