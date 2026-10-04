"""MHLW annual-leave table, standard grant dates; no automatic grant or denial.

Advance/split grants need the separately reviewed cycle and obligation projection.
Attendance denominator/credited days and service continuity come from external HR.
"""

from collections.abc import Iterable
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from shift_scheduler.domain.compliance import LeaveAccount
from shift_scheduler.domain.leave_entitlement import GUIDANCE_REVISION, GrantAssessment
from shift_scheduler.validation.work_accounting import verified

SOURCE = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/faq/kijyunhou_6_00001.html"
SHIFT_SOURCE = "https://www.mhlw.go.jp/content/11200000/001713615.pdf#2(4)ウ(ｱ)"
PRE_REVISION_NOTE = (
    "Basis date before the 2026-06-19 guidance revision: the only earlier published statement of "
    "the actual-days method was for home-visit care (平16.8.27基発0827001号); an HR confirmation record is required"
)
TABLE = {
    5: (10, 11, 12, 14, 16, 18, 20),
    4: (7, 8, 9, 10, 12, 13, 15),
    3: (5, 6, 6, 8, 9, 10, 11),
    2: (3, 4, 4, 5, 6, 6, 7),
    1: (1, 2, 2, 2, 3, 3, 3),
}


def reconcile_grant(
    assessment: GrantAssessment,
    account: LeaveAccount,
    accounts: Iterable[LeaveAccount] = (),
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "assessment_id": assessment.assessment_id,
        "account_id": account.account_id,
        "source": SOURCE,
        "status": "unverified",
        "expected_statutory_days": None,
        "imported_statutory_days": account.statutory_days,
        "findings": [],
    }
    if (account.account_id, account.person_id, account.employer_id) != (
        assessment.account_id,
        assessment.person_id,
        assessment.employer_id,
    ):
        raise ValueError(
            "Grant assessment refers to another account, person or employer"
        )
    if not verified(
        assessment.evidence,
        datetime.combine(assessment.basis_date, time(), ZoneInfo("Asia/Tokyo")),
    ):
        result["findings"].append(
            "HR continuity, attendance or schedule basis is unverified"
        )
        return result
    members = [account]
    if (
        account.granted_on != assessment.basis_date
        or account.grant_cycle_id
        or assessment.cycle_account_ids
    ):
        until = datetime.combine(assessment.basis_date, time(), ZoneInfo("Asia/Tokyo"))
        if not account.grant_cycle_id or not verified(assessment.cycle_evidence, until):
            result["findings"].append(
                "Advance/split grant requires verified complete HR series"
            )
            return result
        members = [
            a
            for a in accounts
            if a.grant_cycle_id == account.grant_cycle_id
            and (a.person_id, a.employer_id) == (account.person_id, account.employer_id)
        ]
        if (
            not members
            or {a.account_id for a in members} != set(assessment.cycle_account_ids)
            or account.account_id not in assessment.cycle_account_ids
            or any(a.granted_on > assessment.basis_date for a in members)
            or any(not verified(a.evidence, until) for a in members)
        ):
            result["findings"].append(
                "Grant series is incomplete, unverified or after the reviewed basis date"
            )
            return result
        result.update(
            grant_cycle_id=account.grant_cycle_id,
            cycle_account_ids=sorted(a.account_id for a in members),
            imported_statutory_days=sum(a.statutory_days for a in members),
        )
    if (
        assessment.schedule_basis == "shift_actual"
        and assessment.scheduled_week_seconds < 30 * 3600
    ):
        # The calculation follows the revised guidance; for an earlier basis date
        # the result stays unverified until HR records that it applied the method.
        before = assessment.basis_date < GUIDANCE_REVISION
        result["guidance"] = {
            "version": GUIDANCE_REVISION.isoformat(),
            "basis_before_revision": before,
            # None: no confirmation is needed on or after the revision.
            "confirmed": (
                verified(
                    assessment.guidance_confirmation,
                    datetime.combine(
                        assessment.basis_date, time(), ZoneInfo("Asia/Tokyo")
                    ),
                )
                if before
                else None
            ),
        }
    group = 5
    deemed = None
    if assessment.scheduled_week_seconds < 30 * 3600:
        if assessment.schedule_basis == "weekly":
            assert assessment.scheduled_week_days is not None  # GrantAssessment.inputs
            group = min(5, assessment.scheduled_week_days)
        else:
            if assessment.schedule_basis == "shift_actual":
                expected_period = (
                    "first_six_months"
                    if assessment.completed_service_months < 18
                    else "previous_year"
                )
                if assessment.actual_period != expected_period:
                    result["findings"].append(
                        "Actual-days period does not match the grant: first grant uses six months x2, later grants the previous year"
                    )
                    return _pre_revision(result)
                assert assessment.actual_work_days is not None  # GrantAssessment.inputs
                actual = assessment.actual_work_days * (
                    2 if assessment.actual_period == "first_six_months" else 1
                )
                deemed = {
                    "actual_based_days": actual,
                    "guideline_year_days": assessment.guideline_year_days,
                    "source": SHIFT_SOURCE,
                }
                days = actual
                # A guideline may be used only when it yields more leave than the actuals.
                if assessment.guideline_year_days is not None and _group(
                    assessment.guideline_year_days
                ) > _group(actual):
                    days = assessment.guideline_year_days
                deemed["used"] = "guideline" if days != actual else "actual"
            else:
                assert (
                    assessment.scheduled_year_days is not None
                )  # GrantAssessment.inputs
                days = assessment.scheduled_year_days
            if days < 48:
                result["findings"].append(
                    "Annual schedule below the published proportional table; HR determination required"
                )
                if deemed:
                    result["basis"] = {"deemed_year_days": deemed}
                return _pre_revision(result)
            group = _group(days)
    expected = 0
    if (
        assessment.completed_service_months >= 6
        and assessment.attendance_days * 5 >= assessment.attendance_denominator * 4
    ):
        stage = min(6, (assessment.completed_service_months - 6) // 12)
        expected = TABLE[group][stage]
    result.update(
        expected_statutory_days=expected,
        status="pass" if result["imported_statutory_days"] == expected else "mismatch",
        basis={
            "group": group,
            "completed_service_months": assessment.completed_service_months,
            **({"deemed_year_days": deemed} if deemed else {}),
            "attendance_fraction": [
                assessment.attendance_days,
                assessment.attendance_denominator,
            ],
            "company_extra_days": sum(
                a.granted_days - a.statutory_days for a in members
            ),
        },
    )
    if result["status"] == "mismatch":
        result["findings"].append(
            "Imported statutory entitlement differs; retain original and refer to HR"
        )
    guidance = result.get("guidance")
    if guidance and guidance["basis_before_revision"] and not guidance["confirmed"]:
        result.update(computed_status=result["status"], status="unverified")
    return _pre_revision(result)


def _pre_revision(result: dict[str, Any]) -> dict[str, Any]:
    """Every unconfirmed pre-revision result carries the reason, also on early returns."""
    guidance = result.get("guidance")
    if guidance and guidance["basis_before_revision"] and not guidance["confirmed"]:
        result["findings"].append(PRE_REVISION_NOTE)
    return result


def _group(days: int) -> int:
    """Proportional-table group for annual scheduled days (0: below the table)."""
    return (
        0
        if days < 48
        else (
            1
            if days <= 72
            else 2 if days <= 120 else 3 if days <= 168 else 4 if days <= 216 else 5
        )
    )
