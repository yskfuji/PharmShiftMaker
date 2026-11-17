"""Ideal UI contracts for identity, change, lifecycle and personal export."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from html import escape
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import Field, StringConstraints
from sqlalchemy import select

from shift_scheduler.api.routers.planning import DB, RequestModel, Scope, User, access
from shift_scheduler.application import audit_timeline, plan_comparison
from shift_scheduler.application import ideal_workflows as service
from shift_scheduler.application import planning as planning_service
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningChangeCase,
    PlanningChangeEvent,
    PlanningHead,
    PlanningJob,
    PlanningOutbox,
    PlanningPublication,
    StaffLifecycleCase,
)
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import Duty, content_hash

router = APIRouter(prefix="/planning", tags=["ideal workflows"])


EvidenceText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)
]


class EvidenceRecord(RequestModel):
    reason: EvidenceText
    reference: EvidenceText


class MembershipRevision(RequestModel):
    membership_id: str
    issuer: str
    subject: str
    person_id: str
    scope_id: str
    role: Literal["ADMIN", "LEADER", "PHARMACIST"]
    active: bool
    revision: int
    evidence: dict[str, Any]
    created_by: str
    created_at: datetime
    deactivated_at: datetime | None


class MembershipLinkRequest(RequestModel):
    issuer: str = Field(min_length=3, max_length=512)
    subject: str = Field(min_length=1, max_length=256)
    person_id: str = Field(min_length=1, max_length=64)
    role: Literal["ADMIN", "LEADER", "PHARMACIST"]
    evidence: EvidenceRecord
    expected_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=128)


class RevisionMutation(RequestModel):
    expected_version: int = Field(ge=1)
    evidence: EvidenceRecord
    idempotency_key: str = Field(min_length=8, max_length=128)


class CandidateDerivationRequest(RequestModel):
    expected_version: int = Field(ge=0)
    evidence: EvidenceRecord
    idempotency_key: str = Field(min_length=8, max_length=128)


class ScheduleChangeCase(RequestModel):
    case_id: str
    scope_id: str
    publication_id: str
    kind: Literal["ABSENCE", "SWAP"]
    status: str
    version: int
    affected_assignments: list[dict[str, Any]]
    proposed_assignments: list[dict[str, Any]]
    validation: dict[str, Any] | None
    evidence: dict[str, Any]
    created_by: str
    created_at: datetime
    updated_at: datetime
    approval_action: Literal["RECOMMEND", "APPROVE"] | None = None
    can_reject: bool = False


class ScheduleChangeRequest(RequestModel):
    publication_id: str = Field(min_length=1, max_length=64)
    kind: Literal["ABSENCE", "SWAP"]
    affected_assignment_ids: list[str] = Field(min_length=1, max_length=32)
    proposed_assignment_ids: list[str] = Field(max_length=20000)
    evidence: EvidenceRecord
    expected_version: Literal[0] = 0
    idempotency_key: str = Field(min_length=8, max_length=128)


class ChangeApprovalRequest(RevisionMutation):
    expected_publication_version: int = Field(ge=1)


class ScheduleChangeApprovalResult(RequestModel):
    publication_id: str
    version: int
    input_hash: str
    case_id: str
    case_version: int


class LifecycleTaskState(RequestModel):
    key: str
    source: Literal["SYSTEM", "ATTESTATION"]
    status: Literal["NOT_STARTED", "COMPLETED"]
    completed_at: str | None
    satisfied_by: list[str] = Field(default_factory=list)
    can_complete: bool = False
    blocked_reason: str | None = None


class LifecycleCase(RequestModel):
    case_id: str
    scope_id: str
    person_id: str
    kind: Literal["ONBOARD", "OFFBOARD"]
    effective_date: date
    status: str
    version: int
    tasks: list[LifecycleTaskState]
    evidence: dict[str, Any]
    created_by: str
    created_at: datetime
    updated_at: datetime


class LifecycleCreateRequest(RequestModel):
    person_id: str = Field(min_length=1, max_length=64)
    kind: Literal["ONBOARD", "OFFBOARD"]
    effective_date: date
    evidence: EvidenceRecord
    expected_version: Literal[0] = 0
    idempotency_key: str = Field(min_length=8, max_length=128)


class LifecycleTaskRequest(RevisionMutation):
    task_key: str = Field(min_length=1, max_length=64)


class ScopeSettingChange(RequestModel):
    revision: int
    enabled: bool
    reason: str
    reference: str
    actor: str
    at: datetime


class AbsenceConsentSetting(RequestModel):
    enabled: bool
    revision: int
    history: list[ScopeSettingChange] | None


class ScopeSettings(RequestModel):
    scope_id: str
    absence_replacement_consent: AbsenceConsentSetting


class AbsenceConsentRequest(RequestModel):
    enabled: bool
    evidence: EvidenceRecord
    expected_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=128)


class OptionCounterpart(RequestModel):
    person_id: str
    display_name: str | None


class OptionDuty(RequestModel):
    start: str
    end: str
    kind: str
    task: str
    location: str


class ChangeOption(RequestModel):
    option_id: str
    affected_assignment_ids: list[str]
    proposed_assignment_ids: list[str]
    counterpart: OptionCounterpart
    duty: OptionDuty
    publishable: bool
    finding_count: int | None


class ChangeOptions(RequestModel):
    publication_id: str
    publication_version: int
    duty_id: str
    kind: Literal["ABSENCE", "SWAP"]
    consent_required: bool
    options: list[ChangeOption]


class FindingCounts(RequestModel):
    violation: int
    unverified: int
    unsupported: int


class SolverRecord(RequestModel):
    job_id: str
    status: str
    random_seed: int
    objective_by_level: list[int]
    proven_levels: int


class PlanFigures(RequestModel):
    draft_id: str
    findings: FindingCounts
    publishable: bool
    changes_from_previous: int | None
    changes_from_publication: int | None
    preference_cost: int
    preferences_met: int
    preferences_total: int
    work_seconds_total: int
    work_seconds_spread: int
    assignment_count: int
    proposal_hash: str
    duplicate_of: str | None
    solver: SolverRecord | None


class PlanPair(RequestModel):
    a: str
    b: str
    differing_duties: int
    affected_people: int


class PlanComparison(RequestModel):
    input_hash: str
    plans: list[PlanFigures]
    pairs: list[PlanPair]
    order: list[str]
    order_rule: str
    meaning: str


class AuditEntry(RequestModel):
    at: datetime
    kind: str
    category: str
    actor_role: Literal["ADMIN", "LEADER", "PHARMACIST"] | None
    subject_count: int | None
    version: int | None


class AuditTimelinePage(RequestModel):
    entries: list[AuditEntry]
    next_cursor: str | None
    sources: list[str]
    limits: list[str]


class PersonalScheduleExport(RequestModel):
    person_id: str
    publication_id: str
    format: Literal["PRINT_HTML", "ICALENDAR"]
    period_start: str
    period_end: str
    assignment_count: int


class PublicationSummary(RequestModel):
    publication_id: str
    version: int
    period: str
    input_hash: str
    created_at: datetime


class ScheduleAssignmentChange(RequestModel):
    duty_id: str
    kind: Literal["ADDED", "REMOVED", "CHANGED"]


class ScheduleCalendarView(RequestModel):
    scope_id: str
    requested_period: str | None
    visibility: Literal["department", "self"]
    publication: PublicationSummary | None
    previous_publication: PublicationSummary | None
    assignments: list[dict[str, Any]]
    changes: list[ScheduleAssignmentChange]
    can_export_department: bool
    limitations: list[str]


class DailyOperationsSnapshot(RequestModel):
    scope_id: str
    day: date
    observed_at: datetime
    visibility: Literal["department", "self"]
    scheduled_assignments: list[dict[str, Any]]
    scheduled_count: int
    open_case_count: int
    absence_case_count: int
    coverage_finding_count: int
    undelivered_notification_count: int
    limitations: list[str]


class StabilityDay(RequestModel):
    day: date
    change_count: int


class ScheduleStabilitySummary(RequestModel):
    scope_id: str
    observed_at: datetime
    window_days: int
    publication_count: int
    change_event_count: int
    days: list[StabilityDay]
    meaning: str


@router.get("/memberships", response_model=list[MembershipRevision])
def list_memberships(
    scope_id: Scope,
    session: DB,
    user: User,
    include_inactive: Annotated[bool, Query()] = False,
) -> list[dict[str, Any]]:
    access(session, user, scope_id, admin=True)
    query = select(AccountMembership).where(AccountMembership.scope_id == scope_id)
    if not include_inactive:
        query = query.where(AccountMembership.active.is_(True))
    rows = session.scalars(
        query.order_by(AccountMembership.role, AccountMembership.membership_id)
    ).all()
    return [service.membership_response(row) for row in rows]


@router.post("/memberships", response_model=MembershipRevision)
def link_membership(
    payload: MembershipLinkRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.link_membership(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        issuer=payload.issuer,
        subject=payload.subject,
        person_id=payload.person_id,
        role=payload.role,
        evidence=payload.evidence.model_dump(),
        expected_version=payload.expected_version,
        idempotency_key=payload.idempotency_key,
    )


@router.post(
    "/memberships/{membership_id}/deactivate", response_model=MembershipRevision
)
def deactivate_membership(
    membership_id: str,
    payload: RevisionMutation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    member = access(session, user, scope_id, admin=True)
    return service.deactivate_membership(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        actor_membership_id=member.membership_id,
        membership_id=membership_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


@router.post("/candidates/derive")
def derive_candidates(
    payload: CandidateDerivationRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.derive_candidates(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


@router.get("/change-cases", response_model=list[ScheduleChangeCase])
def list_change_cases(scope_id: Scope, session: DB, user: User) -> list[dict[str, Any]]:
    member = access(session, user, scope_id)
    rows = session.scalars(
        select(PlanningChangeCase)
        .where(PlanningChangeCase.scope_id == scope_id)
        .order_by(PlanningChangeCase.updated_at.desc())
    ).all()
    return [
        visible_case(session, row, member, user.user_id)
        for row in rows
        if member.role in ("ADMIN", "LEADER")
        or member.person_id in service.involved_person_ids(session, row)
    ]


def visible_case(
    session: DB, row: PlanningChangeCase, member: AccountMembership, user_id: str
) -> dict[str, Any]:
    """Planners see the whole case. A pharmacist sees an allow-list: their own duties in
    the change (for an exchange, also the counterpart duties they are asked to consent
    to), the findings about themselves or those duties, their own consent state, and the
    evidence only if they wrote it. Other people's duties and findings are not returned.
    """
    response = service.change_response(row)
    if member.role in ("ADMIN", "LEADER"):
        related = service.actor_is_related(
            session, row, actor=user_id, actor_person_id=member.person_id
        )
        approval_action: str | None = None
        if row.status == "READY":
            approval_action = "RECOMMEND" if related else "APPROVE"
        elif row.status == "AWAITING_INDEPENDENT_APPROVAL" and not related:
            approval_action = "APPROVE"
        return {
            **response,
            "approval_action": approval_action,
            "can_reject": row.status in ("READY", "AWAITING_INDEPENDENT_APPROVAL"),
        }
    me = member.person_id
    added = set(service.replacement_duty_ids(session, row))
    affected = [
        d
        for d in row.affected_assignments
        if row.kind == "SWAP" or d["person_id"] == me
    ]
    replacements = [
        d
        for d in row.proposed_assignments
        if d["duty_id"] in added and (row.kind == "SWAP" or d["person_id"] == me)
    ]
    mine = {me} | {d["duty_id"] for d in affected + replacements}
    validation = row.validation or {}
    own = [
        f for f in validation.get("findings", []) if set(f.get("subjects", ())) & mine
    ]
    return {
        **response,
        "affected_assignments": affected,
        "proposed_assignments": replacements,
        "validation": {
            "findings": own,
            "publishable": not validation.get("findings"),
            "required_consent_person_ids": [
                p for p in validation.get("required_consent_person_ids", []) if p == me
            ],
            "consented_person_ids": [
                p for p in validation.get("consented_person_ids", []) if p == me
            ],
        },
        "evidence": row.evidence if row.created_by == user_id else {},
        "created_by": row.created_by if row.created_by == user_id else "",
    }


@router.post("/change-cases", response_model=ScheduleChangeCase)
def create_change_case(
    payload: ScheduleChangeRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    publication = session.get(PlanningPublication, payload.publication_id)
    if not publication or publication.scope_id != scope_id:
        raise HTTPException(404, "Publication not found in authorized scope")
    affected = [
        d
        for d in publication.payload["assignments"]
        if d["duty_id"] in set(payload.affected_assignment_ids)
    ]
    if member.role == "PHARMACIST":
        own = [d for d in affected if d["person_id"] == member.person_id]
        others = [d for d in affected if d["person_id"] != member.person_id]
        # An absence concerns only the pharmacist's own duties. An exchange concerns one
        # of them and one duty of the other person, who has to consent before approval.
        if not own or (others and (payload.kind != "SWAP" or len(others) > 1)):
            raise HTTPException(
                403, "A pharmacist may open a case only for their own assignment"
            )
    # The facility lock orders this check against a concurrent switch of the setting.
    planning_service.lock_facility(session, scope_id)
    if (
        member.role == "PHARMACIST"
        and payload.kind == "ABSENCE"
        and payload.proposed_assignment_ids
        and not service.absence_consent_policy(session, scope_id)["enabled"]
    ):
        # Without the consent setting an absence needs no consent, so a replacement
        # named by a pharmacist would put another person on duty without their
        # agreement. A planner assigns it instead.
        raise HTTPException(
            403, "A pharmacist may not name a replacement for an absence"
        )
    result = service.create_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        publication_id=payload.publication_id,
        kind=payload.kind,
        affected_assignment_ids=payload.affected_assignment_ids,
        proposed_assignment_ids=payload.proposed_assignment_ids,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    row = session.get(PlanningChangeCase, result["case_id"])
    return visible_case(session, row, member, user.user_id) if row else result


@router.post(
    "/change-cases/{case_id}/approve", response_model=ScheduleChangeApprovalResult
)
def approve_change_case(
    case_id: str,
    payload: ChangeApprovalRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    member = access(session, user, scope_id, write=True)
    return service.approve_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        actor_person_id=member.person_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        expected_publication_version=payload.expected_publication_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


@router.post("/change-cases/{case_id}/recommend", response_model=ScheduleChangeCase)
def recommend_change_case(
    case_id: str,
    payload: RevisionMutation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    member = access(session, user, scope_id, write=True)
    service.recommend_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        actor_person_id=member.person_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    row = case_in_scope(session, case_id, scope_id)
    session.refresh(row)
    return visible_case(session, row, member, user.user_id)


@router.post("/change-cases/{case_id}/reject", response_model=ScheduleChangeCase)
def reject_change_case(
    case_id: str,
    payload: RevisionMutation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    member = access(session, user, scope_id, write=True)
    service.reject_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    row = case_in_scope(session, case_id, scope_id)
    session.refresh(row)
    return visible_case(session, row, member, user.user_id)


@router.post("/change-cases/{case_id}/consent", response_model=ScheduleChangeCase)
def consent_change_case(
    case_id: str, payload: RevisionMutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    row = session.get(PlanningChangeCase, case_id)
    required = (
        set((row.validation or {}).get("required_consent_person_ids", []))
        if row
        else set()
    )
    if not row or row.scope_id != scope_id:
        raise HTTPException(404, "Change case not found in authorized scope")
    if member.person_id not in required:
        raise HTTPException(403, "Only a person asked to consent may consent")
    service.consent_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        person_id=member.person_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    session.refresh(row)
    return visible_case(session, row, member, user.user_id)


def case_in_scope(session: DB, case_id: str, scope_id: str) -> PlanningChangeCase:
    row = session.get(PlanningChangeCase, case_id)
    if not row or row.scope_id != scope_id:
        raise HTTPException(404, "Change case not found in authorized scope")
    return row


def may_see(session: DB, row: PlanningChangeCase, member: AccountMembership) -> bool:
    return member.role in ("ADMIN", "LEADER") or member.person_id in (
        service.involved_person_ids(session, row)
    )


@router.get("/change-cases/options", response_model=ChangeOptions)
def change_case_options(
    scope_id: Scope,
    session: DB,
    user: User,
    publication_id: Annotated[str, Query(min_length=1, max_length=64)],
    duty_id: Annotated[str, Query(min_length=1, max_length=128)],
    kind: Annotated[Literal["ABSENCE", "SWAP"], Query()],
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    publication = current_publication(session, publication_id, scope_id)
    duty = next(
        (d for d in publication.payload["assignments"] if d["duty_id"] == duty_id),
        None,
    )
    planner = member.role in ("ADMIN", "LEADER")
    if duty is None or (not planner and duty["person_id"] != member.person_id):
        # A pharmacist asks only about their own duty; others do not exist for them.
        raise HTTPException(404, "Duty not found in authorized scope")
    consent_on = service.absence_consent_policy(session, scope_id)["enabled"]
    if not planner and kind == "ABSENCE" and not consent_on:
        raise HTTPException(
            403, "A pharmacist may not name a replacement for an absence"
        )
    result = service.change_options(
        session, publication, duty_id, kind, planner=planner
    )
    return {**result, "consent_required": kind == "SWAP" or consent_on}


@router.get("/change-cases/{case_id}", response_model=ScheduleChangeCase)
def read_change_case(
    case_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    row = case_in_scope(session, case_id, scope_id)
    if not may_see(session, row, member):
        # A pharmacist not involved learns nothing, not even that the case exists.
        raise HTTPException(404, "Change case not found in authorized scope")
    return visible_case(session, row, member, user.user_id)


@router.post("/change-cases/{case_id}/withdraw", response_model=ScheduleChangeCase)
def withdraw_change_case(
    case_id: str, payload: RevisionMutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    row = case_in_scope(session, case_id, scope_id)
    if not may_see(session, row, member):
        raise HTTPException(404, "Change case not found in authorized scope")
    if member.role not in ("ADMIN", "LEADER") and row.created_by != user.user_id:
        raise HTTPException(403, "Only the creator or a planner may withdraw a case")
    service.withdraw_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    session.refresh(row)
    return visible_case(session, row, member, user.user_id)


@router.post("/change-cases/{case_id}/decline", response_model=ScheduleChangeCase)
def decline_change_case(
    case_id: str, payload: RevisionMutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    row = case_in_scope(session, case_id, scope_id)
    required = set((row.validation or {}).get("required_consent_person_ids", []))
    if member.person_id not in required:
        if not may_see(session, row, member):
            raise HTTPException(404, "Change case not found in authorized scope")
        raise HTTPException(403, "Only a person asked to consent may decline")
    service.decline_change_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        person_id=member.person_id,
        case_id=case_id,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )
    session.refresh(row)
    return visible_case(session, row, member, user.user_id)


def scope_settings(session: DB, scope_id: str, admin: bool) -> dict[str, Any]:
    policy = service.absence_consent_policy(session, scope_id)
    return {
        "scope_id": scope_id,
        "absence_replacement_consent": {
            "enabled": policy["enabled"],
            "revision": policy["revision"],
            # Who changed it and why is for administrators only.
            "history": (
                service.absence_consent_history(session, scope_id) if admin else None
            ),
        },
    }


@router.get("/scope-settings", response_model=ScopeSettings)
def read_scope_settings(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    member = access(session, user, scope_id)
    return scope_settings(session, scope_id, member.role == "ADMIN")


@router.post("/scope-settings/absence-consent", response_model=ScopeSettings)
def switch_absence_consent(
    payload: AbsenceConsentRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    service.set_absence_consent(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        enabled=payload.enabled,
        evidence=payload.evidence.model_dump(),
        expected_version=payload.expected_version,
        idempotency_key=payload.idempotency_key,
    )
    return scope_settings(session, scope_id, True)


@router.get("/plan-comparison", response_model=PlanComparison)
def compare_plans(
    scope_id: Scope,
    session: DB,
    user: User,
    input_hash: Annotated[str, Query(min_length=1, max_length=64)],
    draft_ids: Annotated[list[str], Query(min_length=1, max_length=6)],
) -> dict[str, Any]:
    """Figures for up to six drafts of one input (see application/plan_comparison.py)."""
    access(session, user, scope_id, write=True)
    source = planning_service.require_input(session, input_hash, scope_id)
    snapshot = parse_snapshot(source.payload)
    if len(set(draft_ids)) != len(draft_ids):
        raise HTTPException(422, "A draft is listed twice")
    drafts = []
    solver = {
        job.result["draft_id"]: job
        for job in session.scalars(
            select(PlanningJob).where(PlanningJob.input_hash == input_hash)
        )
        if job.result and job.result.get("draft_id")
    }
    for draft_id in draft_ids:
        draft, draft_input = planning_service.require_draft(session, draft_id, scope_id)
        if draft_input.input_hash != input_hash:
            raise HTTPException(422, "Only plans of the same input can be compared")
        job = solver.get(draft_id)
        job_result = job.result if job is not None else None
        drafts.append(
            {
                "draft_id": draft_id,
                "duty_ids": draft.proposal["duty_ids"],
                "solver": (
                    {
                        "job_id": job.job_id,
                        "status": job_result.get("status", job.status),
                        "random_seed": job_result.get("random_seed", 0),
                        "objective_by_level": job_result.get("objective_by_level", []),
                        "proven_levels": job_result.get("proven_levels", 0),
                    }
                    if job is not None and job_result is not None
                    else None
                ),
            }
        )
    head = session.get(
        PlanningHead,
        content_hash([scope_id, planning_service.period_key(snapshot)]),
    )
    publication = (
        session.get(PlanningPublication, head.publication_id)
        if head and head.publication_id
        else None
    )
    published = (
        {d["duty_id"] for d in publication.payload["assignments"]}
        if publication
        else None
    )
    return plan_comparison.compare(snapshot, drafts, published)


@router.get("/audit-timeline", response_model=AuditTimelinePage)
def read_audit_timeline(
    scope_id: Scope,
    session: DB,
    user: User,
    before: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    category: Annotated[
        Literal[
            "change",
            "membership",
            "lifecycle",
            "schedule",
            "request",
            "compliance",
            "privacy",
            "other",
        ]
        | None,
        Query(),
    ] = None,
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    try:
        return audit_timeline.page(
            session, scope_id, before=before, limit=limit, only=category
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def _publication_summary(row: PlanningPublication) -> dict[str, Any]:
    return {
        "publication_id": row.publication_id,
        "version": row.version,
        "period": row.period_key,
        "input_hash": row.payload["input_hash"],
        "created_at": row.created_at,
    }


def _period_dates(period_key: str) -> tuple[date, date]:
    start, end = period_key.split("|", 1)
    return datetime.fromisoformat(start).date(), datetime.fromisoformat(end).date()


@router.get("/schedule-calendar", response_model=ScheduleCalendarView)
def schedule_calendar(
    scope_id: Scope,
    session: DB,
    user: User,
    period: Annotated[str | None, Query(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")] = None,
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    head_ids = set(
        session.scalars(
            select(PlanningHead.publication_id)
            .join(
                PlanningPublication,
                PlanningHead.publication_id == PlanningPublication.publication_id,
            )
            .where(PlanningPublication.scope_id == scope_id)
        ).all()
    )
    current = session.scalars(
        select(PlanningPublication)
        .where(PlanningPublication.publication_id.in_(head_ids))
        .order_by(PlanningPublication.created_at.desc())
    ).all()
    selected = next(
        (
            row
            for row in current
            if period is None
            or _period_dates(row.period_key)[0].strftime("%Y-%m") == period
        ),
        None,
    )
    previous = None
    if selected:
        previous = session.scalar(
            select(PlanningPublication)
            .where(
                PlanningPublication.scope_id == scope_id,
                PlanningPublication.period_key == selected.period_key,
                PlanningPublication.version < selected.version,
            )
            .order_by(PlanningPublication.version.desc())
            .limit(1)
        )
    own = member.role == "PHARMACIST"
    assignments = list(selected.payload["assignments"]) if selected else []
    before = list(previous.payload["assignments"]) if previous else []
    if own:
        assignments = [
            item for item in assignments if item["person_id"] == member.person_id
        ]
        before = [item for item in before if item["person_id"] == member.person_id]
    current_by_id = {item["duty_id"]: item for item in assignments}
    previous_by_id = {item["duty_id"]: item for item in before}
    changes = (
        [
            {"duty_id": duty_id, "kind": "ADDED"}
            for duty_id in sorted(current_by_id.keys() - previous_by_id.keys())
        ]
        + [
            {"duty_id": duty_id, "kind": "REMOVED"}
            for duty_id in sorted(previous_by_id.keys() - current_by_id.keys())
        ]
        + [
            {"duty_id": duty_id, "kind": "CHANGED"}
            for duty_id in sorted(current_by_id.keys() & previous_by_id.keys())
            if current_by_id[duty_id] != previous_by_id[duty_id]
        ]
    )
    return {
        "scope_id": scope_id,
        "requested_period": period,
        "visibility": "self" if own else "department",
        "publication": _publication_summary(selected) if selected else None,
        "previous_publication": _publication_summary(previous) if previous else None,
        "assignments": assignments,
        "changes": changes,
        "can_export_department": member.role in ("ADMIN", "LEADER"),
        "limitations": [
            "変更は同一期間の直前公開版との比較です。",
            "表示は予定であり、実績勤務を示しません。",
        ],
    }


@router.get("/daily-operations", response_model=DailyOperationsSnapshot)
def daily_operations(
    scope_id: Scope,
    session: DB,
    user: User,
    day: Annotated[date, Query()],
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    head_ids = set(
        session.scalars(
            select(PlanningHead.publication_id)
            .join(
                PlanningPublication,
                PlanningHead.publication_id == PlanningPublication.publication_id,
            )
            .where(PlanningPublication.scope_id == scope_id)
        ).all()
    )
    publications = session.scalars(
        select(PlanningPublication).where(
            PlanningPublication.publication_id.in_(head_ids)
        )
    ).all()
    publication = next(
        (
            row
            for row in publications
            if _period_dates(row.period_key)[0]
            <= day
            < _period_dates(row.period_key)[1]
        ),
        None,
    )
    assignments = [
        item
        for item in (publication.payload["assignments"] if publication else [])
        if datetime.fromisoformat(item["start"])
        .astimezone(ZoneInfo("Asia/Tokyo"))
        .date()
        == day
    ]
    if member.role == "PHARMACIST":
        assignments = [
            item for item in assignments if item["person_id"] == member.person_id
        ]
    cases = session.scalars(
        select(PlanningChangeCase).where(
            PlanningChangeCase.scope_id == scope_id,
            PlanningChangeCase.status.in_(
                (
                    "DRAFT",
                    "AWAITING_CONSENT",
                    "READY",
                    "AWAITING_INDEPENDENT_APPROVAL",
                )
            ),
        )
    ).all()
    cases = [
        row
        for row in cases
        if any(
            datetime.fromisoformat(item["start"])
            .astimezone(ZoneInfo("Asia/Tokyo"))
            .date()
            == day
            for item in row.affected_assignments
        )
        and (
            member.role in ("ADMIN", "LEADER")
            or member.person_id in service.involved_person_ids(session, row)
        )
    ]
    notices = session.scalars(
        select(PlanningOutbox).where(
            PlanningOutbox.scope_id == scope_id,
            PlanningOutbox.delivered_at.is_(None),
        )
    ).all()
    if member.role == "PHARMACIST":
        notices = [
            row
            for row in notices
            if member.person_id in row.payload.get("person_ids", [])
        ]
    return {
        "scope_id": scope_id,
        "day": day,
        "observed_at": datetime.now(UTC),
        "visibility": "self" if member.role == "PHARMACIST" else "department",
        "scheduled_assignments": assignments,
        "scheduled_count": len(assignments),
        "open_case_count": len(cases),
        "absence_case_count": sum(row.kind == "ABSENCE" for row in cases),
        "coverage_finding_count": sum(
            len((row.validation or {}).get("findings", [])) for row in cases
        ),
        "undelivered_notification_count": len(notices),
        "limitations": [
            "予定上の勤務であり、在席・出勤実績ではありません。",
            "配置注意は進行中ケースのサーバー検証結果だけを数えます。",
        ],
    }


@router.get("/schedule-stability", response_model=ScheduleStabilitySummary)
def schedule_stability(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id)
    observed = datetime.now(UTC)
    start = observed - timedelta(days=13)
    publications = session.scalars(
        select(PlanningPublication).where(
            PlanningPublication.scope_id == scope_id,
            PlanningPublication.created_at >= start,
        )
    ).all()
    events = (
        session.execute(
            select(PlanningChangeEvent.created_at)
            .join(PlanningChangeCase)
            .where(
                PlanningChangeCase.scope_id == scope_id,
                PlanningChangeEvent.created_at >= start,
            )
        )
        .scalars()
        .all()
    )
    counts: dict[date, int] = {}
    for instant in events:
        value = (
            instant.replace(tzinfo=instant.tzinfo or UTC)
            .astimezone(ZoneInfo("Asia/Tokyo"))
            .date()
        )
        counts[value] = counts.get(value, 0) + 1
    days = []
    today = observed.astimezone(ZoneInfo("Asia/Tokyo")).date()
    for offset in range(13, -1, -1):
        value = today - timedelta(days=offset)
        days.append({"day": value, "change_count": counts.get(value, 0)})
    return {
        "scope_id": scope_id,
        "observed_at": observed,
        "window_days": 14,
        "publication_count": len(publications),
        "change_event_count": len(events),
        "days": days,
        "meaning": "直近14日間の公開回数と変更イベント件数です。健康・離職・法令適合の効果は示しません。",
    }


@router.get("/lifecycle-cases", response_model=list[LifecycleCase])
def list_lifecycle_cases(
    scope_id: Scope, session: DB, user: User
) -> list[dict[str, Any]]:
    access(session, user, scope_id, admin=True)
    rows = session.scalars(
        select(StaffLifecycleCase)
        .where(StaffLifecycleCase.scope_id == scope_id)
        .order_by(StaffLifecycleCase.updated_at.desc())
    ).all()
    return [service.lifecycle_response(row, session) for row in rows]


@router.post("/lifecycle-cases", response_model=LifecycleCase)
def create_lifecycle_case(
    payload: LifecycleCreateRequest, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.create_lifecycle_case(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        person_id=payload.person_id,
        kind=payload.kind,
        effective_date=payload.effective_date,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


@router.post("/lifecycle-cases/{case_id}/tasks", response_model=LifecycleCase)
def complete_lifecycle_task(
    case_id: str,
    payload: LifecycleTaskRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.complete_lifecycle_task(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        case_id=case_id,
        task_key=payload.task_key,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


@router.post(
    "/lifecycle-cases/{case_id}/tasks/{task_key}/attest", response_model=LifecycleCase
)
def attest_lifecycle_task(
    case_id: str,
    task_key: str,
    payload: RevisionMutation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    return service.complete_lifecycle_task(
        session,
        scope_id=scope_id,
        actor=user.user_id,
        case_id=case_id,
        task_key=task_key,
        expected_version=payload.expected_version,
        evidence=payload.evidence.model_dump(),
        idempotency_key=payload.idempotency_key,
    )


def current_publication(
    session: DB, publication_id: str, scope_id: str
) -> PlanningPublication:
    """A publication that is still the current one of its period (not replaced or cancelled)."""
    publication = session.get(PlanningPublication, publication_id)
    if not publication or publication.scope_id != scope_id:
        raise HTTPException(404, "Publication not found in authorized scope")
    head = session.get(PlanningHead, content_hash([scope_id, publication.period_key]))
    if not head or head.publication_id != publication_id:
        raise HTTPException(
            409, "This publication was replaced or cancelled; open the current one"
        )
    return publication


def personal_duties(publication: PlanningPublication, person_id: str) -> list[Duty]:
    duties = [
        Duty.model_validate(item)
        for item in publication.payload["assignments"]
        if item["person_id"] == person_id
    ]
    if any(d.person_id != person_id for d in duties):  # defense in depth
        raise RuntimeError("Personal export crossed a subject boundary")
    return sorted(duties, key=lambda duty: duty.start)


@router.get(
    "/personal-schedule/{publication_id}", response_model=PersonalScheduleExport
)
def personal_schedule_metadata(
    publication_id: str,
    scope_id: Scope,
    session: DB,
    user: User,
    format: Annotated[Literal["PRINT_HTML", "ICALENDAR"], Query()] = "PRINT_HTML",
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    publication = current_publication(session, publication_id, scope_id)
    duties = personal_duties(publication, member.person_id)
    start, end = period_bounds(publication)
    return {
        "person_id": member.person_id,
        "publication_id": publication_id,
        "format": format,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "assignment_count": len(duties),
    }


def period_bounds(publication: PlanningPublication) -> tuple[datetime, datetime]:
    """The publication period, stored as ``"<start>|<end>"`` (planning.period_key)."""
    start, end = publication.period_key.split("|")
    return datetime.fromisoformat(start), datetime.fromisoformat(end)


def period_label(publication: PlanningPublication) -> str:
    start, end = period_bounds(publication)
    return f"{start.date().isoformat()}–{end.date().isoformat()}"


def ical_fold(line: str) -> str:
    """Fold a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1)."""
    parts, current, limit = [], b"", 75
    for char in line:
        encoded = char.encode("utf-8")
        if len(current) + len(encoded) > limit:
            parts.append(current.decode("utf-8"))
            current, limit = b"", 74  # a continuation line starts with one space
        current += encoded
    parts.append(current.decode("utf-8"))
    return "\r\n ".join(parts)


def ical_escape(value: str) -> str:
    return (
        value.replace("\r", "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


@router.get(
    "/personal-schedule/{publication_id}/content",
    response_class=Response,
    responses={200: {"content": {"text/html": {}, "text/calendar": {}}}},
)
def personal_schedule_content(
    publication_id: str,
    scope_id: Scope,
    session: DB,
    user: User,
    format: Annotated[Literal["print", "ical"], Query()] = "print",
) -> Response:
    member = access(session, user, scope_id)
    publication = current_publication(session, publication_id, scope_id)
    duties = personal_duties(publication, member.person_id)
    if format == "ical":
        # DTSTAMP: when the publication was created (SQLite returns it without a zone; it is UTC).
        created = (
            publication.created_at
            if publication.created_at.tzinfo
            else publication.created_at.replace(tzinfo=UTC)
        )
        stamp = created.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//PharmShift//Personal Schedule//JA",
        ]
        for duty in duties:
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{ical_escape(duty.duty_id)}@pharmshift.local",
                    f"DTSTAMP:{stamp}",
                    f"DTSTART:{duty.start.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTEND:{duty.end.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}",
                    f"SUMMARY:{ical_escape(duty.kind)}",
                    f"LOCATION:{ical_escape(duty.location)}",
                    "END:VEVENT",
                ]
            )
        lines.append("END:VCALENDAR")
        return Response(
            "\r\n".join(ical_fold(line) for line in lines) + "\r\n",
            media_type="text/calendar; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="schedule-{period_bounds(publication)[0].date().isoformat()}.ics"',
                "Cache-Control": "private, no-store",
            },
        )
    rows = "".join(
        f"<tr><td>{escape(d.start.isoformat())}</td><td>{escape(d.end.isoformat())}</td>"
        f"<td>{escape(d.kind)}</td><td>{escape(d.location)}</td></tr>"
        for d in duties
    )
    html = (
        '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>自分の勤務表</title></head><body>'
        f"<h1>自分の勤務表</h1><p>公開版 {publication.version} · 期間 {escape(period_label(publication))}</p>"
        f"<table><thead><tr><th>開始</th><th>終了</th><th>勤務</th><th>場所</th></tr></thead><tbody>{rows}</tbody></table>"
        "<p>ブラウザーの印刷機能を使用してください。</p></body></html>"
    )
    return HTMLResponse(html, headers={"Cache-Control": "private, no-store"})
