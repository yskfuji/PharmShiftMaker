"""Approved person controls, distinct from expiration of individual copies.

This operation installs the existing stable-person-ID reintroduction guard. It
never deletes content or asserts all copies erased. Identity alias resolution
and exhaustive storage coverage are separate acceptance obligations.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from shift_scheduler.application import copies
from shift_scheduler.application.planning import Conflict, lock_facility
from shift_scheduler.control.client import AuthorityClient, configured_client
from shift_scheduler.control.transaction import stage_control
from shift_scheduler.db.compliance_models import (
    ErasedSubject,
    LegalHold,
    PrivacyCase,
    RetentionRule,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningReceipt
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.validation.work_accounting import verified


def _authorize(session: Session, scope: str, issuer: str, subject: str) -> None:
    member = session.scalar(
        select(AccountMembership).where(
            AccountMembership.issuer == issuer,
            AccountMembership.subject == subject,
            AccountMembership.scope_id == scope,
            AccountMembership.role == "ADMIN",
            AccountMembership.active.is_(True),
        )
    )
    if member is None:
        raise PermissionError("Active administrator membership required")


def _authority() -> AuthorityClient:
    client = configured_client()
    if client is None:
        raise RestoreUnavailable("Independent control service is required")
    client.require_access()
    return client


def preview(
    session: Session,
    scope: str,
    person: str,
    *,
    issuer: str,
    subject: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    _authorize(session, scope, issuer, subject)
    _authority()
    now = at or datetime.now(UTC)
    record = session.get(ErasedSubject, (scope.split("/")[0], person))
    return {
        "person_id": person,
        "revision": int(record is not None),
        "state": "CONTROL_APPLIED_REMAINS" if record else "NOT_APPLIED",
        "all_copies_erased": False,
        "identity_boundary": "stable person ID only; unknown aliases require identity review",
        "inventory": copies.inventory(session, scope, person, now),
    }


def apply(
    session: Session,
    scope: str,
    person: str,
    *,
    issuer: str,
    subject: str,
    case_id: str,
    case_revision: int,
    expected_revision: int,
    idempotency_key: str,
    reason: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Caller must commit; independent prepare/commit hooks enforce fail-closed delivery."""
    _authorize(session, scope, issuer, subject)
    if not reason.strip() or not 8 <= len(idempotency_key) <= 128:
        raise ValueError("Reason and 8–128 character idempotency key required")
    if expected_revision != 0:
        raise Conflict("Person control is immutable; expected initial revision zero")
    now = at or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("Timezone-aware operation time required")
    lock_facility(session, scope)
    fingerprint = content_hash(
        [scope, person, case_id, case_revision, expected_revision, reason]
    )
    receipt_id = content_hash(
        ["subject-control", scope, issuer, subject, idempotency_key]
    )
    receipt = session.get(PlanningReceipt, receipt_id)
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise Conflict("Idempotency key reused with changed request")
        _authority()  # A replay must not bypass unavailable/pending independent control.
        return receipt.response
    facility = scope.split("/")[0]
    case = session.get(PrivacyCase, case_id, with_for_update=True)
    if (
        not case
        or case.scope_id != scope
        or case.person_id != person
        or case.kind != "erase"
    ):
        raise LookupError("Matching authorized erasure decision required")
    if case.revision != case_revision or case.status != "APPROVED":
        raise Conflict("Current approved erasure decision required")
    hold = session.scalar(
        select(LegalHold).where(
            LegalHold.scope_id.startswith(facility + "/"),
            LegalHold.active.is_(True),
            or_(LegalHold.person_id == person, LegalHold.person_id.is_(None)),
        )
    )
    if hold:
        raise Conflict("Active preservation hold prevents subject erasure control")
    if session.get(ErasedSubject, (facility, person)):
        raise Conflict("Person control already exists; use original operation key")
    rule = session.scalar(
        select(RetentionRule)
        .where(RetentionRule.scope_id == scope, RetentionRule.category == "control")
        .order_by(RetentionRule.revision.desc())
        .limit(1)
    )
    policy = RetentionPolicy.model_validate(rule.payload) if rule else None
    if (
        rule is None
        or policy is None
        or not policy.effective_from <= now.date() < policy.effective_until
        or not verified(policy.evidence, now)
        or policy.next_review < now.date()
        or policy.retention_days < policy.legal_minimum_days
    ):
        raise ValueError(
            "Current verified retention policy for control records required"
        )
    _authority()
    response = {
        "person_id": person,
        "revision": 1,
        "state": "CONTROL_APPLIED_REMAINS",
        "all_copies_erased": False,
        "case_id": case_id,
        "identity_boundary": "stable person ID only; unknown aliases require identity review",
    }
    session.add(
        PlanningReceipt(
            receipt_id=receipt_id, fingerprint=fingerprint, response=response
        )
    )
    session.flush()  # Register the operation receipt before installing the identity barrier.
    session.add(
        ErasedSubject(
            facility_id=facility,
            person_id=person,
            plan_id=case_id,
            evidence={
                "operation": "approved_subject_control",
                "actor_issuer": issuer,
                "actor_subject": subject,
                "reason": reason,
                "case_revision": case_revision,
                "policy_key": rule.key,
                "policy_revision": rule.revision,
                "policy_hash": content_hash(rule.payload),
                "response": response,
            },
        )
    )
    stage_control(session)
    # Always enlist the commit hook, even if configuration disappeared after access.
    session.info["control_dirty"] = True
    return response


def execute_eligible(
    session: Session,
    scope: str,
    person: str,
    *,
    issuer: str,
    subject: str,
    plan_id: str,
    plan_revision: int,
    fingerprint: str,
    expected_revision: int,
    idempotency_key: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Execute reviewed eligible copies without weakening hold/retention decisions.

    A fresh copy preview is required after applying the subject control. File
    tasks are processed only after commit through copies.process_one(). The
    receipt stores identifiers/counts, never a second copy of erased content.
    """
    from shift_scheduler.db.compliance_models import CopyErasure

    _authorize(session, scope, issuer, subject)
    _authority()
    if expected_revision != 1 or not 8 <= len(idempotency_key) <= 128:
        raise ValueError("Applied control revision one and operation key required")
    now = at or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("Timezone-aware operation time required")
    lock_facility(session, scope)
    request_hash = content_hash(
        [scope, person, plan_id, plan_revision, fingerprint, expected_revision]
    )
    receipt_id = content_hash(
        ["subject-eligible-erasure", scope, issuer, subject, idempotency_key]
    )
    receipt = session.get(PlanningReceipt, receipt_id)
    if receipt:
        if receipt.fingerprint != request_hash:
            raise Conflict("Idempotency key reused with changed request")
        return receipt.response
    control = session.get(ErasedSubject, (scope.split("/")[0], person))
    if control is None:
        raise Conflict("Approved subject control must be applied first")
    case = session.get(PrivacyCase, control.plan_id)
    if (
        not case
        or case.scope_id != scope
        or case.person_id != person
        or case.status != "APPROVED"
    ):
        raise Conflict("Approved decision changed; authorized review required")
    hold = session.scalar(
        select(LegalHold).where(
            LegalHold.scope_id.startswith(scope.split("/")[0] + "/"),
            LegalHold.active.is_(True),
            or_(LegalHold.person_id == person, LegalHold.person_id.is_(None)),
        )
    )
    if hold:
        raise Conflict("Active preservation hold prevents eligible erasure")
    plan = session.get(CopyErasure, plan_id)
    if not plan or plan.scope_id != scope or plan.person_id != person:
        raise LookupError("Matching authorized person copy plan required")
    result = copies.execute(
        session, scope, plan_id, fingerprint, plan_revision, subject, now
    )
    response = {
        "plan_id": plan_id,
        "revision": result["revision"],
        "state": (
            "FILES_PENDING"
            if result["queued_copy_ids"]
            else "ELIGIBLE_PROCESSED_REMAINS"
        ),
        "queued_count": len(result["queued_copy_ids"]),
        "erased_database_count": len(result["erased_database_copy_ids"]),
        "preserved_archive_count": len(result["preserved_archive_ids"]),
        "all_copies_erased": False,
        "remaining_requires_reconciliation": True,
    }
    session.add(
        PlanningReceipt(
            receipt_id=receipt_id, fingerprint=request_hash, response=response
        )
    )
    session.info["control_dirty"] = True
    return response


def plan_eligible(
    session: Session,
    scope: str,
    person: str,
    *,
    issuer: str,
    subject: str,
    expected_revision: int,
    idempotency_key: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Create a versioned plan without copying erased-person data into receipts."""
    _authorize(session, scope, issuer, subject)
    _authority()
    if expected_revision != 1 or not 8 <= len(idempotency_key) <= 128:
        raise ValueError("Applied control revision one and operation key required")
    lock_facility(session, scope)
    if session.get(ErasedSubject, (scope.split("/")[0], person)) is None:
        raise Conflict("Approved subject control must be applied first")
    key = content_hash(
        ["subject-eligible-plan", scope, issuer, subject, idempotency_key]
    )
    fingerprint = content_hash([scope, person, expected_revision])
    receipt = session.get(PlanningReceipt, key)
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise Conflict("Idempotency key reused with changed request")
        return receipt.response
    plan = copies.preview(session, scope, person, subject, at or datetime.now(UTC))
    result = {k: plan[k] for k in ("plan_id", "fingerprint", "revision")}
    result["all_copies_erased"] = False
    session.add(
        PlanningReceipt(receipt_id=key, fingerprint=fingerprint, response=result)
    )
    return result
