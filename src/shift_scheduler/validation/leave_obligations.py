"""MHLW 2018-1228-15, annual leave Q9: exact month fractions and rounding trace."""

import calendar
import math
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from fractions import Fraction
from typing import Any

from shift_scheduler.domain.compliance import LeaveAccount
from shift_scheduler.domain.compliance_v3 import LeaveObligationV3
from shift_scheduler.validation.work_accounting import verified


def boundary(anchor: date, offset: int) -> date:
    index = anchor.year * 12 + anchor.month - 1 + offset
    year, month = divmod(index, 12)
    month += 1
    last = calendar.monthrange(year, month)[1]
    return (
        date(year, month, anchor.day)
        if anchor.day <= last
        else date(year, month, last) + timedelta(days=1)
    )


def obligation_window(
    obligation: LeaveObligationV3, grants: Sequence[LeaveAccount], until: datetime
) -> tuple[int, date, dict[str, Any]]:
    """Return required half-days, earliest credit date and verifiable calculation."""
    groups: dict[str, list[LeaveAccount]] = {}
    for g in grants:
        groups.setdefault(g.grant_cycle_id or g.account_id, []).append(g)
    thresholds = []
    for members in groups.values():
        total = 0
        for grant in sorted(members, key=lambda g: (g.granted_on, g.account_id)):
            total += grant.statutory_days
            if total >= 10:
                thresholds.append(grant.granted_on)
                break
    method = obligation.method
    if method == "consolidated":
        if (
            len(thresholds) != 2
            or min(thresholds) != obligation.start
            or boundary(max(thresholds), 12) != obligation.end
        ):
            raise ValueError(
                "Consolidated obligation requires two verified qualifying basis dates"
            )
        if not min(thresholds) < max(thresholds):
            # Two grants reaching ten days on the same date are one base date, not
            # two to consolidate (duplicate or split import of one grant).
            raise ValueError(
                "Consolidation requires two different qualifying basis dates"
            )
        if not max(thresholds) < boundary(min(thresholds), 12):
            raise ValueError("Consolidation requires overlapping obligation years")
    elif (
        len(thresholds) != 1
        or thresholds[0] != obligation.start
        or boundary(obligation.start, 12) != obligation.end
    ):
        raise ValueError(
            "Obligation basis must match the date the grant cycle reaches ten days"
        )
    if method == "split_advance" and (len(groups) != 1 or len(grants) < 2):
        raise ValueError(
            "Split-advance credit requires a single documented split grant cycle"
        )
    months = 0
    while boundary(obligation.start, months + 1) <= obligation.end:
        months += 1
    residual = (obligation.end - boundary(obligation.start, months)).days
    denominator = (
        boundary(obligation.start, months + 1) - boundary(obligation.start, months)
    ).days
    month_count = Fraction(months) + Fraction(residual, denominator)
    days = month_count * Fraction(5, 12)
    half = obligation.rounding_unit == "half_day"
    if half and not verified(obligation.half_day_request_evidence, until):
        raise ValueError("Half-day rounding requires the worker request evidence")
    required = math.ceil(days * 2) if half else math.ceil(days) * 2
    if obligation.required_half_days != required:
        raise ValueError(
            "Obligation quantity differs from independently derived statutory window"
        )
    credit_start = (
        min(g.granted_on for g in grants)
        if method == "split_advance"
        else obligation.start
    )
    return (
        required,
        credit_start,
        {
            "whole_months": months,
            "residual_days": residual,
            "last_month_days": denominator,
            "unrounded_days": {
                "numerator": days.numerator,
                "denominator": days.denominator,
            },
            "rounding_unit": obligation.rounding_unit,
            "required_half_days": required,
            "source": "MHLW-2018-1228-15 annual-leave Q9",
        },
    )
