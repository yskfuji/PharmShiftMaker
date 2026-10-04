from datetime import date, datetime
from fractions import Fraction

import pytest

from shift_scheduler.domain.compliance import LeaveAccount
from shift_scheduler.domain.compliance_v3 import LeaveObligationV3
from shift_scheduler.validation.leave_obligations import boundary, obligation_window
from tests.test_reviewed_planning import snapshot

EV = snapshot().policy_evidence


def grant(identity, day, days=10, cycle=None):
    return LeaveAccount(
        account_id=identity,
        person_id="p0",
        employer_id="hospital",
        granted_on=day,
        expires_on="2030-01-01",
        statutory_days=days,
        granted_days=days,
        grant_cycle_id=cycle,
        evidence=EV,
    )


@pytest.mark.parametrize("half,expected", [(True, 15), (False, 16)])
def test_official_q9_oct22_to_apr1_exact_fraction(half, expected):
    grants = [grant("first", "2026-10-22"), grant("second", "2027-04-01")]
    obligation = LeaveObligationV3(
        obligation_id="window",
        person_id="p0",
        employer_id="hospital",
        start="2026-10-22",
        end="2028-04-01",
        required_half_days=expected,
        qualifying_grant_ids=("first", "second"),
        evidence=EV,
        method="consolidated",
        rounding_unit="half_day" if half else "day",
        half_day_request_evidence=EV if half else None,
    )
    required, credit, trace = obligation_window(
        obligation, grants, datetime.fromisoformat("2028-04-01T00:00:00+09:00")
    )
    assert required == expected
    assert (
        trace["whole_months"] == 17
        and trace["residual_days"] == 10
        and trace["last_month_days"] == 31
    )
    assert Fraction(
        **{
            "numerator": trace["unrounded_days"]["numerator"],
            "denominator": trace["unrounded_days"]["denominator"],
        }
    ) == Fraction(2685, 372)


def test_split_cycle_cannot_be_created_by_carryover_sum():
    grants = [
        grant("first", "2026-04-01", 5, "first-year"),
        grant("second", "2026-10-01", 5, "first-year"),
    ]
    obligation = LeaveObligationV3(
        obligation_id="split",
        person_id="p0",
        employer_id="hospital",
        start="2026-10-01",
        end="2027-10-01",
        qualifying_grant_ids=("first", "second"),
        evidence=EV,
        method="split_advance",
    )
    required, credit, _ = obligation_window(
        obligation, grants, datetime.fromisoformat("2027-10-01T00:00:00+09:00")
    )
    assert required == 10 and credit == date(2026, 4, 1)
    unrelated = [
        grants[0],
        grants[1].model_copy(update={"grant_cycle_id": "different-year"}),
    ]
    with pytest.raises(ValueError):
        obligation_window(
            obligation, unrelated, datetime.fromisoformat("2027-10-01T00:00:00+09:00")
        )


def test_missing_half_day_request_does_not_reduce_rounding():
    grants = [grant("a", "2026-10-01"), grant("b", "2027-04-01")]
    obligation = LeaveObligationV3(
        obligation_id="w",
        person_id="p0",
        employer_id="hospital",
        start="2026-10-01",
        end="2028-04-01",
        required_half_days=15,
        qualifying_grant_ids=("a", "b"),
        evidence=EV,
        method="consolidated",
        rounding_unit="half_day",
    )
    with pytest.raises(ValueError, match="request"):
        obligation_window(
            obligation, grants, datetime.fromisoformat("2028-04-01T00:00:00+09:00")
        )


def test_missing_corresponding_date_ends_at_month_end_inclusive():
    assert boundary(date(2026, 1, 31), 1) == date(2026, 3, 1)
    assert boundary(date(2024, 2, 29), 12) == date(2025, 3, 1)
