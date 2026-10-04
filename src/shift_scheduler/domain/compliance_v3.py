"""Additive inputs for establishment responsibility and bitemporal HR evidence."""

from datetime import date, time, timedelta
from typing import Literal, Self
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, Field, model_validator

from .catalogue import DutyTemplate
from .compliance import (
    Agreement,
    Employment,
    LeaveObligation,
    LeaveRecord,
    SolverSnapshotV2,
)
from .planning import Burden, Evidence, Interval, Value


class Establishment(Interval):
    establishment_id: str = Field(min_length=1)
    employer_id: str = Field(min_length=1)
    evidence: Evidence


class EmploymentV3(Employment):
    establishment_id: str = Field(min_length=1)


class AgreementV3(Agreement):
    establishment_id: str = Field(min_length=1)


class LedgerRecording(Value):
    recording_id: str
    object_kind: Literal["leave_account", "leave_record"]
    object_id: str
    external_event_id: str = Field(min_length=1)
    external_revision: int = Field(ge=1)
    recorded_at: AwareDatetime
    evidence: Evidence


class GrantAmendment(Value):
    amendment_id: str
    person_id: str
    account_id: str
    external_event_id: str = Field(min_length=1)
    external_revision: int = Field(ge=2)
    supersedes_revision: int = Field(ge=1)
    effective_on: date
    recorded_at: AwareDatetime
    granted_days: int = Field(ge=0)
    statutory_days: int = Field(ge=0)
    reason: str = Field(min_length=1)
    evidence: Evidence

    @model_validator(mode="after")
    def sequence(self) -> Self:
        if self.external_revision != self.supersedes_revision + 1:
            raise ValueError("Grant corrections must form a contiguous revision chain")
        if self.statutory_days > self.granted_days:
            raise ValueError("Statutory entitlement exceeds the corrected grant")
        return self


class LeaveAmendment(Value):
    """An immutable HR correction; None cancels the erroneous source event."""

    amendment_id: str = Field(min_length=1)
    person_id: str = Field(min_length=1)
    event_id: str = Field(min_length=1)
    external_event_id: str = Field(min_length=1)
    external_revision: int = Field(ge=2)
    supersedes_revision: int = Field(ge=1)
    recorded_at: AwareDatetime
    replacement: LeaveRecord | None
    reason: str = Field(min_length=1)
    evidence: Evidence

    @model_validator(mode="after")
    def sequence(self) -> Self:
        if self.external_revision != self.supersedes_revision + 1:
            raise ValueError("Leave corrections require contiguous source revisions")
        if self.replacement and self.replacement.event_id != self.event_id:
            raise ValueError("Correction must retain the original event identity")
        return self


class RuleReview(Interval):
    review_id: str
    rule_id: str
    source_url: str
    provision: str
    transitional_provision: str
    reviewed_on: date
    next_review_on: date
    evidence: Evidence
    # Binds the review to the exact source document (G04); optional so the hashes
    # of stored inputs are kept. A bound review requires a publication decision.
    source_sha256: str | None = Field(
        default=None, pattern="^[0-9a-f]{64}$", exclude_if=lambda v: v is None
    )
    document_version: str | None = Field(
        default=None, min_length=1, exclude_if=lambda v: v is None
    )

    @model_validator(mode="after")
    def review_dates(self) -> Self:
        if self.next_review_on <= self.reviewed_on:
            raise ValueError("Next review must follow the recorded review")
        return self


class RuleDecision(Value):
    """Publish or hold after the impact of a revised rule source was reviewed."""

    decision_id: str
    review_id: str
    rule_id: str
    source_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    decision: Literal["publish", "hold"]
    impact_hash: str = Field(pattern="^[0-9a-f]{64}$")
    impact_count: int = Field(ge=0)
    decided_on: date
    evidence: Evidence


class LeaveObligationV3(LeaveObligation):
    method: Literal["separate", "consolidated", "split_advance"] = "separate"
    rounding_unit: Literal["day", "half_day"] = "day"
    half_day_request_evidence: Evidence | None = None


class BurdenV3(Burden):
    kind: Literal["night", "holiday"] = "night"  # type: ignore[assignment]
    period_start: date
    period_end: date


class AccountingTransition(Value):
    transition_id: str = Field(min_length=1)
    before_revision_id: str = Field(min_length=1)
    after_revision_id: str = Field(min_length=1)
    # Explicit facility review of effective calendar windows, never prorated weeks.
    calculation_basis: Literal[
        "effective_calendar_windows", "preserve_overlapping_full_weeks"
    ]
    evidence: Evidence


class OutsideDeclaration(Interval):
    declaration_id: str
    person_id: str
    employer_id: str
    establishment_id: str
    contract_order: int | None = Field(default=None, ge=1)
    activity: Literal["employment", "nonemployment"] = "employment"
    scheduled_work: tuple[Interval, ...] = ()
    additional_work: tuple[Interval, ...] = ()
    # Work on the other employer's statutory holiday: not holiday work here, but
    # counted as that employer's work beyond the schedule, in the order it happened
    # (副業・兼業ガイドラインQ&A 問1-4-2・1-4-3). Optional so stored hashes are kept.
    other_holiday_work: tuple[Interval, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    work_report_complete: bool = False
    reference: str = Field(min_length=1, max_length=2000)
    status: Literal["SUBMITTED", "REVIEWED", "RETURNED", "WITHDRAWN"] = "SUBMITTED"
    review_evidence: Evidence | None = None

    @model_validator(mode="after")
    def classification(self) -> Self:
        pieces = sorted(
            (*self.scheduled_work, *self.additional_work, *self.other_holiday_work),
            key=lambda i: i.start,
        )
        if any(not self.contains(p) for p in pieces) or any(
            a.overlaps(b) for a, b in zip(pieces, pieces[1:], strict=False)
        ):
            raise ValueError(
                "Declared work intervals must not overlap or escape the declaration period"
            )
        if (
            self.status == "REVIEWED"
            and self.activity == "employment"
            and not self.work_report_complete
        ):
            raise ValueError("Employment work report remains unconfirmed")
        if self.status == "REVIEWED" and (
            not self.review_evidence or self.review_evidence.status != "verified"
        ):
            raise ValueError(
                "Reviewed declarations require independently verified evidence"
            )
        return self


def period_end(start: date, months: int) -> date:
    """Exclusive end of a period of `months` months from the start day (民法140条
    ただし書・143条): the day before the corresponding day, or the month's last day
    when there is none (Jan 31 + 1 month ends Feb 28, so the exclusive end is Mar 1)."""
    import calendar

    year, month = divmod(start.month - 1 + months, 12)
    year, month = start.year + year, month + 1
    last = calendar.monthrange(year, month)[1]
    return (
        date(year, month, start.day)
        if start.day <= last
        else date(year, month, last) + timedelta(days=1)
    )


_add_months = period_end


class CalendarDay(Value):
    day: date
    seconds: int = Field(gt=0, le=24 * 3600)


class CalendarSegment(Value):
    """A later division of the period (Art. 32-4(1)(iv)): at least one month long.

    Open: only its working days and total hours are agreed. Fixed: its days were
    set with the majority representative's consent at least 30 days before it
    starts (Art. 32-4(2), Enforcement Regulations Art. 12-4(2)).
    """

    start: date
    end: date
    working_days: int = Field(ge=0)
    total_seconds: int = Field(ge=0)
    fixed_on: date | None = None
    consent: Evidence | None = None

    @model_validator(mode="after")
    def segment(self) -> Self:
        if _add_months(self.start, 1) > self.end:
            raise ValueError("A calendar segment must be at least one month long")
        if (self.fixed_on is None) != (self.consent is None):
            raise ValueError("A fixed segment needs its fixing date and the consent")
        if self.fixed_on is not None and self.fixed_on > self.start - timedelta(
            days=30
        ):
            raise ValueError(
                "A segment must be fixed at least 30 days before it starts"
            )
        return self


class DateRange(Value):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.start >= self.end:
            raise ValueError("A date range must end after it starts")
        return self


class AnnualCalendar(Value):
    """The agreed calendar of one-year variable working hours (Art. 32-4).

    The target period runs from `start` to `end` (exclusive dates, more than one
    month and at most one year). Dates before `first_period_end` were fixed day by
    day in the agreement; the rest is divided into segments. `days` lists every
    working day of the fixed parts with its scheduled seconds; other fixed dates
    are rest days. Statutory limits are checked as findings (work_accounting).
    """

    calendar_id: str = Field(min_length=1)
    employer_id: str = Field(min_length=1)
    establishment_id: str = Field(min_length=1)
    start: date
    end: date
    first_period_end: date
    week_start: int = Field(ge=0, le=6)
    days: tuple[CalendarDay, ...] = ()
    segments: tuple[CalendarSegment, ...] = ()
    special_periods: tuple[DateRange, ...] = ()
    evidence: Evidence

    @model_validator(mode="after")
    def structure(self) -> Self:
        if not (_add_months(self.start, 1) < self.end <= _add_months(self.start, 12)):
            raise ValueError(
                "The target period must be longer than one month and at most one year"
            )
        if not self.start < self.first_period_end <= self.end:
            raise ValueError("The first period must lie within the target period")
        if self.segments and _add_months(self.start, 1) > self.first_period_end:
            raise ValueError(
                "The first period must be at least one month long when the period is divided"
            )
        cursor, open_seen = self.first_period_end, False
        for segment in self.segments:
            if segment.start != cursor:
                raise ValueError("Segments must follow the first period without gaps")
            if segment.fixed_on is not None and open_seen:
                raise ValueError(
                    "Segments are fixed in order: a fixed segment cannot follow an open one"
                )
            open_seen = open_seen or segment.fixed_on is None
            cursor = segment.end
        if cursor != self.end:
            raise ValueError(
                "The first period and the segments must cover the target period exactly"
            )
        dates = [d.day for d in self.days]
        if len(set(dates)) != len(dates):
            raise ValueError("A calendar day is listed twice")
        if any(not self.start <= d < self.fixed_end for d in dates):
            raise ValueError(
                "Working days can be listed only in the fixed parts of the period"
            )
        for segment in self.segments:
            if segment.fixed_on is not None:
                inside = [d for d in self.days if segment.start <= d.day < segment.end]
                if (len(inside), sum(d.seconds for d in inside)) != (
                    segment.working_days,
                    segment.total_seconds,
                ):
                    raise ValueError(
                        "A fixed segment must keep its agreed working days and total hours"
                    )
        if any(
            not (self.start <= p.start and p.end <= self.end)
            for p in self.special_periods
        ):
            raise ValueError("Special periods must lie within the target period")
        return self

    @property
    def fixed_end(self) -> date:
        """End of the day-by-day fixed part (first period and fixed segments)."""
        fixed = [s.end for s in self.segments if s.fixed_on is not None]
        return max([self.first_period_end, *fixed])

    @property
    def calendar_days(self) -> int:
        return (self.end - self.start).days

    def scheduled(self) -> dict[date, int]:
        return {d.day: d.seconds for d in self.days}


JST = ZoneInfo("Asia/Tokyo")


class TimeWindow(Value):
    """A daily time window (core or flexible time) in Japan time."""

    start: time
    end: time

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.start >= self.end or self.start.tzinfo or self.end.tzinfo:
            raise ValueError("A time window must end after it starts (local times)")
        return self

    @property
    def seconds(self) -> int:
        return (self.end.hour * 3600 + self.end.minute * 60 + self.end.second) - (
            self.start.hour * 3600 + self.start.minute * 60 + self.start.second
        )


class FlexFiling(Value):
    """Filing of an agreement with a settlement period over one month (則12条の3第2項)."""

    filed_on: date
    office: str = Field(min_length=1, max_length=200)
    evidence: Evidence


class FlexAdoption(Interval):
    """A facility's adoption of flextime for a group (労基法32条の3, 則12条の3).

    Holds the agreement's terms and no personal data: the people are enrolled one
    by one (FlexEnrollment), so each person's record can be erased on its own.
    Takes effect only when another administrator than the registrant confirms it.
    The account fields use the names person erasure recognises (subject_references).
    """

    adoption_id: str = Field(min_length=1)
    employer_id: str = Field(min_length=1)
    establishment_id: str = Field(min_length=1)
    target_scope: str = Field(min_length=1, max_length=2000)  # 対象となる労働者の範囲
    settlement_months: int = Field(ge=1, le=3)  # 清算期間
    settlement_anchor: date  # 清算期間の起算日
    total_hours_rule: Literal["statutory_frame", "full_two_day_weekend"]
    agreed_total_description: str = Field(
        min_length=1, max_length=500
    )  # 総労働時間の定め
    rest_weekdays: tuple[int, ...] = Field(default=(), exclude_if=lambda v: not v)
    other_rest_days: tuple[date, ...] = Field(default=(), exclude_if=lambda v: not v)
    standard_day_seconds: int = Field(gt=0, le=24 * 3600)  # 標準となる1日の労働時間
    core_time: tuple[TimeWindow, ...] = Field(default=(), exclude_if=lambda v: not v)
    flexible_time: tuple[TimeWindow, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    work_rules_evidence: Evidence  # 始業・終業を労働者に委ねる規定
    agreement_evidence: Evidence
    filing: FlexFiling | None = Field(default=None, exclude_if=lambda v: v is None)
    agreement_valid_until: date | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    status: Literal["registered", "confirmed", "withdrawn"] = "registered"
    created_by: str = Field(min_length=1)
    created_at: AwareDatetime
    reviewed_by: str | None = Field(default=None, exclude_if=lambda v: v is None)
    reviewed_at: AwareDatetime | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    decided_by: str | None = Field(default=None, exclude_if=lambda v: v is None)
    decided_at: AwareDatetime | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    withdrawal_reason: str | None = Field(
        default=None, min_length=1, max_length=2000, exclude_if=lambda v: v is None
    )
    end_reason: str | None = Field(
        default=None, min_length=1, max_length=2000, exclude_if=lambda v: v is None
    )

    @model_validator(mode="after")
    def agreement(self) -> Self:
        local = self.start.astimezone(JST)
        if local.date() != self.settlement_anchor or local.time() != time():
            raise ValueError("Flextime starts at midnight on its settlement anchor day")
        if any(not 0 <= d <= 6 for d in self.rest_weekdays):
            raise ValueError("Rest weekdays are 0 (Monday) to 6 (Sunday)")
        if (
            self.total_hours_rule == "full_two_day_weekend"
            and len(set(self.rest_weekdays)) < 2
        ):
            raise ValueError(
                "The full two-day weekend rule needs at least two weekly rest days"
            )
        if self.total_hours_rule == "statutory_frame" and (
            self.rest_weekdays or self.other_rest_days
        ):
            raise ValueError(
                "Rest days define the frame only under the full two-day weekend rule"
            )
        # Core time must leave the worker a real choice (MHLW guide p.10): shorter
        # than the standard day and inside flexible time with room on both sides.
        # Flexible time may be written as one span around the core time, or as the
        # windows before and after it.
        if (
            self.core_time
            and sum(w.seconds for w in self.core_time) >= self.standard_day_seconds
        ):
            raise ValueError("Core time must be shorter than the standard working day")
        if self.core_time and not self.flexible_time:
            raise ValueError("Core time needs flexible time around it")
        if self.flexible_time:
            earliest, latest = min(f.start for f in self.flexible_time), max(
                f.end for f in self.flexible_time
            )
            if any(
                not (earliest < core.start and core.end < latest)
                for core in self.core_time
            ):
                raise ValueError(
                    "Each core time lies strictly inside the flexible time"
                )
        if self.settlement_months > 1:
            if self.filing is None or self.agreement_valid_until is None:
                raise ValueError(
                    "A settlement period over one month needs the filing and a validity period"
                )
            if self.end.astimezone(JST).date() > self.agreement_valid_until + timedelta(
                days=1
            ):
                raise ValueError(
                    "Flextime cannot run beyond the agreement's validity period"
                )
        if self.status == "confirmed" and (
            not self.reviewed_by
            or self.reviewed_by == self.created_by
            or self.reviewed_at is None
        ):
            raise ValueError(
                "A confirmed adoption needs a confirmer other than the registrant"
            )
        if self.status == "withdrawn" and (
            not self.decided_by or not self.withdrawal_reason or self.decided_at is None
        ):
            raise ValueError("A withdrawn adoption needs who withdrew it and why")
        # A confirmed adoption ended early (at a settlement period start) records who
        # ended it and why; the end itself is the shortened interval.
        if (self.end_reason is not None) != (
            self.status == "confirmed" and self.decided_by is not None
        ) or (self.end_reason is not None and self.decided_at is None):
            raise ValueError("An adoption ended early needs who ended it, when and why")
        return self


class FlexEnrollment(Value):
    """One person's enrolment in an adoption, from a settlement period start to the
    adoption's end. Also confirmed by another administrator than the registrant."""

    enrollment_id: str = Field(min_length=1)
    adoption_id: str = Field(min_length=1)
    person_id: str = Field(min_length=1)
    start: AwareDatetime
    status: Literal["registered", "confirmed", "withdrawn"] = "registered"
    created_by: str = Field(min_length=1)
    created_at: AwareDatetime
    reviewed_by: str | None = Field(default=None, exclude_if=lambda v: v is None)
    reviewed_at: AwareDatetime | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    decided_by: str | None = Field(default=None, exclude_if=lambda v: v is None)
    decided_at: AwareDatetime | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    withdrawal_reason: str | None = Field(
        default=None, min_length=1, max_length=2000, exclude_if=lambda v: v is None
    )

    @model_validator(mode="after")
    def decisions(self) -> Self:
        if self.start.astimezone(JST).time() != time():
            raise ValueError("An enrolment starts at midnight Japan time")
        if self.status == "confirmed" and (
            not self.reviewed_by
            or self.reviewed_by == self.created_by
            or self.reviewed_at is None
        ):
            raise ValueError(
                "A confirmed enrolment needs a confirmer other than the registrant"
            )
        if self.status == "withdrawn" and (
            not self.decided_by or not self.withdrawal_reason or self.decided_at is None
        ):
            raise ValueError("A withdrawn enrolment needs who withdrew it and why")
        return self


def settlement_starts(adoption: FlexAdoption) -> set[date]:
    """Settlement period starts within the adoption (months counted from the anchor)."""
    import calendar

    starts: set[date] = set()
    k = 0
    end = adoption.end.astimezone(JST).date()
    while True:
        year, month = divmod(
            adoption.settlement_anchor.month - 1 + k * adoption.settlement_months, 12
        )
        year, month = adoption.settlement_anchor.year + year, month + 1
        day = date(
            year,
            month,
            min(adoption.settlement_anchor.day, calendar.monthrange(year, month)[1]),
        )
        if day >= end:
            return starts
        starts.add(day)
        k += 1


class SiteAttributionDecision(Interval):
    """HR/legal choice of how overtime is attributed between the sites of one employer.

    No official statement fixes it (Art. 38(1); 基発0901第3号 orders different
    employers only): "scheduled_first" counts scheduled hours before extra hours,
    "time_order" counts in the order worked. Without a verified decision covering
    the work, differing readings leave the person unverified.
    """

    decision_id: str = Field(min_length=1)
    employer_id: str = Field(min_length=1)
    reading: Literal["scheduled_first", "time_order"]
    reason: str = Field(min_length=1, max_length=2000)
    evidence: Evidence


class SolverSnapshotV3(SolverSnapshotV2):
    schema_version: Literal[3] = 3  # type: ignore[assignment]
    establishments: tuple[Establishment, ...]
    employments: tuple[EmploymentV3, ...]
    agreements: tuple[AgreementV3, ...] = ()
    ledger_recordings: tuple[LedgerRecording, ...] = ()
    grant_amendments: tuple[GrantAmendment, ...] = ()
    # Keep hashes of already persisted V3 snapshots without this optional feature.
    leave_amendments: tuple[LeaveAmendment, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    rule_reviews: tuple[RuleReview, ...] = ()
    rule_decisions: tuple[RuleDecision, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    leave_obligations: tuple[LeaveObligationV3, ...] = ()
    duty_templates: tuple[DutyTemplate, ...] = ()
    catalogue_evidence: Evidence | None = None
    burden_history: tuple[BurdenV3, ...] = ()
    fairness_history_evidence: Evidence | None = None
    accounting_transitions: tuple[AccountingTransition, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    # Other employers' work declared by the person (Labour Standards Act Art. 38).
    # Only REVIEWED declarations are counted; optional so existing hashes are kept.
    outside_declarations: tuple[OutsideDeclaration, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    # One-year variable hours calendars (Art. 32-4), referenced by employments.
    annual_calendars: tuple[AnnualCalendar, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    # HR/legal decisions on overtime attribution between one employer's sites (L06).
    site_attribution_decisions: tuple[SiteAttributionDecision, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    # Facility adoption of flextime and each person's enrolment (default: none).
    flex_adoptions: tuple[FlexAdoption, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )
    flex_enrollments: tuple[FlexEnrollment, ...] = Field(
        default=(), exclude_if=lambda v: not v
    )

    @model_validator(mode="after")
    def v3_references(self) -> Self:
        employment_by_id = {e.revision_id: e for e in self.employments}
        transition_pairs = set()
        for transition in self.accounting_transitions:
            before = employment_by_id.get(transition.before_revision_id)
            after = employment_by_id.get(transition.after_revision_id)
            if (
                not before
                or not after
                or before.end != after.start
                or (
                    before.person_id,
                    before.relationship_id,
                    before.employer_id,
                    before.establishment_id,
                )
                != (
                    after.person_id,
                    after.relationship_id,
                    after.employer_id,
                    after.establishment_id,
                )
            ):
                raise ValueError(
                    "Accounting transition requires adjacent revisions of the same relationship and site"
                )
            pair = (before.revision_id, after.revision_id)
            if pair in transition_pairs:
                raise ValueError("Duplicate accounting transition")
            transition_pairs.add(pair)
        sites = {s.establishment_id: s for s in self.establishments}
        if len(sites) != len(self.establishments):
            raise ValueError("Duplicate establishment identity")
        sited: tuple[EmploymentV3 | AgreementV3, ...] = (
            *self.employments,
            *self.agreements,
        )
        for item in sited:
            site = sites.get(item.establishment_id)
            if (
                not site
                or site.employer_id != item.employer_id
                or not site.contains(item)
            ):
                raise ValueError("Missing or mismatched effective establishment")
        for collection, key in (
            (self.ledger_recordings, "recording_id"),
            (self.grant_amendments, "amendment_id"),
            (self.leave_amendments, "amendment_id"),
            (self.rule_reviews, "review_id"),
            (self.rule_decisions, "decision_id"),
            (self.site_attribution_decisions, "decision_id"),
            (self.annual_calendars, "calendar_id"),
            (self.flex_adoptions, "adoption_id"),
            (self.flex_enrollments, "enrollment_id"),
        ):
            if len({getattr(v, key) for v in collection}) != len(collection):
                raise ValueError(f"Duplicate {key}")
        identities = {(r.object_kind, r.object_id) for r in self.ledger_recordings}
        if len(identities) != len(self.ledger_recordings):
            raise ValueError("Duplicate ledger recording identity")
        calendars = {c.calendar_id: c for c in self.annual_calendars}
        for calendar in self.annual_calendars:
            site = sites.get(calendar.establishment_id)
            if not site or site.employer_id != calendar.employer_id:
                raise ValueError(
                    "Annual calendar refers to a missing or mismatched establishment"
                )
        for employment in self.employments:
            if employment.annual_calendar_id is not None:
                named = calendars.get(employment.annual_calendar_id)
                if named is None or (
                    named.employer_id,
                    named.establishment_id,
                    named.week_start,
                ) != (
                    employment.employer_id,
                    employment.establishment_id,
                    employment.week_start,
                ):
                    raise ValueError(
                        "One-year variable hours need a calendar of the same site and week start"
                    )
        adoptions = {a.adoption_id: a for a in self.flex_adoptions}
        for adoption in self.flex_adoptions:
            site = sites.get(adoption.establishment_id)
            if (
                not site
                or site.employer_id != adoption.employer_id
                or not site.contains(adoption)
            ):
                raise ValueError(
                    "Flextime adoption refers to a missing or mismatched establishment"
                )
        active: dict[str, list[tuple[AwareDatetime, AwareDatetime]]] = {}
        for enrollment in self.flex_enrollments:
            adopted = adoptions.get(enrollment.adoption_id)
            if enrollment.status == "withdrawn" and adopted is not None:
                continue  # history; an early end may have withdrawn enrolments after it
            if adopted is None or not adopted.start <= enrollment.start < adopted.end:
                raise ValueError(
                    "Flextime enrolment refers to a missing adoption or starts outside it"
                )
            if enrollment.start.astimezone(JST).date() not in settlement_starts(
                adopted
            ):
                raise ValueError(
                    "A flextime enrolment starts at the start of a settlement period"
                )
            if enrollment.status == "confirmed" and adopted.status == "confirmed":
                spans = active.setdefault(enrollment.person_id, [])
                if any(
                    enrollment.start < end and start < adopted.end
                    for start, end in spans
                ):
                    raise ValueError(
                        "Confirmed flextime enrolments of one person overlap"
                    )
                spans.append((enrollment.start, adopted.end))
        employers = {s.employer_id for s in self.establishments}
        by_employer: dict[str, list[SiteAttributionDecision]] = {}
        for decision in self.site_attribution_decisions:
            if decision.employer_id not in employers:
                raise ValueError(
                    "Site attribution decision refers to an unknown employer"
                )
            by_employer.setdefault(decision.employer_id, []).append(decision)
        for decisions in by_employer.values():
            ordered = sorted(decisions, key=lambda d: d.start)
            if any(a.overlaps(b) for a, b in zip(ordered, ordered[1:], strict=False)):
                raise ValueError(
                    "Site attribution decisions of one employer must not overlap"
                )
        accounts = {a.account_id: a for a in self.leave_accounts}
        events = {e.event_id for e in self.leave_records}
        for r in self.ledger_recordings:
            if r.object_id not in (
                accounts if r.object_kind == "leave_account" else events
            ):
                raise ValueError("Recording references missing ledger object")
        for amendment in self.grant_amendments:
            account = accounts.get(amendment.account_id)
            if not account or account.person_id != amendment.person_id:
                raise ValueError("Grant amendment refers to another or missing person")
        originals = {e.event_id: e for e in self.leave_records}
        for correction in self.leave_amendments:
            original = originals.get(correction.event_id)
            account = accounts.get(original.account_id) if original else None
            if not original or not account or account.person_id != correction.person_id:
                raise ValueError(
                    "Leave correction references another or missing person"
                )
            if (
                correction.replacement
                and correction.replacement.account_id != original.account_id
            ):
                raise ValueError(
                    "Account transfers require separately reconciled events"
                )
        return self
