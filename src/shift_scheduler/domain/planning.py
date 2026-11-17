"""Versioned planning input. Domain types have no database or solver dependency."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class Value(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Interval(Value):
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if self.start >= self.end or self.start.microsecond or self.end.microsecond:
            raise ValueError(
                "Use a positive half-open interval with whole-second precision"
            )
        return self

    @property
    def seconds(self) -> int:
        return int((self.end - self.start).total_seconds())

    def overlaps(self, other: Interval) -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, other: Interval) -> bool:
        return self.start <= other.start and other.end <= self.end


class Evidence(Value):
    reference: str = Field(min_length=1)
    status: Literal["unverified", "verified", "rejected"] = "unverified"
    verified_by: str | None = None
    valid_until: AwareDatetime | None = None

    @model_validator(mode="after")
    def verifier(self) -> Self:
        if self.status == "verified" and not self.verified_by:
            raise ValueError("Verified evidence requires a responsible verifier")
        return self


class Person(Value):
    person_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1)


class ContractRevision(Interval):
    revision_id: str
    relationship_id: str
    person_id: str
    employer_id: str
    facility_id: str
    department_id: str
    engagement: Literal["direct", "agency"] = "direct"
    fixed_term: bool = False
    time_category: Literal["full_time", "part_time"] = "full_time"
    regime: Literal["general", "variable", "flex", "exempt"] = "general"
    evidence: Evidence
    regime_evidence: Evidence
    dispatch_evidence: Evidence | None = None
    dispatch_tasks: tuple[str, ...] = ()
    external_work_confirmed: bool = False
    allowed_weekdays: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6)
    allowed_kinds: tuple[str, ...] = ("DAY",)
    # Period bounds are explicit contract terms, never invented from full/part-time labels.
    period_min_seconds: int = Field(default=0, ge=0)
    period_max_seconds: int = Field(ge=0)
    contractual_week_seconds: int = Field(gt=0)
    rest_seconds: int = Field(default=0, ge=0)
    max_consecutive_days: int = Field(default=6, ge=1)
    overtime_agreement_id: str | None = None

    @model_validator(mode="after")
    def bounds(self) -> Self:
        if self.period_min_seconds > self.period_max_seconds:
            raise ValueError("Contract minimum exceeds maximum")
        if len(set(self.allowed_weekdays)) != len(self.allowed_weekdays) or any(
            d not in range(7) for d in self.allowed_weekdays
        ):
            raise ValueError("Invalid weekdays")
        return self


class Capability(Interval):
    person_id: str
    task: str
    location: str
    evidence: Evidence
    supervision_required: bool = False
    supervisor_capacity: int = Field(default=0, ge=0)


class Duty(Interval):
    duty_id: str
    person_id: str
    relationship_id: str
    kind: str
    location: str
    task: str
    work: tuple[Interval, ...]
    breaks: tuple[Interval, ...] = ()
    source: Literal["candidate", "published", "actual", "external"] = "candidate"
    fixed: bool = False
    statutory_holiday: bool = False
    external_employer_id: str | None = None

    @model_validator(mode="after")
    def partition(self) -> Self:
        if not self.work:
            raise ValueError("Duty needs actual working intervals")
        pieces = sorted((*self.work, *self.breaks), key=lambda x: x.start)
        if any(not self.contains(p) for p in pieces):
            raise ValueError("Work and breaks must be contained in duty")
        if (
            any(a.end != b.start for a, b in zip(pieces, pieces[1:], strict=False))
            or pieces[0].start != self.start
            or pieces[-1].end != self.end
        ):
            raise ValueError(
                "Classify every second of duty exactly once as work or break"
            )
        return self

    @property
    def work_seconds(self) -> int:
        return sum(w.seconds for w in self.work)


class Demand(Interval):
    demand_id: str
    task: str
    location: str
    minimum: int = Field(ge=0)
    target: int = Field(ge=0)
    evidence: Evidence

    @model_validator(mode="after")
    def target_bound(self) -> Self:
        if self.target < self.minimum:
            raise ValueError("Target cannot be lower than required minimum")
        return self


class Restriction(Interval):
    person_id: str
    prohibited_kinds: tuple[str, ...] = ()  # Empty means all work prohibited.
    evidence: Evidence


class LeaveGrant(Value):
    grant_id: str
    person_id: str
    employer_id: str
    granted_on: date
    expires_on: date
    unit: Literal["day", "second"] = "day"
    amount: int = Field(gt=0)
    consumed: int = Field(default=0, ge=0)
    reserved: int = Field(default=0, ge=0)
    evidence: Evidence

    @model_validator(mode="after")
    def valid_grant(self) -> Self:
        if (
            self.granted_on >= self.expires_on
            or self.consumed + self.reserved > self.amount
        ):
            raise ValueError("Invalid leave grant bounds")
        return self


class LeaveAllocation(Interval):
    allocation_id: str
    grant_id: str
    person_id: str
    amount: int = Field(gt=0)
    decision: Evidence


class Preference(Interval):
    person_id: str
    request_id: str | None = None
    rank: int = Field(ge=1, le=100)


class Burden(Value):
    person_id: str
    kind: Literal["total_work"] = "total_work"
    seconds: int = Field(ge=0)
    eligible_seconds: int = Field(ge=0)
    eligibility_evidence: Evidence | None = None


class OvertimeAgreement(Value):
    agreement_id: str
    employer_id: str
    year_start: date
    # Under 100h a month (Labour Standards Act Art. 36(6)(ii)); exactly 100h is
    # accepted for reading stored inputs and reported by input_findings.
    monthly_limit_seconds: int = Field(ge=0, le=100 * 3600)
    annual_limit_seconds: int = Field(ge=0, le=720 * 3600)
    special_clause: bool = False
    daily_overtime_limit_seconds: int = Field(default=0, ge=0)
    holiday_work_permitted: bool = False
    special_invocation_evidence: Evidence | None = None
    evidence: Evidence

    @model_validator(mode="after")
    def statutory_caps(self) -> Self:
        if self.year_start.day != 1:
            raise ValueError(
                "Non-calendar agreement periods require a dedicated adapter"
            )
        if not self.special_clause and (
            self.monthly_limit_seconds > 45 * 3600
            or self.annual_limit_seconds > 360 * 3600
        ):
            raise ValueError(
                "Ordinary agreement cannot exceed 45 hours/month and 360 hours/year"
            )
        return self


class SolverSnapshot(Value):
    schema_version: Literal[1] = 1
    source_revision: int = Field(default=0, ge=0)
    facility_id: str
    department_id: str
    period: Interval
    context: Interval
    timezone: Literal["Asia/Tokyo"] = "Asia/Tokyo"
    rule_revision: str
    policy_evidence: Evidence
    unresolved_requests: tuple[str, ...] = ()
    history_complete: bool = False
    candidate_catalog_complete: bool = False
    week_start: int = Field(default=0, ge=0, le=6)
    people: tuple[Person, ...] = Field(max_length=200)
    contracts: tuple[ContractRevision, ...] = Field(max_length=4000)
    capabilities: tuple[Capability, ...] = Field(max_length=10000)
    candidates: tuple[Duty, ...] = Field(max_length=20000)
    history: tuple[Duty, ...] = Field(default=(), max_length=100000)
    demands: tuple[Demand, ...] = Field(max_length=10000)
    restrictions: tuple[Restriction, ...] = ()
    grants: tuple[LeaveGrant, ...] = ()
    leaves: tuple[LeaveAllocation, ...] = ()
    replaces_publication_id: str | None = None
    reservation_credits: tuple[LeaveAllocation, ...] = ()
    preferences: tuple[Preference, ...] = ()
    burden_history: tuple[Burden, ...] = ()
    overtime_agreements: tuple[OvertimeAgreement, ...] = ()
    previous_duty_ids: tuple[str, ...] = ()
    lookahead_days: int = Field(default=14, ge=0, le=28)
    lookahead_demand_confirmed: bool = False

    @property
    def horizon(self) -> Interval:
        return Interval(
            start=self.period.start,
            end=self.period.end + timedelta(days=self.lookahead_days),
        )

    @model_validator(mode="after")
    def references(self) -> Self:
        if not self.context.contains(self.horizon):
            raise ValueError("Context must contain planning and lookahead horizon")
        people = {p.person_id for p in self.people}
        if len(people) != len(self.people):
            raise ValueError("Duplicate person ID")
        for entries, key in (
            (self.contracts, "revision_id"),
            (self.candidates + self.history, "duty_id"),
            (self.demands, "demand_id"),
            (self.grants, "grant_id"),
            (self.leaves, "allocation_id"),
        ):
            if len({getattr(e, key) for e in entries}) != len(entries):
                raise ValueError(f"Duplicate {key}")
        for entry in (
            *self.contracts,
            *self.capabilities,
            *self.candidates,
            *self.history,
            *self.restrictions,
            *self.leaves,
            *self.grants,
            *self.preferences,
            *self.burden_history,
        ):
            if entry.model_dump()["person_id"] not in people:
                raise ValueError("Unknown person reference")
        for a in self.contracts:
            if (
                a.facility_id != self.facility_id
                or a.department_id != self.department_id
            ):
                raise ValueError("Contract scope differs from snapshot")
            for b in self.contracts:
                if (
                    a.revision_id != b.revision_id
                    and a.relationship_id == b.relationship_id
                    and a.overlaps(b)
                ):
                    raise ValueError(
                        "Overlapping revisions of one employment relationship"
                    )
        for duty in self.candidates:
            if duty.source != "candidate" or not self.horizon.contains(duty):
                raise ValueError(
                    "Candidate must be within planning and lookahead horizon"
                )
        if any(not self.context.contains(duty) for duty in self.history):
            raise ValueError("History lies outside declared context")
        if any(not self.horizon.contains(d) for d in self.demands):
            raise ValueError("Demand lies outside planning and lookahead horizon")
        if not set(self.previous_duty_ids) <= {d.duty_id for d in self.candidates}:
            raise ValueError("Previous duties must remain in candidate catalog")
        return self

    @property
    def input_hash(self) -> str:
        return content_hash(self.model_dump(mode="json"))


class Proposal(Value):
    duty_ids: tuple[str, ...] = ()
    leave_ids: tuple[str, ...] = ()

    @model_validator(mode="after")
    def unique(self) -> Self:
        if len(set(self.duty_ids)) != len(self.duty_ids) or len(
            set(self.leave_ids)
        ) != len(self.leave_ids):
            raise ValueError("Duplicate proposal assignment")
        return self


FindingStatus = Literal["violation", "unverified", "unsupported"]
SolveStatus = Literal[
    "OPTIMAL",
    "FEASIBLE",
    "INFEASIBLE",
    "UNKNOWN",
    "MODEL_INVALID",
    "CANCELLED",
    "BLOCKED",
]


class Finding(Value):
    rule_id: str
    status: FindingStatus
    message: str
    subjects: tuple[str, ...] = ()


class ValidationReport(Value):
    input_hash: str
    proposal_hash: str
    findings: tuple[Finding, ...]
    checked_rules: tuple[str, ...]

    @property
    def publishable(self) -> bool:
        return not self.findings


class SolveResult(Value):
    status: SolveStatus
    proposal: Proposal | None = None
    input_hash: str
    rule_revision: str
    solver_version: str
    random_seed: int = 0
    search_workers: int = 1
    stage_seconds: dict[str, float] = Field(default_factory=dict)
    fairness_revision: Literal[
        "eligible-total-work-v1", "eligible-night-holiday-v3"
    ] = "eligible-total-work-v1"
    objective_encoding: dict[str, str | int] = Field(default_factory=dict)
    objective_by_level: tuple[int, ...] = ()
    best_bound_by_level: tuple[float, ...] = ()
    proven_levels: int = 0
    elapsed_seconds: float = 0
    validation: ValidationReport | None = None
    diagnostics: tuple[str, ...] = ()


def content_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()
