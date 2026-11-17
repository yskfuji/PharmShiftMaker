"""L06 combined hours across employers, hand-computed (no database needed).

Rule under test (基発0901第3号): scheduled hours are added in the order the
contracts were concluded, then extra hours in the order they occur; the
employer whose hours pass 8h a day bears that overtime.
"""

import pytest

from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import totals, work_fixture


def payers(specs, orders=(1, 2)):
    data = work_fixture(specs, orders)
    return totals(account_work(data, list(data.candidates)))


def test_later_contract_bears_excess_even_when_its_hours_come_first_in_the_day():
    # B (second contract) works 06-10 scheduled, A (first) 13-19 scheduled.
    # Contract order: A 6h then B 4h = 10h, so B's last 2h are the excess.
    assert payers([("B", 0, 6, 4, 4), ("A", 0, 13, 6, 6)]) == {
        "A": 0,
        "B": 7200,
        "C": 0,
    }


def test_extra_hours_follow_occurrence_after_all_scheduled_hours():
    # A: 06-14 with 6h scheduled + 2h extra; B: 15-19 scheduled 4h.
    # Scheduled first: A 6h + B 4h = 10h -> B 2h excess; then A's 2h extra -> A 2h.
    assert payers([("A", 0, 6, 8, 6), ("B", 0, 15, 4, 4)]) == {
        "A": 7200,
        "B": 7200,
        "C": 0,
    }


@pytest.mark.parametrize("b_hours,expected_b", [(2, 0), (2 + 1 / 3600, 1)])
def test_combined_daily_boundary_to_the_second(b_hours, expected_b):
    # A 6h scheduled + B scheduled b_hours: excess only beyond exactly 8h.
    result = payers([("A", 0, 7, 6, 6), ("B", 0, 15, b_hours, b_hours)])
    assert result == {"A": 0, "B": expected_b, "C": 0}


def test_three_contracts_attribute_excess_in_contract_order():
    # Orders A1, B2, C3: 4h each scheduled on the same day = 12h; the third
    # contract C bears 4h (B stays within 8h).
    data = work_fixture(
        [("A", 0, 6, 4, 4), ("B", 0, 11, 4, 4), ("C", 0, 16, 4, 4)], orders=(1, 2, 3)
    )
    assert totals(account_work(data, list(data.candidates))) == {
        "A": 0,
        "B": 0,
        "C": 4 * 3600,
    }
