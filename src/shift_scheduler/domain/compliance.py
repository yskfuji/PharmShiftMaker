"""Version-two inputs; v1 payloads and their hashes remain byte-for-byte interpretable."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal, Self

from pydantic import Field, model_validator

from .planning import Evidence, Interval, SolverSnapshot, Value


class Employment(Interval):
    revision_id: str
    relationship_id: str
    person_id: str
    employer_id: str
    contract_order: int | None = Field(default=None, ge=1)
    activity: Literal["employment", "nonemployment"] = "employment"
    method: Literal["standard", "management"] = "standard"
    week_start: int = Field(default=0, ge=0, le=6)
    statutory_holidays: tuple[date, ...] = ()
    calendar_confirmed: bool = False
    declaration: Evidence
    agreement_id: str | None = None
    # Flexible holidays (Labour Standards Act Art. 35(2)): at least four statutory
    # holidays in every four weeks counted from a start day set in the work rules
    # (Enforcement Regulations Art. 12-2(2)).
    holiday_system: Literal["weekly", "four_week"] = Field(
        default="weekly", exclude_if=lambda v: v == "weekly"
    )
    four_week_start: date | None = Field(default=None, exclude_if=lambda v: v is None)
    # Variable working hours of up to one month (Art. 32-2): periods start on the
    # anchor day each month, or every `variable_period_days` days from the anchor
    # (e.g. four weeks). A fixed cycle longer than 28 days would exceed one month
    # when it spans February, so 28 is the maximum. The work rules or agreement are
    # the evidence.
    # One-year variable hours (Art. 32-4) follow the agreed calendar named by
    # `annual_calendar_id` (compliance_v3.AnnualCalendar; V3 inputs only).
    # Flextime (Art. 32-3): the worker sets start and end times, so no timed duty
    # is assigned; overtime is settled from actual work over a settlement period
    # of `flex_months` months (1-3) from `flex_anchor`. With the full two-day
    # weekend special rule (Art. 32-3(3)) the frame is 8h x scheduled days, the
    # scheduled days being those not on `flex_rest_weekdays`, statutory holidays
    # or `flex_other_rest_days`. `variable_evidence` holds the work rules and agreement.
    working_time_system: Literal[
        "standard", "monthly_variable", "annual_variable", "flex"
    ] = Field(default="standard", exclude_if=lambda v: v == "standard")
    variable_anchor: date | None = Field(default=None, exclude_if=lambda v: v is None)
    variable_period_days: int | None = Field(
        default=None, ge=1, le=28, exclude_if=lambda v: v is None
    )
    variable_evidence: Evidence | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    annual_calendar_id: str | None = Field(
        default=None, min_length=1, exclude_if=lambda v: v is None
    )
    flex_anchor: date | None = Field(default=None, exclude_if=lambda v: v is None)
    flex_months: int | None = Field(
        default=None, ge=1, le=3, exclude_if=lambda v: v is None
    )
    flex_full_two_day_weekend: bool = Field(default=False, exclude_if=lambda v: not v)
    flex_rest_weekdays: tuple[int, ...] = Field(default=(), exclude_if=lambda v: not v)
    flex_other_rest_days: tuple[date, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )

    @model_validator(mode="after")
    def working_time_arrangement(self) -> Self:
        if (self.holiday_system == "four_week") != (self.four_week_start is not None):
            raise ValueError(
                "Flexible holidays require exactly their four-week start day"
            )
        if (self.working_time_system == "monthly_variable") != (
            self.variable_anchor is not None
        ):
            raise ValueError(
                "Monthly variable hours require exactly their period anchor"
            )
        if self.working_time_system == "monthly_variable" and (
            self.variable_evidence is None or self.method != "standard"
        ):
            raise ValueError(
                "Monthly variable hours need their evidence and the standard method"
            )
        if (
            self.variable_period_days is not None
            and self.working_time_system != "monthly_variable"
        ):
            raise ValueError(
                "A variable period length applies only to variable hours of up to one month"
            )
        annual = self.working_time_system == "annual_variable"
        if annual != (self.annual_calendar_id is not None) or (
            annual and self.method != "standard"
        ):
            raise ValueError(
                "One-year variable hours require exactly their calendar and the standard method"
            )
        flex = self.working_time_system == "flex"
        if flex != (self.flex_anchor is not None and self.flex_months is not None):
            raise ValueError(
                "Flextime requires exactly its settlement anchor and length"
            )
        if flex and (self.variable_evidence is None or self.method != "standard"):
            raise ValueError(
                "Flextime needs its work rules and agreement as evidence and the standard method"
            )
        if not flex and (
            self.flex_full_two_day_weekend
            or self.flex_rest_weekdays
            or self.flex_other_rest_days
        ):
            raise ValueError("Flextime settings apply only to flextime")
        if self.flex_full_two_day_weekend and (
            len(set(self.flex_rest_weekdays)) < 2
            or any(not 0 <= d <= 6 for d in self.flex_rest_weekdays)
        ):
            raise ValueError(
                "The full two-day weekend rule needs at least two weekly rest days"
            )
        return self


class WorkTerms(Value):
    duty_id: str
    employment_revision_id: str
    employment_revision_ids: tuple[str, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    scheduled_work: tuple[Interval, ...]
    planned_duty_id: str | None = None
    planned_publication_id: str | None = None

    @model_validator(mode="after")
    def planned_reference(self) -> Self:
        if self.employment_revision_ids and (
            len(self.employment_revision_ids) < 2
            or len(set(self.employment_revision_ids))
            != len(self.employment_revision_ids)
            or self.employment_revision_ids[0] != self.employment_revision_id
        ):
            raise ValueError(
                "Segmented employment classification requires distinct ordered V3 revisions (at least two)"
            )
        if bool(self.planned_duty_id) != bool(self.planned_publication_id):
            raise ValueError(
                "Actual linkage requires both publication and duty identities"
            )
        return self


class Agreement(Interval):
    agreement_id: str
    employer_id: str
    year_start: date
    month_anchor: date
    daily_limit_seconds: int = Field(ge=0)
    # Special clause: overtime plus holiday work must be under 100h a month
    # (Labour Standards Act Art. 36(6)(ii)). Exactly 100h is still accepted here
    # so stored inputs remain readable (their hash is unchanged); it is reported as
    # a violation by input_findings and refused when saved.
    monthly_limit_seconds: int = Field(ge=0, le=100 * 3600)
    annual_limit_seconds: int = Field(ge=0, le=720 * 3600)
    special_clause: bool = False
    holiday_work_permitted: bool = False
    evidence: Evidence
    invocation_evidence: Evidence | None = None

    @model_validator(mode="after")
    def ordinary_limits(self) -> Self:
        if not self.special_clause and (
            self.monthly_limit_seconds > 45 * 3600
            or self.annual_limit_seconds > 360 * 3600
        ):
            raise ValueError("Ordinary agreement is limited to 45h/month and 360h/year")
        return self


class ManagementModel(Interval):
    model_id: str
    person_id: str
    first_employer: str
    second_employer: str
    month_anchor: date
    first_month_limit_seconds: int = Field(ge=0)
    second_month_limit_seconds: int = Field(ge=0)
    first_consent: Evidence
    second_consent: Evidence
    notification: Evidence


class LeavePolicy(Interval):
    policy_id: str
    person_id: str
    employer_id: str
    hourly_enabled: bool = False
    half_day_enabled: bool = False
    hours_per_day: int = Field(ge=1, le=24)
    hourly_quantum: int = Field(default=1, ge=1, le=24)
    hourly_year_start: date
    hourly_cap_days: int = Field(default=5, ge=0, le=5)
    evidence: Evidence

    @model_validator(mode="after")
    def quantum(self) -> Self:
        if self.hourly_quantum > self.hours_per_day:
            raise ValueError("Hourly quantum cannot exceed the equivalent day")
        return self


class LeaveAccount(Value):
    account_id: str
    person_id: str
    employer_id: str
    granted_on: date
    expires_on: date
    statutory_days: int = Field(ge=0)
    granted_days: int = Field(ge=0)
    evidence: Evidence
    # External HR supplies a grant-cycle identity even for split/advance grants.
    grant_cycle_id: str | None = None


class LeaveRecord(Value):
    event_id: str
    account_id: str
    kind: Literal["reserve", "release", "take", "reverse", "expire", "conversion"]
    unit: Literal["day", "half_day", "hour"]
    quantity: int = Field(ge=0)
    effective_on: date
    policy_id: str
    interval: Interval | None = None
    related_event_id: str | None = None
    evidence: Evidence
    # For an explicitly documented contract-change rounding adjustment.
    conversion_old_hours: int | None = Field(default=None, ge=1, le=24)
    conversion_new_hours: int | None = Field(default=None, ge=1, le=24)

    @model_validator(mode="after")
    def positive_consumption(self) -> Self:
        if self.quantity == 0 and self.kind != "conversion":
            raise ValueError(
                "Only a conversion of a whole-day balance may have zero hours"
            )
        return self


class LeaveObligation(Value):
    obligation_id: str
    person_id: str
    employer_id: str
    start: date
    end: date
    required_half_days: int = Field(default=10, ge=0)
    qualifying_grant_ids: tuple[str, ...]
    # Overlapping/accelerated grants need a documented consolidated window.
    evidence: Evidence


class SolverSnapshotV2(SolverSnapshot):
    schema_version: Literal[2] = 2  # type: ignore[assignment]
    employments: tuple[Employment, ...]
    work_terms: tuple[WorkTerms, ...]
    agreements: tuple[Agreement, ...] = ()
    management_models: tuple[ManagementModel, ...] = ()
    leave_policies: tuple[LeavePolicy, ...] = ()
    leave_accounts: tuple[LeaveAccount, ...] = ()
    leave_records: tuple[LeaveRecord, ...] = ()
    leave_obligations: tuple[LeaveObligation, ...] = ()

    @model_validator(mode="after")
    def v2_references(self) -> Self:
        if (
            self.grants
            or self.leaves
            or self.reservation_credits
            or self.overtime_agreements
        ):
            raise ValueError(
                "V2 uses typed leave events and agreement revisions, not v1 ledgers"
            )
        people = {p.person_id for p in self.people}
        for entries, field in (
            (self.employments, "revision_id"),
            (self.work_terms, "duty_id"),
            (self.agreements, "agreement_id"),
            (self.management_models, "model_id"),
            (self.leave_policies, "policy_id"),
            (self.leave_accounts, "account_id"),
            (self.leave_records, "event_id"),
            (self.leave_obligations, "obligation_id"),
        ):
            if len({getattr(e, field) for e in entries}) != len(entries):
                raise ValueError(f"Duplicate {field}")
        for e in (
            *self.employments,
            *self.management_models,
            *self.leave_accounts,
            *self.leave_policies,
            *self.leave_obligations,
        ):
            if e.model_dump()["person_id"] not in people:
                raise ValueError("Unknown person in compliance input")
        duties = {d.duty_id: d for d in (*self.candidates, *self.history)}
        employment = {e.revision_id: e for e in self.employments}
        if {w.duty_id for w in self.work_terms} != duties.keys():
            raise ValueError(
                "Every candidate/history duty requires explicit work classification"
            )
        for w in self.work_terms:
            resolved = employment.get(w.employment_revision_id)
            d = duties[w.duty_id]
            segments = (
                [employment.get(key) for key in w.employment_revision_ids]
                if w.employment_revision_ids
                else [resolved]
            )
            version: int = self.schema_version  # V3 subclasses reuse this validator
            if w.employment_revision_ids and (
                version != 3
                or len(w.employment_revision_ids) < 2
                or len(set(w.employment_revision_ids)) != len(w.employment_revision_ids)
                or w.employment_revision_ids[0] != w.employment_revision_id
            ):
                raise ValueError(
                    "Segmented employment classification requires ordered V3 revisions"
                )
            present = [e for e in segments if e]
            if (
                not resolved
                or len(present) != len(segments)
                or any(
                    e.person_id != d.person_id
                    or e.relationship_id != d.relationship_id
                    or e.employer_id != resolved.employer_id
                    or not e.overlaps(d)
                    for e in present
                )
                or present[0].start > d.start
                or present[-1].end < d.end
                or any(
                    a.end != b.start for a, b in zip(present, present[1:], strict=False)
                )
            ):
                raise ValueError(
                    "Work classification does not resolve to an effective employment"
                )
            parts = sorted(w.scheduled_work, key=lambda p: p.start)
            if any(not d.contains(p) for p in parts) or any(
                a.overlaps(b) for a, b in zip(parts, parts[1:], strict=False)
            ):
                raise ValueError(
                    "Scheduled intervals must be within duty and not overlap"
                )
        for a in self.employments:
            for b in self.employments:
                if (
                    a.revision_id != b.revision_id
                    and a.relationship_id == b.relationship_id
                    and a.overlaps(b)
                ):
                    raise ValueError("Overlapping employment revisions")
        return self


def parse_snapshot(payload: Any) -> SolverSnapshot:
    if isinstance(payload, SolverSnapshot):
        return payload
    if payload.get("schema_version") == 3:
        from .compliance_v3 import SolverSnapshotV3

        return SolverSnapshotV3.model_validate(payload)
    return (
        SolverSnapshotV2 if payload.get("schema_version") == 2 else SolverSnapshot
    ).model_validate(payload)


def parse_snapshot_v2(payload: Any) -> SolverSnapshotV2:
    """Parse an input that must carry explicit employment/leave data (V2 or V3)."""
    snapshot = parse_snapshot(payload)
    if not isinstance(snapshot, SolverSnapshotV2):
        raise ValueError("A reconciled v2 input is required")
    return snapshot


class LeaveRequest(Value):
    account_id: str
    policy_id: str
    unit: Literal["day", "half_day", "hour"]
    quantity: int = Field(gt=0)
    interval: Interval
    reference: str = Field(min_length=1, max_length=2000)
