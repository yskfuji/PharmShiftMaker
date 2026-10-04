"""Transactional planning use cases. HTTP and CP-SAT do not own persistence."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from shift_scheduler.db.planning_models import (
    ActualWorkEvent,
    LeaveBalance,
    LeaveEvent,
    PlanningDraft,
    PlanningHead,
    PlanningInput,
    PlanningInputHead,
    PlanningJob,
    PlanningOutbox,
    PlanningPublication,
    PlanningReceipt,
    PlanningScope,
)
from shift_scheduler.domain.compliance import SolverSnapshotV2, parse_snapshot
from shift_scheduler.domain.planning import (
    Duty,
    Proposal,
    SolveResult,
    SolverSnapshot,
    content_hash,
)
from shift_scheduler.validation.planning import validate


class Conflict(ValueError):
    """A stale input/version, conflicting idempotency key, or ledger conflict."""


class Blocked(ValueError):
    """Validation did not establish publishability."""


def scope_of(snapshot: SolverSnapshot) -> str:
    return f"{snapshot.facility_id}/{snapshot.department_id}"


def period_key(snapshot: SolverSnapshot) -> str:
    return snapshot.period.start.isoformat() + "|" + snapshot.period.end.isoformat()


def published_context(
    session: Session, snapshot: SolverSnapshot
) -> tuple[dict[str, Duty], dict[str, Duty]]:
    """Read current immutable commitments; never infer them from a caller's flags."""
    fixed: dict[str, Duty] = {}
    previous: dict[str, Duty] = {}
    publications = session.scalars(
        select(PlanningPublication)
        .join(
            PlanningHead,
            PlanningHead.publication_id == PlanningPublication.publication_id,
        )
        .where(
            PlanningPublication.scope_id.startswith(snapshot.facility_id + "/")
            if isinstance(snapshot, SolverSnapshotV2)
            else PlanningPublication.scope_id == scope_of(snapshot)
        )
    ).all()
    people = {p.person_id for p in snapshot.people}
    for publication in publications:
        from shift_scheduler.application.publication_history import actualized

        replaced = actualized(session, snapshot, publication)
        for payload in publication.payload["assignments"]:
            duty = Duty.model_validate(payload)
            if (
                duty.duty_id in replaced
                or duty.person_id not in people
                or not snapshot.context.overlaps(duty)
            ):
                continue
            if not snapshot.context.contains(duty):
                raise Conflict("Extend context to include the entire published duty")
            if publication.scope_id == scope_of(
                snapshot
            ) and publication.period_key == period_key(snapshot):
                previous[duty.duty_id] = duty
            else:
                identity = (
                    "publication:" + publication.publication_id + ":" + duty.duty_id
                )
                fixed[identity] = duty.model_copy(
                    update={
                        "duty_id": identity,
                        "source": (
                            "published"
                            if publication.scope_id == scope_of(snapshot)
                            else "external"
                        ),
                        "fixed": True,
                        "external_employer_id": (
                            snapshot.facility_id
                            if publication.scope_id != scope_of(snapshot)
                            else None
                        ),
                    }
                )
    return fixed, previous


def require_published_context(session: Session, snapshot: SolverSnapshot) -> None:
    """Called under the scope lock at publication, including after concurrent changes."""
    expected, previous = published_context(session, snapshot)
    supplied = {
        d.duty_id: d for d in snapshot.history if d.duty_id.startswith("publication:")
    }
    if supplied != expected:
        raise Conflict("Published context changed; refresh input and review again")
    actual_ids = {d.duty_id for d in snapshot.history if d.source == "actual"}
    previous = {key: value for key, value in previous.items() if key not in actual_ids}
    if set(snapshot.previous_duty_ids) != set(previous):
        raise Conflict(
            "Previous published assignments must be refreshed before replacement"
        )
    candidates = {d.duty_id: d for d in snapshot.candidates}
    if any(candidates.get(key) != duty for key, duty in previous.items()):
        raise Conflict("A published duty ID cannot be reused for changed duty contents")


def require_input(session: Session, input_hash: str, scope_id: str) -> PlanningInput:
    return checked_input(session, input_hash, scope_id)[0]


def checked_input(
    session: Session, input_hash: str, scope_id: str
) -> tuple[PlanningInput, SolverSnapshot]:
    """One request-local parse; never cache across transactions or revisions."""
    row = session.get(PlanningInput, input_hash)
    if row is None or row.scope_id != scope_id:
        raise LookupError("Input not found in authorized scope")
    snapshot = parse_snapshot(row.payload)
    if (
        content_hash(row.payload) != row.input_hash
        or snapshot.input_hash != row.input_hash
    ):
        raise Conflict(
            "Input hash or schema interpretation changed; explicit validated migration is required"
        )
    return row, snapshot


def emit(
    session: Session, scope_id: str, actor: str, kind: str, payload: dict[str, Any]
) -> None:
    session.add(
        PlanningOutbox(
            event_id=uuid4().hex,
            scope_id=scope_id,
            actor=actor,
            kind=kind,
            payload=payload,
        )
    )


def register_input(
    session: Session, snapshot: SolverSnapshot, actor: str, expected_revision: int
) -> dict[str, Any]:
    scope_id = scope_of(snapshot)
    if snapshot.replaces_publication_id or snapshot.reservation_credits:
        current_head = session.get(
            PlanningHead, content_hash([scope_id, period_key(snapshot)])
        )
        previous = (
            session.get(PlanningPublication, snapshot.replaces_publication_id)
            if snapshot.replaces_publication_id
            else None
        )
        if (
            not current_head
            or not previous
            or current_head.publication_id != previous.publication_id
        ):
            raise Conflict(
                "Replacement credit must refer to the current publication of this period"
            )
        if previous.payload["leave_allocations"] != [
            a.model_dump(mode="json") for a in snapshot.reservation_credits
        ]:
            raise Conflict(
                "Replacement credit does not match immutable published leave"
            )
        if settled_amount(session, previous.publication_id):
            raise Conflict("Settled leave cannot be credited as an unused reservation")
    scope = session.get(PlanningScope, scope_id)
    if scope is None:
        if expected_revision != 0:
            raise Conflict("Scope revision mismatch")
        scope = PlanningScope(scope_id=scope_id, input_revision=0, data_revision=0)
        session.add(scope)
        session.flush()
    existing = session.get(PlanningInput, snapshot.input_hash)
    if existing:
        if not input_is_current(session, existing):
            raise Conflict("This historical input is no longer current")
        return {
            "input_hash": existing.input_hash,
            "input_revision": existing.input_revision,
        }
    sources = {
        "rule_revision": snapshot.rule_revision,
        "policy": snapshot.policy_evidence.model_dump(mode="json"),
        "people": [p.model_dump(mode="json") for p in snapshot.people],
        "contracts": [
            c.model_dump(
                mode="json", exclude={"period_min_seconds", "period_max_seconds"}
            )
            for c in snapshot.contracts
        ],
        "capabilities": [c.model_dump(mode="json") for c in snapshot.capabilities],
    }
    source_hash = content_hash(sources)
    if isinstance(snapshot, SolverSnapshotV2):
        sources["v2"] = {
            key: snapshot.model_dump(mode="json")[key]
            for key in (
                "employments",
                "agreements",
                "management_models",
                "leave_policies",
            )
        }
        source_hash = content_hash(sources)
    data_revision = scope.data_revision + int(scope.source_fingerprint != source_hash)
    changed = session.execute(
        update(PlanningScope)
        .where(
            PlanningScope.scope_id == scope_id,
            PlanningScope.input_revision == expected_revision,
        )
        .values(
            input_revision=expected_revision + 1,
            data_revision=data_revision,
            source_fingerprint=source_hash,
        )
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Scope input changed concurrently")
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.application.compliance import register_snapshot

        register_snapshot(session, snapshot, actor)
    for grant in snapshot.grants:
        grant_row = session.get(LeaveBalance, grant.grant_id)
        if grant_row is None:
            session.add(
                LeaveBalance(
                    grant_id=grant.grant_id,
                    person_id=grant.person_id,
                    employer_id=grant.employer_id,
                    amount=grant.amount,
                    consumed=grant.consumed,
                    reserved=grant.reserved,
                    revision=0,
                    payload=grant.model_dump(mode="json"),
                )
            )
        else:
            # A new input cannot reset a shared, cross-month leave ledger.
            identity = (grant_row.person_id, grant_row.employer_id, grant_row.amount)
            if identity != (grant.person_id, grant.employer_id, grant.amount):
                raise Conflict(
                    "Existing grant identity/amount requires a ledger correction"
                )
            for key in ("granted_on", "expires_on", "unit"):
                if grant_row.payload[key] != grant.model_dump(mode="json")[key]:
                    raise Conflict(
                        "Existing grant validity/unit requires a ledger correction"
                    )
            if (grant_row.consumed, grant_row.reserved) != (
                grant.consumed,
                grant.reserved,
            ):
                raise Conflict(
                    "Leave balances must be refreshed before registering input"
                )
    row = PlanningInput(
        input_hash=snapshot.input_hash,
        scope_id=scope_id,
        input_revision=expected_revision + 1,
        data_revision=data_revision,
        payload=snapshot.model_dump(mode="json"),
        created_by=actor,
    )
    session.add(row)
    session.flush()
    session.merge(
        PlanningInputHead(
            key=content_hash([scope_id, period_key(snapshot)]),
            scope_id=scope_id,
            input_hash=row.input_hash,
        )
    )
    session.flush()
    emit(
        session,
        scope_id,
        actor,
        "input.register",
        {"input_hash": row.input_hash, "revision": row.input_revision},
    )
    return {"input_hash": row.input_hash, "input_revision": row.input_revision}


def enqueue(
    session: Session,
    input_hash: str,
    scope_id: str,
    actor: str,
    key: str,
    budget: int,
    *,
    seed: int = 0,
) -> PlanningJob:
    row, snapshot = checked_input(session, input_hash, scope_id)
    if not _current_input_head(session, row, snapshot):
        raise Conflict("Input is stale")
    require_published_context(session, snapshot)
    request_key = content_hash([scope_id, actor, key])
    existing = session.scalar(
        select(PlanningJob).where(PlanningJob.request_key == request_key)
    )
    if existing:
        if (
            existing.input_hash != input_hash
            or existing.budget_seconds != budget
            or requested_seed(existing) != seed
        ):
            raise Conflict("Idempotency key reused for a different request")
        return existing
    job = PlanningJob(
        job_id=uuid4().hex,
        input_hash=input_hash,
        requested_by=actor,
        request_key=request_key,
        budget_seconds=budget,
        status="QUEUED",
        # Only a non-default seed is recorded, so default jobs stay exactly as before.
        result={"requested_random_seed": seed} if seed else None,
    )
    session.add(job)
    emit(
        session,
        scope_id,
        actor,
        "job.enqueue",
        {"job_id": job.job_id, "input_hash": input_hash},
    )
    return job


def requested_seed(job: PlanningJob) -> int:
    """The seed a job was queued with (0 unless recorded when it was queued). Every writer
    of the result keeps `requested_random_seed`, so a resend with the same key is
    recognised whatever the outcome (finished, unknown or refused)."""
    result = job.result or {}
    return int(result.get("requested_random_seed", result.get("random_seed", 0)))


def _with_seed(job: PlanningJob, result: dict[str, Any]) -> dict[str, Any]:
    seed = requested_seed(job)
    return {**result, "requested_random_seed": seed} if seed else result


def claim_job(session: Session) -> tuple[str, str, SolverSnapshot, int] | None:
    from shift_scheduler.db.compliance_models import RestoreGate

    gate = session.get(RestoreGate, "restore")
    if gate and gate.state != "REPLAYED":
        return None
    now = datetime.now(UTC)
    # Row by row (not one bulk update) so each keeps the seed it was queued with.
    for expired in session.scalars(
        select(PlanningJob)
        .where(
            PlanningJob.status == "RUNNING",
            PlanningJob.lease_until < now,
            PlanningJob.attempts >= 3,
        )
        .with_for_update(skip_locked=True)
    ):
        unknown = {
            "status": "UNKNOWN",
            "diagnostics": ["Worker retry limit reached; submit a new reviewed job"],
        }
        expired.result = _with_seed(expired, unknown)
        expired.status = "UNKNOWN"
        expired.lease_token = None
        expired.lease_until = None
    session.flush()
    eligible = or_(
        PlanningJob.status == "QUEUED",
        (PlanningJob.status == "RUNNING") & (PlanningJob.lease_until < now),
    )
    job = session.scalar(
        select(PlanningJob)
        .where(eligible)
        .order_by(PlanningJob.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if job is None:
        return None
    token = uuid4().hex
    changed = session.execute(
        update(PlanningJob)
        .where(PlanningJob.job_id == job.job_id, eligible)
        .values(
            status="RUNNING",
            lease_token=token,
            attempts=PlanningJob.attempts + 1,
            lease_until=now + timedelta(seconds=job.budget_seconds + 30),
            claimed_at=now,
        )
    )
    if getattr(changed, "rowcount", 0) != 1:
        return None
    row = session.get(PlanningInput, job.input_hash)
    assert row is not None
    return (
        job.job_id,
        token,
        parse_snapshot(row.payload),
        job.budget_seconds,
    )


def new_draft(
    session: Session, row: PlanningInput, proposal: Proposal, actor: str
) -> PlanningDraft:
    draft = PlanningDraft(
        draft_id=uuid4().hex,
        input_hash=row.input_hash,
        version=1,
        proposal=proposal.model_dump(mode="json"),
        created_by=actor,
        status="DRAFT",
    )
    session.add(draft)
    emit(session, row.scope_id, actor, "draft.create", {"draft_id": draft.draft_id})
    return draft


def finish_job(
    session: Session, job_id: str, token: str, result: SolveResult
) -> str | None:
    job = session.get(PlanningJob, job_id)
    if job is None:
        raise LookupError("Job not found")
    if result.input_hash != job.input_hash:
        result = SolveResult(
            status="MODEL_INVALID",
            input_hash=job.input_hash,
            rule_revision=result.rule_revision,
            solver_version=result.solver_version,
            diagnostics=("Worker input hash differs from stored immutable input",),
        )
    changed = session.execute(
        update(PlanningJob)
        .where(
            PlanningJob.job_id == job_id,
            PlanningJob.status == "RUNNING",
            PlanningJob.lease_token == token,
        )
        .values(
            status=result.status,
            result=_with_seed(job, result.model_dump(mode="json")),
            lease_token=None,
            lease_until=None,
            completed_at=datetime.now(UTC),
            stage_seconds=result.stage_seconds,
        )
    )
    if getattr(changed, "rowcount", 0) != 1:
        return (
            None  # cancelled or claimed by another worker; result must not be published
        )
    row = session.get(PlanningInput, job.input_hash)
    assert row is not None
    if result.proposal is None:
        return None
    draft = new_draft(session, row, result.proposal, job.requested_by)
    job.result = _with_seed(
        job, {**result.model_dump(mode="json"), "draft_id": draft.draft_id}
    )
    return draft.draft_id


def require_draft(
    session: Session, draft_id: str, scope_id: str
) -> tuple[PlanningDraft, PlanningInput]:
    draft = session.get(PlanningDraft, draft_id)
    if draft is None:
        raise LookupError("Draft not found")
    return draft, require_input(session, draft.input_hash, scope_id)


def edit_draft(
    session: Session,
    draft_id: str,
    scope_id: str,
    proposal: Proposal,
    version: int,
    actor: str,
) -> PlanningDraft:
    draft, _ = require_draft(session, draft_id, scope_id)
    changed = session.execute(
        update(PlanningDraft)
        .where(
            PlanningDraft.draft_id == draft_id,
            PlanningDraft.version == version,
            PlanningDraft.status == "DRAFT",
        )
        .values(
            proposal=proposal.model_dump(mode="json"),
            version=version + 1,
            validation=None,
            reviewed_hash=None,
            reviewed_by=None,
        )
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Draft changed or is already published")
    emit(
        session,
        scope_id,
        actor,
        "draft.edit",
        {"draft_id": draft_id, "version": version + 1},
    )
    session.refresh(draft)
    return draft


def review_draft(
    session: Session, draft_id: str, scope_id: str, version: int, actor: str
) -> dict[str, Any]:
    draft, row = require_draft(session, draft_id, scope_id)
    scope = session.get(PlanningScope, scope_id)
    if not scope or not input_is_current(session, row):
        raise Conflict("Input changed; rebuild and review a new draft")
    snapshot = parse_snapshot(row.payload)
    proposal = Proposal.model_validate(draft.proposal)
    require_published_context(session, snapshot)
    report = validate(snapshot, proposal)
    token = (
        content_hash([row.input_hash, version, report.proposal_hash])
        if report.publishable
        else None
    )
    changed = session.execute(
        update(PlanningDraft)
        .where(
            PlanningDraft.draft_id == draft_id,
            PlanningDraft.version == version,
            PlanningDraft.status == "DRAFT",
        )
        .values(
            validation=report.model_dump(mode="json"),
            reviewed_hash=token,
            reviewed_by=actor if token else None,
        )
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Draft changed during review")
    emit(
        session,
        scope_id,
        actor,
        "draft.review",
        {"draft_id": draft_id, "publishable": report.publishable, "review_hash": token},
    )
    session.refresh(draft)
    return {
        **report.model_dump(mode="json"),
        "publishable": report.publishable,
        "review_hash": token,
    }


def lock_facility(session: Session, scope_id: str) -> None:
    list(
        session.scalars(
            select(PlanningScope)
            .where(PlanningScope.scope_id.startswith(scope_id.split("/")[0] + "/"))
            .order_by(PlanningScope.scope_id)
            .with_for_update()
        )
    )


def publish(
    session: Session,
    draft_id: str,
    scope_id: str,
    actor: str,
    version: int,
    expected_publication_version: int,
    input_hash: str,
    review_hash: str,
    key: str,
) -> dict[str, Any]:
    lock_facility(session, scope_id)
    receipt_id = content_hash([scope_id, actor, key])
    fingerprint = content_hash(
        [draft_id, version, expected_publication_version, input_hash, review_hash]
    )
    receipt = session.get(PlanningReceipt, receipt_id)
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise Conflict("Idempotency key reused for different publication")
        return receipt.response
    draft, row = require_draft(session, draft_id, scope_id)
    scope = session.scalar(
        select(PlanningScope)
        .where(PlanningScope.scope_id == scope_id)
        .with_for_update()
    )
    if (
        scope is None
        or not input_is_current(session, row)
        or input_hash != row.input_hash
    ):
        raise Conflict("Input revision is stale")
    if (
        draft.version != version
        or draft.status != "DRAFT"
        or draft.reviewed_hash != review_hash
        or not draft.reviewed_by
    ):
        raise Conflict("Review does not refer to the current draft")
    snapshot = parse_snapshot(row.payload)
    proposal = Proposal.model_validate(draft.proposal)
    require_published_context(session, snapshot)
    report = validate(snapshot, proposal)
    if not report.publishable:
        raise Blocked("Independent validation failed")
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

    if isinstance(snapshot, SolverSnapshotV3):
        from shift_scheduler.application.rule_impact import publication_findings

        stale = publication_findings(session, scope_id, snapshot)
        if stale:
            raise Blocked("; ".join(stale))
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.application.compliance import register_snapshot
        from shift_scheduler.db.compliance_models import ComplianceEntity

        list(
            session.scalars(
                select(ComplianceEntity)
                .where(
                    ComplianceEntity.kind == "leave_account",
                    ComplianceEntity.entity_id.in_(
                        [a.account_id for a in snapshot.leave_accounts]
                    ),
                )
                .order_by(ComplianceEntity.key)
                .with_for_update()
            )
        )
        register_snapshot(session, snapshot, actor, reserve=True)
    locked = session.execute(
        update(PlanningDraft)
        .where(
            PlanningDraft.draft_id == draft_id,
            PlanningDraft.version == version,
            PlanningDraft.status == "DRAFT",
            PlanningDraft.reviewed_hash == review_hash,
        )
        .values(status="PUBLISHED")
    )
    if getattr(locked, "rowcount", 0) != 1:
        raise Conflict("Draft changed during publication")
    period = period_key(snapshot)
    head_key = content_hash([scope_id, period])
    head = session.get(PlanningHead, head_key)
    if head is None:
        head = PlanningHead(key=head_key, version=0)
        session.add(head)
        session.flush()
    previous = (
        session.get(PlanningPublication, head.publication_id)
        if head.publication_id
        else None
    )
    if snapshot.replaces_publication_id and (
        not previous or snapshot.replaces_publication_id != previous.publication_id
    ):
        raise Conflict("Replacement reservation reference is stale")
    changed = session.execute(
        update(PlanningHead)
        .where(
            PlanningHead.key == head_key,
            PlanningHead.version == expected_publication_version,
        )
        .values(version=expected_publication_version + 1)
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Published version changed concurrently")
    release: dict[str, int] = defaultdict(int)
    if previous:
        if settled_amount(session, previous.publication_id):
            raise Conflict("Published leave was settled; reconcile before replacement")
        for a in previous.payload["leave_allocations"]:
            release[a["grant_id"]] += a["amount"]
    reserve: dict[str, int] = defaultdict(int)
    for a in snapshot.leaves:
        reserve[a.grant_id] += a.amount
    publication_id = uuid4().hex
    for grant_id in sorted(set(release) | set(reserve)):
        balance = session.scalar(
            select(LeaveBalance)
            .where(LeaveBalance.grant_id == grant_id)
            .with_for_update()
        )
        if balance is None:
            raise Conflict("Missing authoritative leave grant")
        delta = reserve[grant_id] - release[grant_id]
        result = session.execute(
            update(LeaveBalance)
            .where(
                LeaveBalance.grant_id == grant_id,
                LeaveBalance.revision == balance.revision,
                LeaveBalance.reserved + delta >= 0,
                LeaveBalance.consumed + LeaveBalance.reserved + delta
                <= LeaveBalance.amount,
            )
            .values(
                reserved=LeaveBalance.reserved + delta,
                revision=LeaveBalance.revision + 1,
            )
        )
        if getattr(result, "rowcount", 0) != 1:
            raise Conflict("Leave balance changed or is insufficient")
    assignments = [
        d.model_dump(mode="json")
        for d in snapshot.candidates
        if d.duty_id in proposal.duty_ids and d.start < snapshot.period.end
    ]
    from shift_scheduler.application.publication_history import actualized

    carried = actualized(session, snapshot, previous) if previous else {}
    if set(carried) & {d["duty_id"] for d in assignments}:
        raise Conflict("Actual-linked planned duties cannot be scheduled again")
    if previous:
        assignments += [
            d for d in previous.payload["assignments"] if d["duty_id"] in carried
        ]
    payload: dict[str, Any] = {
        "input_hash": input_hash,
        "rule_revision": snapshot.rule_revision,
        "proposal": draft.proposal,
        "assignments": assignments,
        "leave_allocations": [a.model_dump(mode="json") for a in snapshot.leaves],
        "validation": report.model_dump(mode="json"),
        "reviewed_by": draft.reviewed_by,
        "replaces": previous.publication_id if previous else None,
    }
    if carried:
        payload["carried_assignments"] = list(carried.values())
    if isinstance(snapshot, SolverSnapshotV2):
        account_people = {a.account_id: a.person_id for a in snapshot.leave_accounts}
        payload["leave_reservation_ids"] = [
            e.event_id
            for e in snapshot.leave_records
            if e.kind == "reserve"
            and e.interval
            and snapshot.period.overlaps(e.interval)
        ]
        payload["leave_person_ids"] = sorted(
            {
                account_people[e.account_id]
                for e in snapshot.leave_records
                if e.event_id in payload["leave_reservation_ids"]
            }
        )
    publication = PlanningPublication(
        publication_id=publication_id,
        draft_id=draft_id,
        scope_id=scope_id,
        period_key=period,
        version=expected_publication_version + 1,
        payload=payload,
        published_by=actor,
    )
    session.add(publication)
    session.flush()
    for grant_id in sorted(set(release) | set(reserve)):
        for kind, amount in (
            ("release", release[grant_id]),
            ("reserve", reserve[grant_id]),
        ):
            if amount:
                session.add(
                    LeaveEvent(
                        event_id=uuid4().hex,
                        grant_id=grant_id,
                        publication_id=publication_id,
                        kind=kind,
                        amount=amount,
                        actor=actor,
                    )
                )
    head.publication_id = publication_id
    draft.status = "PUBLISHED"
    response = {
        "publication_id": publication_id,
        "version": publication.version,
        "input_hash": input_hash,
    }
    session.add(
        PlanningReceipt(
            receipt_id=receipt_id, fingerprint=fingerprint, response=response
        )
    )
    emit(
        session,
        scope_id,
        actor,
        "schedule.published",
        {
            **response,
            "person_ids": sorted(
                {d["person_id"] for d in assignments}
                | {a.person_id for a in snapshot.leaves}
            ),
        },
    )
    return response


def import_actual(
    session: Session,
    scope_id: str,
    actor: str,
    external_id: str,
    revision: int,
    duty: Duty,
    *,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    lock_facility(session, scope_id)
    if duty.source not in ("actual", "external"):
        raise ValueError(
            "Actual import must identify actual or externally reported work"
        )
    key = content_hash([scope_id, external_id, revision])
    payload = duty.model_dump(mode="json")
    existing = session.get(ActualWorkEvent, key)
    if existing:
        if existing.payload != payload:
            raise Conflict("External revision reused with different contents")
        return {"event_id": key, "duplicate": True}
    latest = session.scalar(
        select(ActualWorkEvent)
        .where(
            ActualWorkEvent.scope_id == scope_id,
            ActualWorkEvent.external_id == external_id,
        )
        .order_by(ActualWorkEvent.revision.desc())
        .limit(1)
    )
    expected = revision - 1 if expected_revision is None else expected_revision
    if (latest.revision if latest else 0) != expected or revision != expected + 1:
        raise Conflict(
            "Actual revision must immediately follow the current reviewed revision"
        )
    session.add(
        ActualWorkEvent(
            key=key,
            scope_id=scope_id,
            external_id=external_id,
            revision=revision,
            payload=payload,
        )
    )
    session.execute(
        update(PlanningScope)
        .where(PlanningScope.scope_id == scope_id)
        .values(
            input_revision=PlanningScope.input_revision + 1,
            data_revision=PlanningScope.data_revision + 1,
        )
    )
    emit(
        session,
        scope_id,
        actor,
        "actual.corrected",
        {"event_id": key, "person_id": duty.person_id, "revalidation_required": True},
    )
    return {"event_id": key, "duplicate": False}


def cancel_publication(
    session: Session,
    publication_id: str,
    scope_id: str,
    actor: str,
    expected_version: int,
    reason: str,
) -> dict[str, Any]:
    session.scalar(
        select(PlanningScope)
        .where(PlanningScope.scope_id == scope_id)
        .with_for_update()
    )
    if not reason.strip():
        raise ValueError("Cancellation reason is required")
    publication = session.get(PlanningPublication, publication_id)
    if publication is None or publication.scope_id != scope_id:
        raise LookupError("Publication not found")
    if publication.payload.get("leave_reservation_ids"):
        from shift_scheduler.application.compliance import cancel_publication_leave

        cancel_publication_leave(session, scope_id, publication, actor)
    if settled_amount(session, publication_id):
        raise Conflict("Published leave was settled; reconcile before cancellation")
    head_key = content_hash([scope_id, publication.period_key])
    changed = session.execute(
        update(PlanningHead)
        .where(
            PlanningHead.key == head_key,
            PlanningHead.publication_id == publication_id,
            PlanningHead.version == expected_version,
        )
        .values(publication_id=None, version=expected_version + 1)
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Only the current publication can be cancelled")
    amounts: dict[str, int] = defaultdict(int)
    for a in publication.payload["leave_allocations"]:
        amounts[a["grant_id"]] += a["amount"]
    for grant_id, amount in sorted(amounts.items()):
        changed = session.execute(
            update(LeaveBalance)
            .where(LeaveBalance.grant_id == grant_id, LeaveBalance.reserved >= amount)
            .values(
                reserved=LeaveBalance.reserved - amount,
                revision=LeaveBalance.revision + 1,
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise Conflict(
                "Leave was already settled; reconcile actuals before cancellation"
            )
        session.add(
            LeaveEvent(
                event_id=uuid4().hex,
                grant_id=grant_id,
                publication_id=publication_id,
                kind="release",
                amount=amount,
                actor=actor,
            )
        )
    emit(
        session,
        scope_id,
        actor,
        "schedule.cancelled",
        {
            "publication_id": publication_id,
            "reason": reason,
            "version": expected_version + 1,
            "person_ids": sorted(
                {a["person_id"] for a in publication.payload["assignments"]}
                | {a["person_id"] for a in publication.payload["leave_allocations"]}
            ),
        },
    )
    return {"cancelled": True, "version": expected_version + 1}


def settle_leave(
    session: Session,
    scope_id: str,
    actor: str,
    grant_id: str,
    event_id: str,
    kind: str,
    amount: int,
    expected_revision: int,
    publication_id: str,
) -> dict[str, Any]:
    session.scalar(
        select(PlanningScope)
        .where(PlanningScope.scope_id == scope_id)
        .with_for_update()
    )
    if amount <= 0 or kind not in ("consume", "reverse"):
        raise ValueError("Positive amount and consume/reverse operation required")
    balance = session.get(LeaveBalance, grant_id)
    if balance is None:
        raise LookupError("Grant not found")
    existing = session.get(LeaveEvent, event_id)
    if existing:
        if (
            existing.grant_id,
            existing.kind,
            existing.amount,
            existing.publication_id,
        ) != (
            grant_id,
            kind,
            amount,
            publication_id,
        ):
            raise Conflict("Leave event ID reused for a different operation")
        return {"event_id": event_id, "duplicate": True}
    publication = session.get(PlanningPublication, publication_id)
    if publication is None or publication.scope_id != scope_id:
        raise LookupError("Publication not found in scope")
    head = session.get(PlanningHead, content_hash([scope_id, publication.period_key]))
    if head is None or head.publication_id != publication_id:
        raise Conflict("Settlement requires current publication")
    allocated = sum(
        a["amount"]
        for a in publication.payload["leave_allocations"]
        if a["grant_id"] == grant_id
    )
    delta = amount if kind == "consume" else -amount
    net = settled_amount(session, publication_id, grant_id)
    if not 0 <= net + delta <= allocated:
        raise Conflict("Settlement exceeds this publication's leave allocation")
    result = session.execute(
        update(LeaveBalance)
        .where(
            LeaveBalance.grant_id == grant_id,
            LeaveBalance.revision == expected_revision,
            LeaveBalance.reserved - delta >= 0,
            LeaveBalance.consumed + delta >= 0,
        )
        .values(
            reserved=LeaveBalance.reserved - delta,
            consumed=LeaveBalance.consumed + delta,
            revision=LeaveBalance.revision + 1,
        )
    )
    if getattr(result, "rowcount", 0) != 1:
        raise Conflict("Leave settlement conflicts with ledger state")
    session.add(
        LeaveEvent(
            event_id=event_id,
            grant_id=grant_id,
            kind=kind,
            amount=amount,
            actor=actor,
            publication_id=publication_id,
        )
    )
    session.execute(
        update(PlanningScope)
        .where(PlanningScope.scope_id == scope_id)
        .values(
            input_revision=PlanningScope.input_revision + 1,
            data_revision=PlanningScope.data_revision + 1,
        )
    )
    emit(
        session,
        scope_id,
        actor,
        "leave.settled",
        {"event_id": event_id, "grant_id": grant_id, "kind": kind, "amount": amount},
    )
    return {"event_id": event_id, "duplicate": False, "revision": expected_revision + 1}


def settled_amount(
    session: Session, publication_id: str, grant_id: str | None = None
) -> int:
    statement = select(LeaveEvent).where(
        LeaveEvent.publication_id == publication_id,
        LeaveEvent.kind.in_(("consume", "reverse")),
    )
    if grant_id:
        statement = statement.where(LeaveEvent.grant_id == grant_id)
    return sum(
        e.amount if e.kind == "consume" else -e.amount
        for e in session.scalars(statement)
    )


def refresh_input(
    session: Session,
    scope_id: str,
    actor: str,
    expected_revision: int,
    input_hash: str | None = None,
) -> dict[str, Any]:
    """Materialize current requests, leave balances and actual corrections into a new immutable input."""
    from shift_scheduler.db.planning_models import PlanningRequest
    from shift_scheduler.domain.planning import (
        Evidence,
        Interval,
        LeaveAllocation,
        LeaveGrant,
        Preference,
    )

    statement = (
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if input_hash:
        statement = select(PlanningInput).where(
            PlanningInput.scope_id == scope_id, PlanningInput.input_hash == input_hash
        )
    row = session.scalar(statement)
    if row is None:
        raise LookupError("No input to refresh")
    snapshot = parse_snapshot(row.payload)
    scope = session.get(PlanningScope, scope_id)
    if scope is None or scope.input_revision != expected_revision:
        raise Conflict("Input changed before refresh")
    requests = session.scalars(
        select(PlanningRequest).where(
            PlanningRequest.scope_id == scope_id, PlanningRequest.status != "CANCELLED"
        )
    ).all()
    preferences = [p for p in snapshot.preferences if p.request_id is None]
    unresolved = []
    typed_leave_requests = []
    leaves = [a for a in snapshot.leaves if not a.allocation_id.startswith("request-")]
    for r in requests:
        span = Interval.model_validate({k: r.payload[k] for k in ("start", "end")})
        if not snapshot.period.overlaps(span):
            continue
        if r.kind == "PAID_LEAVE_V2":
            if not isinstance(snapshot, SolverSnapshotV2):
                unresolved.append(r.request_id)
            elif r.status == "APPROVED":
                from shift_scheduler.domain.compliance import LeaveRecord

                typed_leave_requests.append(
                    LeaveRecord.model_validate(
                        {
                            "event_id": "request-" + r.request_id,
                            "account_id": r.payload["account_id"],
                            "policy_id": r.payload["policy_id"],
                            "kind": "reserve",
                            "unit": r.payload["unit"],
                            "quantity": r.payload["quantity"],
                            "effective_on": span.start.astimezone(
                                ZoneInfo("Asia/Tokyo")
                            )
                            .date()
                            .isoformat(),
                            "interval": span.model_dump(mode="json"),
                            "evidence": r.decision,
                        }
                    )
                )
            else:
                unresolved.append(r.request_id)
            continue
        if r.kind == "PUBLIC_HOLIDAY_REQUEST":
            preferences.append(
                Preference(
                    person_id=r.person_id,
                    request_id=r.request_id,
                    start=span.start,
                    end=span.end,
                    rank=r.payload["rank"],
                )
            )
        elif r.status == "APPROVED":
            leaves.append(
                LeaveAllocation(
                    allocation_id="request-" + r.request_id,
                    grant_id=r.payload["grant_id"],
                    person_id=r.person_id,
                    start=span.start,
                    end=span.end,
                    amount=r.payload["amount"],
                    decision=Evidence.model_validate(r.decision),
                )
            )
        elif r.kind == "PAID_LEAVE_REQUEST":
            unresolved.append(r.request_id)
    actuals = session.scalars(
        select(ActualWorkEvent)
        .where(ActualWorkEvent.scope_id == scope_id)
        .order_by(ActualWorkEvent.revision)
    ).all()
    latest = {r.external_id: r for r in actuals}
    replaced_ids = {r.payload["duty_id"] for r in actuals}
    history_by_id = {
        d.duty_id: d
        for d in snapshot.history
        if d.duty_id not in replaced_ids and not d.duty_id.startswith("publication:")
    }
    replaced_planned_ids: set[str] = set()
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.db.compliance_models import ComplianceEntity
        from shift_scheduler.domain.compliance import WorkTerms

        terms_by_id = {t.duty_id: t for t in snapshot.work_terms}
        actual_ids = {r.payload["duty_id"] for r in latest.values()}
        for record in session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id == scope_id,
                ComplianceEntity.kind == "work_terms",
                ComplianceEntity.entity_id.in_(actual_ids),
            )
        ):
            term = WorkTerms.model_validate(record.payload)
            terms_by_id[term.duty_id] = term
            if term.planned_duty_id:
                parent = session.get(PlanningPublication, term.planned_publication_id)
                if (
                    parent
                    and parent.scope_id == scope_id
                    and parent.period_key == period_key(snapshot)
                ):
                    replaced_planned_ids.add(term.planned_duty_id)
        snapshot = snapshot.model_copy(
            update={"work_terms": tuple(terms_by_id.values())}
        )
        history_by_id = {
            i: d for i, d in history_by_id.items() if i not in replaced_planned_ids
        }
    for actual in latest.values():
        duty = Duty.model_validate(actual.payload)
        if snapshot.context.contains(duty):
            history_by_id[duty.duty_id] = duty
    # Context reconciliation must see the newly imported actuals, not only the
    # preceding input's history, or their old plans are counted a second time.
    snapshot = snapshot.model_copy(update={"history": tuple(history_by_id.values())})
    published, previous_duties = published_context(session, snapshot)
    history_by_id.update(published)
    grants = []
    for g in snapshot.grants:
        balance = session.get(LeaveBalance, g.grant_id)
        if balance is None:
            raise Conflict("Missing authoritative grant")
        grants.append(
            LeaveGrant.model_validate(
                {
                    **g.model_dump(mode="json"),
                    "consumed": balance.consumed,
                    "reserved": balance.reserved,
                }
            )
        )
    publication_head = session.get(
        PlanningHead, content_hash([scope_id, period_key(snapshot)])
    )
    previous = (
        session.get(PlanningPublication, publication_head.publication_id)
        if publication_head and publication_head.publication_id
        else None
    )
    candidates = {
        d.duty_id: d
        for d in snapshot.candidates
        if d.duty_id not in history_by_id and d.duty_id not in replaced_planned_ids
    }
    for identity, duty in previous_duties.items():
        if identity not in history_by_id:
            # Preserve the immutable old option even if it is no longer eligible;
            # the solver can remove it, but must account for the change.
            candidates[identity] = duty
    refreshed_payload = {
        **snapshot.model_dump(mode="json"),
        "unresolved_requests": unresolved,
        "source_revision": expected_revision + 1,
        "replaces_publication_id": previous.publication_id if previous else None,
        "reservation_credits": (
            previous.payload["leave_allocations"] if previous else []
        ),
        "preferences": [p.model_dump(mode="json") for p in preferences],
        "leaves": [a.model_dump(mode="json") for a in leaves],
        "grants": [g.model_dump(mode="json") for g in grants],
        "history": [d.model_dump(mode="json") for d in history_by_id.values()],
        "candidates": [d.model_dump(mode="json") for d in candidates.values()],
        "previous_duty_ids": [i for i in previous_duties if i not in history_by_id],
    }
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.application.compliance import overlay

        refreshed_payload["leave_records"] = [
            e
            for e in refreshed_payload.get("leave_records", [])
            if not e["event_id"].startswith("request-")
        ] + [e.model_dump(mode="json") for e in typed_leave_requests]
        refreshed_payload = overlay(session, scope_id, refreshed_payload)
        if leaves:
            raise Conflict("V1 leave requests require explicit typed v2 reconciliation")
        terms = {t["duty_id"]: t for t in refreshed_payload["work_terms"]}
        for identity in history_by_id:
            if identity.startswith("publication:") and identity not in terms:
                _, pub_id, original_id = identity.split(":", 2)
                pub = session.get(PlanningPublication, pub_id)
                assert pub is not None
                old_input = session.get(PlanningInput, pub.payload["input_hash"])
                if not old_input or old_input.payload.get("schema_version") not in {
                    2,
                    3,
                }:
                    raise Conflict(
                        "Published v1 duty requires explicit work classification; no inferred conversion"
                    )
                original_term = next(
                    t
                    for t in old_input.payload["work_terms"]
                    if t["duty_id"] == original_id
                )
                terms[identity] = {**original_term, "duty_id": identity}
                for collection, field in (
                    ("employments", "revision_id"),
                    ("agreements", "agreement_id"),
                ):
                    values = {v[field]: v for v in refreshed_payload[collection]}
                    for v in old_input.payload[collection]:
                        values.setdefault(v[field], v)
                    refreshed_payload[collection] = list(values.values())
        identities = set(history_by_id) | set(candidates)
        if any(identity not in terms for identity in identities):
            raise Conflict(
                "Actual or published duty lacks explicit work classification"
            )
        refreshed_payload["work_terms"] = [terms[i] for i in sorted(identities)]
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

    if isinstance(snapshot, SolverSnapshotV3):
        from shift_scheduler.application.burden_history import rebuild

        refreshed_payload["burden_history"] = [
            r.model_dump(mode="json") for r in rebuild(session, snapshot)
        ]
        # The caller must still supply verified completeness/initial-history evidence.
    refreshed = parse_snapshot(refreshed_payload)
    return register_input(session, refreshed, actor, expected_revision)


def input_is_current(session: Session, row: PlanningInput) -> bool:
    snapshot = parse_snapshot(row.payload)
    if (
        content_hash(row.payload) != row.input_hash
        or snapshot.input_hash != row.input_hash
    ):
        return False
    return _current_input_head(session, row, snapshot)


def _current_input_head(
    session: Session, row: PlanningInput, snapshot: SolverSnapshot
) -> bool:
    """Call only with integrity-checked input from this transaction."""
    scope = session.get(PlanningScope, row.scope_id)
    head = session.get(
        PlanningInputHead, content_hash([row.scope_id, period_key(snapshot)])
    )
    return bool(
        scope
        and head
        and head.input_hash == row.input_hash
        and row.data_revision == scope.data_revision
    )


def require_unpublished_request(
    session: Session, scope_id: str, request_id: str
) -> None:
    identity = "request-" + request_id
    current = session.scalars(
        select(PlanningPublication)
        .join(
            PlanningHead,
            PlanningHead.publication_id == PlanningPublication.publication_id,
        )
        .where(PlanningPublication.scope_id == scope_id)
    )
    for publication in current:
        if identity in publication.payload.get("leave_reservation_ids", []) or any(
            item["allocation_id"] == identity
            for item in publication.payload.get("leave_allocations", [])
        ):
            raise Conflict(
                "Published leave requires publication cancellation/correction before changing the request"
            )
