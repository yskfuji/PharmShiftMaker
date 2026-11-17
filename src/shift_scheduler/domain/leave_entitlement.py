"""HR remains the authority for continuity/attendance; this is an import reconciliation."""

from datetime import date
from typing import Literal, Self

from pydantic import Field, model_validator

from .planning import Evidence, Value

# MHLW シフト制 guidance revision that states the actual-days method (2(4)ウ(ｱ)).
# The guidance interprets current law and has no effective date; before it, the
# only published statement was for home-visit care (平16.8.27基発0827001号).
GUIDANCE_REVISION = date(2026, 6, 19)


class GrantAssessment(Value):
    assessment_id: str
    account_id: str
    person_id: str
    employer_id: str
    basis_date: date
    completed_service_months: int = Field(ge=0)
    scheduled_week_seconds: int = Field(ge=0)
    # "shift_actual": scheduled days cannot be fixed in advance (シフト制). The
    # MHLW guidance (2026-06-19 revision, 2(4)ウ(ｱ)) allows deeming the actual
    # working days as the annual scheduled days: first six months x2 for the
    # first grant, the previous year afterwards. HR supplies the actual count.
    schedule_basis: Literal["weekly", "annual", "shift_actual"]
    scheduled_week_days: int | None = Field(default=None, ge=1, le=7)
    scheduled_year_days: int | None = Field(default=None, ge=1, le=366)
    # Omitted when unset so existing assessments keep their stored form and hash.
    actual_work_days: int | None = Field(
        default=None, ge=0, le=366, exclude_if=lambda v: v is None
    )
    actual_period: Literal["first_six_months", "previous_year"] | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    guideline_year_days: int | None = Field(
        default=None, ge=1, le=366, exclude_if=lambda v: v is None
    )
    attendance_days: int = Field(ge=0)
    attendance_denominator: int = Field(gt=0)
    evidence: Evidence
    # Explicit HR confirmation of the complete series, never inferred from a total.
    cycle_account_ids: tuple[str, ...] = Field(default=(), exclude_if=lambda v: not v)
    cycle_evidence: Evidence | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    # HR record that the actual-days method was also used for a basis date before
    # the guidance revision (GUIDANCE_REVISION); optional so stored hashes are kept.
    guidance_confirmation: Evidence | None = Field(
        default=None, exclude_if=lambda v: v is None
    )

    @model_validator(mode="after")
    def inputs(self) -> Self:
        if len(set(self.cycle_account_ids)) != len(self.cycle_account_ids):
            raise ValueError("Duplicate grant-series member")
        if bool(self.cycle_account_ids) != (self.cycle_evidence is not None):
            raise ValueError("Complete grant series requires its own HR evidence")
        if self.attendance_days > self.attendance_denominator:
            raise ValueError("Attendance exceeds the reviewed attendance denominator")
        if (self.schedule_basis == "weekly") != (self.scheduled_week_days is not None):
            raise ValueError("Weekly schedule basis requires only weekly days")
        if (self.schedule_basis == "annual") != (self.scheduled_year_days is not None):
            raise ValueError("Annual schedule basis requires only annual days")
        shift = self.schedule_basis == "shift_actual"
        if shift != (
            self.actual_work_days is not None and self.actual_period is not None
        ):
            raise ValueError(
                "Shift actual basis requires the actual working days and their period"
            )
        if not shift and self.guideline_year_days is not None:
            raise ValueError(
                "Guideline working days apply only to the shift actual basis"
            )
        if (
            self.actual_period == "first_six_months"
            and self.actual_work_days is not None
            and self.actual_work_days > 184
        ):
            raise ValueError(
                "Six months cannot contain more actual working days than calendar days"
            )
        if self.guidance_confirmation is not None and not (
            shift and self.basis_date < GUIDANCE_REVISION
        ):
            raise ValueError(
                "Guidance confirmation applies only to the shift actual basis before the guidance revision"
            )
        return self
