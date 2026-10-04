"""G04: the actual-days method on basis dates before the 2026-06-19 revision.

The MHLW シフト制 guidance interprets current law and has no effective date. The
actual-days method was published for home-visit care in 2004 (平16.8.27基発0827001号)
and generally only in the 2026-06-19 revision. Decision (user, 2026-09-27): for an
earlier basis date the grant is still calculated, but the result is unverified
until HR records that it applied the method. The version used is recorded.
Expected values are read from the published proportional table: 37 days x2 = 74
days -> group 2 -> 3 days at six months.
"""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.domain.compliance import LeaveAccount
from shift_scheduler.domain.leave_entitlement import GrantAssessment
from shift_scheduler.validation.leave_entitlement import reconcile_grant

EVIDENCE = {
    "reference": "synthetic HR basis",
    "status": "verified",
    "verified_by": "HR",
}
CONFIRMED = {
    "reference": "synthetic HR record: method applied before the revision",
    "status": "verified",
    "verified_by": "HR",
}


def case(basis_date, statutory=3, **fields):
    values = {
        "assessment_id": "a",
        "account_id": "g",
        "person_id": "p",
        "employer_id": "e",
        "basis_date": basis_date,
        "completed_service_months": 6,
        "scheduled_week_seconds": 20 * 3600,
        "schedule_basis": "shift_actual",
        "actual_work_days": 37,
        "actual_period": "first_six_months",
        "attendance_days": 90,
        "attendance_denominator": 100,
        "evidence": EVIDENCE,
        **fields,
    }
    account = LeaveAccount(
        account_id="g",
        person_id="p",
        employer_id="e",
        granted_on=basis_date,
        expires_on="2029-01-01",
        statutory_days=statutory,
        granted_days=statutory,
        evidence=EVIDENCE,
    )
    return reconcile_grant(GrantAssessment(**values), account)


def test_the_revision_day_is_reconciled_normally():
    result = case("2026-06-19")
    assert (result["status"], result["expected_statutory_days"]) == ("pass", 3)
    assert result["guidance"] == {
        "version": "2026-06-19",
        "basis_before_revision": False,
        "confirmed": None,
    }
    assert result["findings"] == []


@pytest.mark.parametrize(("statutory", "computed"), [(3, "pass"), (4, "mismatch")])
def test_an_earlier_basis_date_is_calculated_but_held_for_hr(statutory, computed):
    result = case("2026-06-18", statutory)
    assert result["expected_statutory_days"] == 3
    assert (result["status"], result["computed_status"]) == ("unverified", computed)
    assert result["guidance"]["basis_before_revision"] is True
    assert "平16.8.27基発0827001号" in result["findings"][-1]


def test_an_hr_confirmation_restores_the_calculated_result():
    result = case("2026-06-18", guidance_confirmation=CONFIRMED)
    assert (result["status"], result["guidance"]["confirmed"]) == ("pass", True)
    assert "computed_status" not in result
    mismatch = case("2026-06-18", 4, guidance_confirmation=CONFIRMED)
    assert mismatch["status"] == "mismatch"


@pytest.mark.parametrize(
    "confirmation",
    [
        {**CONFIRMED, "status": "unverified"},
        {
            **CONFIRMED,
            "valid_until": "2026-06-17T00:00:00+09:00",
        },  # expired before the basis date
    ],
)
def test_an_unverified_or_expired_confirmation_does_not_count(confirmation):
    result = case("2026-06-18", guidance_confirmation=confirmation)
    assert (result["status"], result["guidance"]["confirmed"]) == ("unverified", False)


def test_thirty_hours_a_week_does_not_use_the_proportional_table():
    # 30h or more: full table (10 days at six months); the actual-days method is not used.
    result = case("2026-01-01", 10, scheduled_week_seconds=30 * 3600)
    assert (result["status"], result["expected_statutory_days"]) == ("pass", 10)
    assert "guidance" not in result


@pytest.mark.parametrize(
    "fields",
    [
        {
            "basis_date": "2026-06-19",
            "guidance_confirmation": CONFIRMED,
        },  # not before the revision
        {
            "schedule_basis": "weekly",
            "scheduled_week_days": 3,
            "actual_work_days": None,
            "actual_period": None,
            "guidance_confirmation": CONFIRMED,
        },  # not the actual-days method
    ],
)
def test_a_confirmation_is_refused_where_it_has_no_meaning(fields):
    values = {
        "assessment_id": "a",
        "account_id": "g",
        "person_id": "p",
        "employer_id": "e",
        "basis_date": "2026-01-01",
        "completed_service_months": 6,
        "scheduled_week_seconds": 20 * 3600,
        "schedule_basis": "shift_actual",
        "actual_work_days": 37,
        "actual_period": "first_six_months",
        "attendance_days": 90,
        "attendance_denominator": 100,
        "evidence": EVIDENCE,
        **fields,
    }
    with pytest.raises(ValueError):
        GrantAssessment(**values)


def test_the_stored_form_of_an_assessment_without_confirmation_is_unchanged():
    values = {
        "assessment_id": "a",
        "account_id": "g",
        "person_id": "p",
        "employer_id": "e",
        "basis_date": "2026-01-01",
        "completed_service_months": 6,
        "scheduled_week_seconds": 20 * 3600,
        "schedule_basis": "shift_actual",
        "scheduled_week_days": None,
        "scheduled_year_days": None,
        "actual_work_days": 37,
        "actual_period": "first_six_months",
        "attendance_days": 90,
        "attendance_denominator": 100,
        "evidence": {**EVIDENCE, "valid_until": None},
    }
    assert GrantAssessment(**values).model_dump(mode="json") == values


def test_the_api_records_the_guidance_and_the_hold(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare
    from tests.test_grant_assessment_api import assessment

    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(
            BASE + "/grant-assessments/context" + QUERY, headers=admin
        ).json()
        request = assessment(context)
        # The fixture grant g0 is on 2026-01-01 with 5 statutory days: 61 x2 = 122 days -> group 3.
        request["payload"].update(
            schedule_basis="shift_actual",
            scheduled_week_days=None,
            actual_work_days=61,
            actual_period="first_six_months",
        )
        held = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert held.status_code == 200, held.text
        assert (held.json()["status"], held.json()["computed_status"]) == (
            "unverified",
            "pass",
        )
        assert held.json()["guidance"]["basis_before_revision"] is True
        request["idempotency_key"] = "assessment-confirmed"
        request["payload"]["guidance_confirmation"] = request["payload"]["evidence"]
        confirmed = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["status"] == "pass"
        assert (
            confirmed.json()["assessment"]["guidance_confirmation"]
            == request["payload"]["evidence"]
        )


def test_early_results_before_the_revision_also_carry_the_reason():
    # 23 x2 = 46 days: below the table, so no grant is calculated; the reason for
    # the missing confirmation is still given.
    result = case("2026-06-18", 0, actual_work_days=23)
    assert (
        result["expected_statutory_days"] is None and result["status"] == "unverified"
    )
    assert "平16.8.27基発0827001号" in result["findings"][-1]
    # On or after the revision no confirmation is needed: recorded as None, not False.
    assert case("2026-06-19")["guidance"]["confirmed"] is None
