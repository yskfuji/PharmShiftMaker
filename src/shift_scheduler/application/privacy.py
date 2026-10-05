"""Reviewed erasure of closed planning bundles with transaction-time rechecks."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from shift_scheduler.application.planning import Conflict, emit, lock_facility
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    CopySubject,
    ErasureMarker,
    ErasurePlan,
    LegalHold,
    ManagedCopy,
    PrivacyCase,
    RetentionRule,
)
from shift_scheduler.db.planning_models import (
    AccountMembership,
    LeaveEvent,
    NotificationRead,
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
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import (
    PrivacyDecision,
    PrivacyRequest,
    RetentionPolicy,
)
from shift_scheduler.validation.work_accounting import verified

BUNDLE_MODELS = (
    NotificationRead,
    LeaveEvent,
    PlanningReceipt,
    PlanningOutbox,
    PlanningJob,
    PlanningPublication,
    PlanningDraft,
    PlanningInput,
)


def scoped_people(session: Session, scope: str) -> set[str]:
    """Return people for whom this exact scope holds an attributable record.

    A privacy request must remain possible after a person leaves the current roster.
    Conversely, a person known only to another scope must not become enumerable here.
    The copy ledger and typed rows are therefore authoritative for this purpose; the
    current planning input is only one of the contributing sources.
    """
    people = set(
        session.scalars(
            select(AccountMembership.person_id).where(
                AccountMembership.scope_id == scope
            )
        )
    )
    people.update(
        person_id
        for person_id in session.scalars(
            select(ComplianceEntity.person_id).where(
                ComplianceEntity.scope_id == scope,
                ComplianceEntity.person_id.is_not(None),
            )
        )
        if person_id
    )
    people.update(
        session.scalars(
            select(ComplianceEntity.entity_id).where(
                ComplianceEntity.scope_id == scope,
                ComplianceEntity.kind == "person",
            )
        )
    )
    people.update(
        session.scalars(
            select(CopySubject.person_id)
            .join(ManagedCopy, ManagedCopy.copy_id == CopySubject.copy_id)
            .where(ManagedCopy.scope_id == scope)
        )
    )
    input_hashes = session.scalars(
        select(PlanningInputHead.input_hash).where(PlanningInputHead.scope_id == scope)
    ).all()
    for input_hash in input_hashes:
        row = session.get(PlanningInput, input_hash)
        if row:
            people.update(
                person["person_id"]
                for person in row.payload.get("people", [])
                if person.get("person_id")
            )
    return people


def scoped_person_names(session: Session, scope: str) -> dict[str, str]:
    """Return privacy subjects with current labels where those labels are known."""
    people = scoped_people(session, scope)
    names: dict[str, str] = {}
    inputs = session.scalars(
        select(PlanningInput)
        .join(
            PlanningInputHead,
            PlanningInputHead.input_hash == PlanningInput.input_hash,
        )
        .where(PlanningInputHead.scope_id == scope)
        .order_by(
            PlanningInput.input_revision.desc(),
            PlanningInput.created_at.desc(),
            PlanningInput.input_hash.desc(),
        )
    ).all()
    for row in inputs:
        for person in row.payload.get("people", []):
            person_id = str(person.get("person_id", ""))
            if person_id in people and person.get("name") and person_id not in names:
                names[person_id] = str(person["name"])
    for entity in session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.scope_id == scope,
            ComplianceEntity.kind == "person",
        )
    ):
        if entity.entity_id in people and entity.payload.get("name"):
            names[entity.entity_id] = str(entity.payload["name"])
    return {
        person_id: names.get(person_id, "職員（氏名未照合）")
        for person_id in sorted(people)
    }


def applicable_rule(
    session: Session, scope: str, category: str, anchor: str
) -> RetentionRule | None:
    """Latest revision of the (scope, category, anchor) rule chain, or None.

    One category can hold rows with different retention anchors (for example
    planning inputs start at their period end). Each anchor has its own chain;
    a rule for one anchor never governs rows counted from another.
    """
    rules = session.scalars(
        select(RetentionRule)
        .where(RetentionRule.scope_id == scope, RetentionRule.category == category)
        .order_by(RetentionRule.revision.desc())
    )
    return next((r for r in rules if r.payload.get("anchor") == anchor), None)


def rule_categories(session: Session) -> set[tuple[str, str]]:
    """(scope, category) pairs that have a rule chain for at least one anchor."""
    return set(
        session.execute(
            select(RetentionRule.scope_id, RetentionRule.category).distinct()
        ).tuples()
    )


def save_rule(
    session: Session, scope: str, policy: RetentionPolicy, revision: int, actor: str
) -> dict[str, Any]:
    from shift_scheduler.control.transaction import stage_control

    stage_control(session)
    if session.get_bind().dialect.name == "postgresql":
        # Serialize revisions of one category so the key choice below is stable.
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": "retention-rule:" + scope + ":" + policy.category},
        )
    if (
        policy.retention_days < policy.legal_minimum_days
        or policy.effective_from >= policy.effective_until
    ):
        raise ValueError("Retention cannot shorten the verified legal minimum")
    latest = applicable_rule(session, scope, policy.category, policy.anchor)
    if (latest.revision if latest else 0) != revision:
        raise Conflict("Retention rule revision changed")
    # Keys are identifiers only. Keep the original form while it is free and
    # qualify by anchor when another anchor's chain already holds that revision.
    key = content_hash([scope, policy.category, revision + 1])
    if session.get(RetentionRule, key) is not None:
        key = content_hash([scope, policy.category, policy.anchor, revision + 1])
    session.add(
        RetentionRule(
            key=key,
            scope_id=scope,
            category=policy.category,
            revision=revision + 1,
            payload=policy.model_dump(mode="json"),
        )
    )
    emit(
        session, scope, actor, "retention.rule", {"key": key, "revision": revision + 1}
    )
    return {"key": key, "revision": revision + 1}


def request_case(
    session: Session, scope: str, request: PrivacyRequest, actor: str
) -> PrivacyCase:
    row = PrivacyCase(
        case_id=uuid4().hex,
        scope_id=scope,
        person_id=request.person_id,
        kind=request.kind,
        status="REQUESTED",
        revision=1,
        payload=request.model_dump(mode="json"),
    )
    session.add(row)
    emit(session, scope, actor, "privacy.request", {"case_id": row.case_id})
    return row


# The only table of case transitions: decide_case enforces it and the privacy
# listing shows it (`allowed_next`), so a screen never keeps a copy of its own.
# Statuses without an entry (REJECTED, RELEASED) are terminal.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "REQUESTED": ("VERIFIED", "REJECTED"),
    "VERIFIED": ("APPROVED", "REJECTED"),
    "APPROVED": ("COMPLETED", "RELEASED"),
    "COMPLETED": ("RELEASED",),
}
# Decisions that are refused without an implementation/result reference.
RESULT_REFERENCE_REQUIRED = frozenset({"COMPLETED"})


def next_statuses(status: str) -> tuple[str, ...]:
    """The statuses a decision may move a case in `status` to (none when terminal)."""
    return TRANSITIONS.get(status, ())


def decision_options(status: str, may_decide: bool) -> dict[str, list[str]]:
    """What the listing tells one viewer about the next decision of a case.

    `allowed_next` is empty for a viewer who may not decide. The decision also needs
    verified identity evidence and the current revision; those depend on the request
    and are answered by decide_case itself.
    """
    allowed = list(next_statuses(status)) if may_decide else []
    return {
        "allowed_next": allowed,
        "result_reference_required": [
            target for target in allowed if target in RESULT_REFERENCE_REQUIRED
        ],
    }


def decide_case(
    session: Session, case_id: str, scope: str, decision: PrivacyDecision, actor: str
) -> PrivacyCase:
    from shift_scheduler.control.transaction import stage_control

    stage_control(session)
    row = session.get(PrivacyCase, case_id)
    if not row or row.scope_id != scope:
        raise LookupError("Privacy request not found")
    if decision.status not in next_statuses(row.status) or not verified(
        decision.identity_evidence, datetime.now(UTC)
    ):
        raise ValueError("Decision requires verified identity and a valid transition")
    if decision.status in RESULT_REFERENCE_REQUIRED and not decision.result_reference:
        raise ValueError("Completion requires an implementation/result reference")
    result = session.execute(
        update(PrivacyCase)
        .where(
            PrivacyCase.case_id == case_id,
            PrivacyCase.revision == decision.expected_revision,
        )
        .values(
            revision=decision.expected_revision + 1,
            status=decision.status,
            payload={
                **row.payload,
                "decision": decision.model_dump(mode="json"),
                "decision_history": [
                    *row.payload.get("decision_history", []),
                    decision.model_dump(mode="json"),
                ],
            },
        )
    )
    if getattr(result, "rowcount", 0) != 1:
        raise Conflict("Privacy case changed concurrently")
    emit(
        session,
        scope,
        actor,
        "privacy.decision",
        {"case_id": case_id, "status": decision.status, "reason": decision.reason},
    )
    if row.kind == "restrict" and decision.status in {"APPROVED", "RELEASED"}:
        facility_prefix = scope.split("/")[0] + "/"
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id.startswith(facility_prefix))
            .values(data_revision=PlanningScope.data_revision + 1)
        )
        if decision.status == "APPROVED":
            hashes = select(PlanningInput.input_hash).where(
                PlanningInput.scope_id.startswith(facility_prefix)
            )
            session.execute(
                update(PlanningJob)
                .where(
                    PlanningJob.input_hash.in_(hashes),
                    PlanningJob.status.in_(["QUEUED", "RUNNING"]),
                )
                .values(
                    status="BLOCKED",
                    lease_token=None,
                    lease_until=None,
                    result={
                        "status": "BLOCKED",
                        "diagnostics": [
                            "Approved use restriction; job stopped by facility policy"
                        ],
                    },
                )
            )
    session.refresh(row)
    return row


def restricted_people(session: Session, scope: str) -> set[str]:
    return set(
        session.scalars(
            select(PrivacyCase.person_id).where(
                PrivacyCase.scope_id.startswith(scope.split("/")[0] + "/"),
                PrivacyCase.kind == "restrict",
                PrivacyCase.status.in_(["APPROVED", "COMPLETED"]),
            )
        )
    )


def inventory(
    session: Session, scope: str, input_hash: str, at: datetime
) -> dict[str, Any]:
    row = session.get(PlanningInput, input_hash)
    if not row or row.scope_id != scope:
        raise LookupError("Planning input not found in scope")
    rules = session.scalars(
        select(RetentionRule)
        .where(
            RetentionRule.scope_id == scope,
            RetentionRule.category == "planning_history",
        )
        .order_by(RetentionRule.revision.desc())
    ).all()
    rule = next(
        (
            r
            for r in rules
            if r.payload.get("anchor") == "period_end"
            and r.payload["effective_from"]
            <= at.date().isoformat()
            < r.payload["effective_until"]
        ),
        None,
    )
    blockers = []
    if not rule:
        blockers.append("保存規則が未設定です")
    else:
        policy = RetentionPolicy.model_validate(rule.payload)
        if not verified(policy.evidence, at) or policy.next_review < at.date():
            blockers.append("保存規則の確認・再確認が必要です")
        period_end = datetime.fromisoformat(row.payload["period"]["end"])
        if (
            policy.anchor != "period_end"
            or period_end
            + timedelta(days=max(policy.retention_days, policy.legal_minimum_days))
            > at
        ):
            blockers.append("保存期限未満または起算条件が未対応です")
    if session.scalar(
        select(PlanningInputHead).where(PlanningInputHead.input_hash == input_hash)
    ):
        blockers.append("現行入力として参照されています")
    persons = {p["person_id"] for p in row.payload["people"]}
    for hold in session.scalars(
        select(LegalHold).where(
            LegalHold.scope_id.startswith(scope.split("/")[0] + "/"),
            LegalHold.active.is_(True),
        )
    ):
        if hold.person_id is None or hold.person_id in persons:
            blockers.append("法的保全が有効です: " + hold.hold_id)
    drafts = session.scalars(
        select(PlanningDraft).where(PlanningDraft.input_hash == input_hash)
    ).all()
    draft_ids = [d.draft_id for d in drafts]
    publications = session.scalars(
        select(PlanningPublication).where(PlanningPublication.draft_id.in_(draft_ids))
    ).all()
    pub_ids = [p.publication_id for p in publications]
    if session.scalar(
        select(PlanningHead).where(PlanningHead.publication_id.in_(pub_ids))
    ):
        blockers.append("現行公開版です。正式な保存・参照終了手続が必要です")
    jobs = session.scalars(
        select(PlanningJob).where(PlanningJob.input_hash == input_hash)
    ).all()
    if any(j.status in {"QUEUED", "RUNNING"} for j in jobs):
        blockers.append("生成処理が使用中です")
    references = {input_hash, *draft_ids, *pub_ids, *(j.job_id for j in jobs)}
    outbox = [
        o
        for o in session.scalars(
            select(PlanningOutbox).where(PlanningOutbox.scope_id == scope)
        )
        if _references(o.payload, references)
    ]
    receipts = [
        r
        for r in session.scalars(select(PlanningReceipt))
        if "plan_id" not in r.response and _references(r.response, references)
    ]
    outbox_ids = [o.event_id for o in outbox]
    notifications = session.scalars(
        select(NotificationRead).where(NotificationRead.event_id.in_(outbox_ids))
    ).all()
    leave_events = session.scalars(
        select(LeaveEvent).where(LeaveEvent.publication_id.in_(pub_ids))
    ).all()
    if leave_events:
        blockers.append(
            "休暇台帳が公開版を参照しています。台帳の保存期限照合が必要です"
        )
    objects = [*notifications, *receipts, *outbox, *jobs, *publications, *drafts, row]
    targets = []
    for obj in objects:
        table: Any = obj.__table__
        key = next(iter(table.primary_key.columns)).name
        value = {c.name: _json(getattr(obj, c.name)) for c in table.columns}
        targets.append(
            {
                "table": table.name,
                "key": str(getattr(obj, key)),
                "hash": content_hash(value),
            }
        )
    order = {m.__tablename__: i for i, m in enumerate(BUNDLE_MODELS)}
    targets.sort(key=lambda target: (order[target["table"]], target["key"]))
    return {
        "input_hash": input_hash,
        "scope_id": scope,
        "rule_key": rule.key if rule else None,
        "targets": targets,
        "blockers": sorted(blockers),
        "irreversible": True,
        "limitations": [
            "保全台帳・バックアップ内の識別子は別の保存規則で管理します。",
            "匿名加工情報を生成する操作ではありません。",
        ],
    }


def erasable(listing: dict[str, Any]) -> bool:
    """Whether execute() erases an inventory: only when nothing blocks it.

    The one statement of that rule. execute() enforces it; the preview and the
    listing of candidates show it, so a screen never decides it from the blockers.
    """
    return not listing["blockers"]


def erasure_candidates(
    session: Session, scope: str, at: datetime | None = None
) -> dict[str, Any]:
    """Every planning input of the scope with what inventory() says about it now.

    Superseded versions are listed too: only they can ever be erased, and no other
    read names them. Nothing is recorded; a preview is what creates a plan.
    """
    now = at or datetime.now(UTC)
    rows = session.scalars(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope)
        .order_by(PlanningInput.input_revision.desc(), PlanningInput.input_hash)
    ).all()
    inputs = []
    for row in rows:
        listing = inventory(session, scope, row.input_hash, now)
        inputs.append(
            {
                "input_hash": row.input_hash,
                "input_revision": row.input_revision,
                "period": row.payload["period"],
                "registered_at": _json(row.created_at),
                "erasable": erasable(listing),
                "blockers": listing["blockers"],
                "target_count": len(listing["targets"]),
            }
        )
    return {"observed_at": now.isoformat(), "inputs": inputs}


def _json(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _references(value: Any, refs: set[str]) -> bool:
    from shift_scheduler.application.copy_graph import typed_values

    return any(
        identity in refs
        for _, identity in typed_values(
            value, {"input_hash", "draft_id", "publication_id", "job_id"}
        )
    )


def preview(
    session: Session,
    scope: str,
    input_hash: str,
    actor: str,
    at: datetime | None = None,
) -> ErasurePlan:
    payload = inventory(session, scope, input_hash, at or datetime.now(UTC))
    plan = ErasurePlan(
        plan_id=uuid4().hex,
        scope_id=scope,
        fingerprint=content_hash(payload),
        payload=payload,
        status="PREVIEW",
    )
    session.add(plan)
    emit(
        session,
        scope,
        actor,
        "erasure.preview",
        {"plan_id": plan.plan_id, "blocked": bool(payload["blockers"])},
    )
    return plan


def execute(
    session: Session,
    scope: str,
    plan_id: str,
    fingerprint: str,
    actor: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    from shift_scheduler.control.transaction import stage_control

    stage_control(session)
    lock_facility(session, scope)
    session.scalar(
        select(PlanningScope).where(PlanningScope.scope_id == scope).with_for_update()
    )
    plan = session.get(ErasurePlan, plan_id)
    if not plan or plan.scope_id != scope:
        raise LookupError("Erasure plan not found")
    if fingerprint != plan.fingerprint:
        raise Conflict("Erasure preview fingerprint differs")
    if plan.status == "EXECUTED":
        return {"plan_id": plan_id, "status": "EXECUTED", "duplicate": True}
    current = inventory(
        session, scope, plan.payload["input_hash"], at or datetime.now(UTC)
    )
    if not erasable(current) or content_hash(current) != fingerprint:
        raise Conflict("Erasure targets, rule or legal hold changed; preview again")
    models = {m.__tablename__: m for m in BUNDLE_MODELS}
    for target in current["targets"]:
        obj = session.get(models[target["table"]], target["key"])
        session.add(
            ErasureMarker(
                marker_id=content_hash([plan_id, target["table"], target["key"]]),
                plan_id=plan_id,
                scope_id=scope,
                table_name=target["table"],
                object_key=target["key"],
                prior_hash=target["hash"],
            )
        )
        session.delete(obj)
        session.flush()
    plan.status = "EXECUTED"
    emit(
        session,
        scope,
        actor,
        "erasure.executed",
        {"plan_id": plan_id, "count": len(current["targets"]), "replayable": False},
    )
    return {
        "plan_id": plan_id,
        "status": "EXECUTED",
        "deleted": len(current["targets"]),
        "duplicate": False,
    }
