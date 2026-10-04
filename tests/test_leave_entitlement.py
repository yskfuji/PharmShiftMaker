from datetime import date

import pytest

from shift_scheduler.domain.compliance import LeaveAccount
from shift_scheduler.domain.leave_entitlement import GrantAssessment
from shift_scheduler.validation.leave_entitlement import reconcile_grant


@pytest.mark.parametrize(
    "months,seconds,basis,days,attendance,expected",
    [
        (6, 29 * 3600, "weekly", 4, 80, 7),
        (6, 30 * 3600, "weekly", 4, 80, 10),
        (6, 20 * 3600, "weekly", 5, 80, 10),
        (6, 20 * 3600, "annual", 216, 80, 7),
        (6, 20 * 3600, "annual", 217, 80, 10),
        (6, 20 * 3600, "annual", 48, 80, 1),
        (6, 20 * 3600, "annual", 47, 80, None),
        (6, 20 * 3600, "weekly", 4, 79, 0),
        (5, 40 * 3600, "weekly", 5, 100, 0),
        (78, 40 * 3600, "weekly", 5, 100, 20),
        (90, 20 * 3600, "weekly", 3, 100, 11),
        (42, 20 * 3600, "weekly", 4, 100, 10),
    ],
)
def test_independent_table_boundaries(
    months, seconds, basis, days, attendance, expected
):
    evidence = {
        "reference": "synthetic HR basis",
        "status": "verified",
        "verified_by": "HR",
    }
    assessment = GrantAssessment(
        assessment_id="a",
        account_id="g",
        person_id="p",
        employer_id="e",
        basis_date="2026-01-01",
        completed_service_months=months,
        scheduled_week_seconds=seconds,
        schedule_basis=basis,
        **{"scheduled_week_days" if basis == "weekly" else "scheduled_year_days": days},
        attendance_days=attendance,
        attendance_denominator=100,
        evidence=evidence,
    )
    account = LeaveAccount(
        account_id="g",
        person_id="p",
        employer_id="e",
        granted_on="2026-01-01",
        expires_on="2028-01-01",
        statutory_days=expected or 0,
        granted_days=(expected or 0) + 2,
        evidence=evidence,
    )
    result = reconcile_grant(assessment, account)
    assert result["expected_statutory_days"] == expected
    assert result["status"] == ("unverified" if expected is None else "pass")
    if expected is not None:
        mismatch = reconcile_grant(
            assessment, account.model_copy(update={"statutory_days": expected + 1})
        )
        assert mismatch["status"] == "mismatch"
        assert account.statutory_days == expected


def test_complete_split_series_reconciliation_preserves_original_lots():
    evidence = {
        "reference": "HR complete split/advance series",
        "status": "verified",
        "verified_by": "HR",
    }
    first = LeaveAccount(
        account_id="early",
        person_id="p",
        employer_id="e",
        granted_on="2026-01-01",
        expires_on="2028-01-01",
        statutory_days=3,
        granted_days=3,
        grant_cycle_id="cycle",
        evidence=evidence,
    )
    last = first.model_copy(
        update={
            "account_id": "later",
            "granted_on": date(2026, 4, 1),
            "statutory_days": 7,
            "granted_days": 9,
        }
    )
    item = GrantAssessment(
        assessment_id="series",
        account_id="early",
        person_id="p",
        employer_id="e",
        basis_date="2026-04-01",
        completed_service_months=6,
        scheduled_week_seconds=40 * 3600,
        schedule_basis="weekly",
        scheduled_week_days=5,
        attendance_days=80,
        attendance_denominator=100,
        evidence=evidence,
        cycle_account_ids=("early", "later"),
        cycle_evidence=evidence,
    )
    result = reconcile_grant(item, first, (first, last))
    assert result["status"] == "pass"
    assert result["expected_statutory_days"] == result["imported_statutory_days"] == 10
    assert result["basis"]["company_extra_days"] == 2
    assert first.statutory_days == 3
    reduced = last.model_copy(update={"statutory_days": 6})
    assert reconcile_grant(item, first, (first, reduced))["status"] == "mismatch"
    # Claimed complete series cannot silently omit a projected lot, or include another employer.
    assert reconcile_grant(item, first, (first,))["status"] == "unverified"
    other = last.model_copy(update={"employer_id": "other"})
    assert reconcile_grant(item, first, (first, other))["status"] == "unverified"
    assert (
        reconcile_grant(
            item.model_copy(update={"cycle_evidence": None}), first, (first, last)
        )["status"]
        == "unverified"
    )


# G04: MHLW シフト制 guidance, 2026-06-19 revision, 2(4)ウ(ｱ). Expected values
# are read independently from the published proportional table (1 year column
# for the first grant at 6 months; 1.5 years column for the grant at 18 months).
@pytest.mark.parametrize(
    "months,period,actual,guideline,expected",
    [
        (6, "first_six_months", 24, None, 1),  # 24x2 = 48 days -> 1st group
        (6, "first_six_months", 23, None, None),  # 46 days: below the table
        (6, "first_six_months", 36, None, 1),  # 72 -> group 1
        (6, "first_six_months", 37, None, 3),  # 74 -> group 2 -> 3 days
        (6, "first_six_months", 60, None, 3),  # 120 -> group 2
        (6, "first_six_months", 61, None, 5),  # 122 -> group 3
        (6, "first_six_months", 84, None, 5),  # 168 -> group 3
        (6, "first_six_months", 85, None, 7),  # 170 -> group 4
        (6, "first_six_months", 108, None, 7),  # 216 -> group 4
        (6, "first_six_months", 109, None, 10),  # 218 -> full table
        (18, "previous_year", 121, None, 6),  # group 3, 1.5 years
        (18, "previous_year", 120, 169, 8),  # guideline gives more: group 4
        (18, "previous_year", 170, 100, 8),  # guideline gives less: actuals kept
    ],
)
def test_shift_actual_basis_boundaries(months, period, actual, guideline, expected):
    evidence = {
        "reference": "synthetic HR basis",
        "status": "verified",
        "verified_by": "HR",
    }
    assessment = GrantAssessment(
        assessment_id="a",
        account_id="g",
        person_id="p",
        employer_id="e",
        basis_date="2026-07-01",
        completed_service_months=months,
        scheduled_week_seconds=20 * 3600,
        schedule_basis="shift_actual",
        actual_work_days=actual,
        actual_period=period,
        guideline_year_days=guideline,
        attendance_days=90,
        attendance_denominator=100,
        evidence=evidence,
    )
    account = LeaveAccount(
        account_id="g",
        person_id="p",
        employer_id="e",
        granted_on="2026-07-01",
        expires_on="2028-07-01",
        statutory_days=expected or 0,
        granted_days=expected or 0,
        evidence=evidence,
    )
    result = reconcile_grant(assessment, account)
    assert result["expected_statutory_days"] == expected
    # A basis date on or after the revision is reconciled without the pre-revision hold.
    assert result["status"] == ("unverified" if expected is None else "pass")
    deemed = result["basis"]["deemed_year_days"]
    assert deemed["actual_based_days"] == actual * (
        2 if period == "first_six_months" else 1
    )
    if guideline is not None:
        assert deemed["used"] == ("guideline" if guideline == 169 else "actual")


def test_shift_actual_period_must_match_the_grant():
    evidence = {
        "reference": "synthetic HR basis",
        "status": "verified",
        "verified_by": "HR",
    }
    account = LeaveAccount(
        account_id="g",
        person_id="p",
        employer_id="e",
        granted_on="2026-01-01",
        expires_on="2028-01-01",
        statutory_days=3,
        granted_days=3,
        evidence=evidence,
    )
    later_with_six_months = GrantAssessment(
        assessment_id="a",
        account_id="g",
        person_id="p",
        employer_id="e",
        basis_date="2026-01-01",
        completed_service_months=18,
        scheduled_week_seconds=20 * 3600,
        schedule_basis="shift_actual",
        actual_work_days=40,
        actual_period="first_six_months",
        attendance_days=90,
        attendance_denominator=100,
        evidence=evidence,
    )
    result = reconcile_grant(later_with_six_months, account)
    assert (
        result["expected_statutory_days"] is None
        and "does not match" in result["findings"][0]
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"schedule_basis": "shift_actual", "actual_work_days": 40},  # period missing
        {
            "schedule_basis": "shift_actual",
            "actual_period": "previous_year",
        },  # days missing
        {
            "schedule_basis": "annual",
            "scheduled_year_days": 100,
            "guideline_year_days": 150,
        },
        {
            "schedule_basis": "shift_actual",
            "actual_work_days": 185,
            "actual_period": "first_six_months",
        },
    ],
)
def test_shift_actual_inputs_are_validated(fields):
    evidence = {
        "reference": "synthetic HR basis",
        "status": "verified",
        "verified_by": "HR",
    }
    with pytest.raises(ValueError):
        GrantAssessment(
            assessment_id="a",
            account_id="g",
            person_id="p",
            employer_id="e",
            basis_date="2026-01-01",
            completed_service_months=6,
            scheduled_week_seconds=20 * 3600,
            attendance_days=90,
            attendance_denominator=100,
            evidence=evidence,
            **fields,
        )


def test_six_months_may_contain_184_working_days():
    evidence = {
        "reference": "synthetic HR basis",
        "status": "verified",
        "verified_by": "HR",
    }
    GrantAssessment(
        assessment_id="a",
        account_id="g",
        person_id="p",
        employer_id="e",
        basis_date="2026-01-01",
        completed_service_months=6,
        scheduled_week_seconds=20 * 3600,
        schedule_basis="shift_actual",
        actual_work_days=184,
        actual_period="first_six_months",
        attendance_days=90,
        attendance_denominator=100,
        evidence=evidence,
    )
