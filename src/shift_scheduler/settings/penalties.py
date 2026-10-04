"""Penalty weight definitions shared between data loaders and the optimizer."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PenaltyWeights:
    """Container for penalty tuning parameters (README 5.5)."""

    night_fairness: int = 30
    oncall_fairness: int = 24
    evening_fairness: int = 24
    day_shift_fairness: int = 12
    consecutive_four: int = 6
    consecutive_five: int = 10
    consecutive_six: int = 16
    holiday_request_base: int = 10
    holiday_request_priority_bonus: int = 3
    holiday_request_priority_span: int = 4
    holiday_request_min_penalty: int = 2
