"""Explicit joint erasure review for a shared snapshot file or database row.

A file is erased whole once every owner is controlled. A database row removes
every controlled owner together and keeps only the uncontrolled owners as a
reviewed, non-replayable partial history (or is erased whole if none remain).
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from shift_scheduler.application.planning import Conflict, lock_facility
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ErasedSubject,
    LegalHold,
    ManagedCopy,
    PrivacyCase,
)
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.validation.work_accounting import verified


def _joint_tables() -> frozenset[str]:
    from shift_scheduler.application.shared_subject_record import SUPPORTED

    return frozenset(
        SUPPORTED
        | {
            "planning_inputs",
            "preserved_archives",
            "planning_jobs",
            "planning_drafts",
            "planning_publications",
            "planning_outbox",
        }
    )


JOINT_DATABASE_TABLES = _joint_tables()


def context(session: Session, copy: ManagedCopy, at: datetime) -> dict[str, Any]:
    database = copy.medium == "database"
    if database:
        from shift_scheduler.application.database_erasure import resolve

        table, _ = resolve(
            copy
        )  # protected/unknown locators never enter a joint decision
        if copy.scope_id == "__unclassified__":
            raise ValueError("Unclassified rows need scope review first")
        if table.name not in JOINT_DATABASE_TABLES:
            # Pointer and derived rows (for example the current-input head)
            # carry their owners only through a parent; they follow the parent.
            raise ValueError("Joint review requires a reviewed row schema")
    elif copy.medium != "file" or copy.locator.get("route") != "schedule.json":
        raise ValueError(
            "Joint review only supports registered schedule snapshots and database rows"
        )
    people = sorted(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
        )
    )
    if len(people) < 2:
        raise ValueError("A complete shared subject set is required")
    facility = copy.scope_id.split("/")[0]
    if session.scalar(
        select(LegalHold).where(
            LegalHold.scope_id.startswith(facility + "/"),
            LegalHold.active.is_(True),
            or_(LegalHold.person_id.in_(people), LegalHold.person_id.is_(None)),
        )
    ):
        raise Conflict("A participant preservation hold prevents joint erasure")
    # A shared file is erased whole, so every owner must be controlled. A shared
    # database row keeps the uncontrolled owners (for example the operator
    # account) as partial history, so at least two owners must be controlled.
    controlled = (
        [p for p in people if session.get(ErasedSubject, (facility, p))]
        if database
        else people
    )
    if len(controlled) < 2:
        raise Conflict("Joint review needs at least two controlled participants")
    participants = []
    for person in controlled:
        control = session.get(ErasedSubject, (facility, person))
        case = session.get(PrivacyCase, control.plan_id) if control else None
        if (
            not control
            or not case
            or case.scope_id != copy.scope_id
            or case.person_id != person
            or case.kind != "erase"
            or case.status != "APPROVED"
            or case.revision != control.evidence.get("case_revision")
        ):
            raise Conflict(
                "Every participant needs a current approved case and stable person control"
            )
        participants.append(
            {
                "person_id": person,
                "case_id": case.case_id,
                "case_revision": case.revision,
                "case_reason": case.payload.get("decision", {}).get(
                    "reason", case.payload.get("reason", "")
                ),
                "case_hash": content_hash(case.payload),
                "control_hash": content_hash(control.evidence),
            }
        )
    from shift_scheduler.application.privacy import applicable_rule

    rule = applicable_rule(session, copy.scope_id, copy.category, copy.anchor)
    if rule is None:
        raise Conflict("Retention rule missing")
    policy = RetentionPolicy.model_validate(rule.payload)
    if (
        not verified(policy.evidence, at)
        or not policy.effective_from <= at.date() < policy.effective_until
        or policy.next_review < at.date()
        or policy.anchor != copy.anchor
        or policy.retention_days < policy.legal_minimum_days
    ):
        raise Conflict("Retention rule not applicable")
    from datetime import timedelta

    anchor = (
        copy.anchor_at.replace(tzinfo=UTC)
        if copy.anchor_at.tzinfo is None
        else copy.anchor_at
    )
    if at < anchor + timedelta(
        days=max(policy.retention_days, policy.legal_minimum_days)
    ):
        raise Conflict("Retention period has not expired")
    value = {
        "copy_id": copy.copy_id,
        "source_hash": copy.content_hash,
        "source_metadata_hash": content_hash(
            {
                "scope": copy.scope_id,
                "category": copy.category,
                "medium": copy.medium,
                "locator": copy.locator,
                "anchor": copy.anchor,
                "anchor_at": anchor.astimezone(UTC).isoformat(),
                "subject_status": copy.subject_status,
            }
        ),
        "owners": people,
        "participants": participants,
        "policy_purpose": policy.purpose,
        "policy_key": rule.key,
        "policy_revision": rule.revision,
        "policy_hash": content_hash(rule.payload),
    }
    if database:
        # File contexts keep their original shape (and hash); database rows add
        # the retained owners and the medium explicitly.
        value.update(
            medium="database", retained_owners=sorted(set(people) - set(controlled))
        )
    return value


def joint_payload(
    session: Session,
    copy: ManagedCopy,
    current: dict[str, Any],
    review_hash: str | None,
) -> dict[str, Any]:
    """The committed intent: whole-copy erasure, or the retained partial history."""
    if copy.medium == "database" and current["retained_owners"]:
        from shift_scheduler.application.shared_projection import (
            joint_database_projection,
        )

        prepared = joint_database_projection(
            session, copy, [p["person_id"] for p in current["participants"]]
        )
        if prepared["person_ids"] != current["retained_owners"]:
            raise Conflict(
                "Retained owners differ from the reviewed participant context"
            )
        return prepared
    payload = {
        "operation": "joint-whole-copy-erasure-v1",
        "context": current,
        "review_hash": review_hash,
    }
    return {
        "adapter": "joint-whole-copy-erasure-v1",
        "payload": payload,
        "payload_hash": content_hash(payload),
        "source_digest": copy.content_hash,
        "person_ids": [],
    }


def proposal(
    session: Session, copy: ManagedCopy, person: str, at: datetime
) -> dict[str, Any] | None:
    review = copy.evidence.get("joint_erasure_review")
    if not review:
        return None
    current = context(session, copy, at)
    # Only a controlled participant's plan can carry out the joint decision.
    if (
        person not in {p["person_id"] for p in current["participants"]}
        or current != review["context"]
    ):
        raise Conflict("Joint participant decision or source changed; review again")
    from shift_scheduler.domain.planning import Evidence

    if not verified(Evidence.model_validate(review["evidence"]), at):
        raise Conflict("Joint review evidence expired")
    if copy.medium == "database":
        from shift_scheduler.application.database_erasure import current_hash

        if copy.state != "PRESENT" or current_hash(session, copy) != copy.content_hash:
            raise Conflict("Joint database source changed")
        prepared = joint_payload(session, copy, current, content_hash(review))
        if current["retained_owners"] and prepared["payload_hash"] != review.get(
            "projection_hash"
        ):
            raise Conflict("Joint partial history differs from the reviewed projection")
        return prepared
    from shift_scheduler.application.copies import checked_file, file_digest

    path = checked_file(copy.locator["relative_path"])
    if path.exists():
        if not path.is_file() or file_digest(path) != copy.content_hash:
            raise Conflict("Joint source changed")
    elif copy.state not in {"PENDING_ERASURE", "RETRY_WAIT"}:
        raise Conflict("Joint source missing before committed intent")
    prepared = joint_payload(session, copy, current, content_hash(review))
    if (
        copy.state in {"PENDING_ERASURE", "RETRY_WAIT"}
        and copy.evidence.get("joint_erasure_intent_hash") != prepared["payload_hash"]
    ):
        raise Conflict("Joint committed intent changed")
    return prepared


def review(
    session: Session,
    scope: str,
    copy_id: str,
    *,
    expected_revision: int,
    source_hash: str,
    context_hash: str,
    reason: str,
    evidence: Any,
    issuer: str,
    subject: str,
    at: datetime | None = None,
    projection_hash: str | None = None,
) -> dict[str, Any]:
    from shift_scheduler.application.shared_projection import file_payload
    from shift_scheduler.application.subject_controls import _authority, _authorize

    _authorize(session, scope, issuer, subject)
    _authority()
    lock_facility(session, scope)
    now = at or datetime.now(UTC)
    copy = session.get(ManagedCopy, copy_id, with_for_update=True)
    if not copy or copy.scope_id != scope:
        raise LookupError("Copy not found in scope")
    if (
        copy.state != "PRESENT"
        or copy.revision != expected_revision
        or copy.content_hash != source_hash
    ):
        raise Conflict("Copy version changed")
    current = context(session, copy, now)
    if content_hash(current) != context_hash:
        raise Conflict("Joint review participant context changed")
    if not reason.strip() or not verified(evidence, now):
        raise ValueError("Explicit reason and reviewed evidence required")
    record = {
        "context": current,
        "reason": reason,
        "evidence": evidence.model_dump(mode="json"),
        "actor_issuer": issuer,
        "actor_subject": subject,
        "shared_text_reviewed": True,
    }
    if copy.medium == "database":
        from shift_scheduler.application.database_erasure import current_hash

        if current_hash(session, copy) != copy.content_hash:
            raise Conflict("Database row changed")
        if current["retained_owners"]:
            # The reviewer approves the exact retained partial history.
            prepared = joint_payload(session, copy, current, None)
            if projection_hash != prepared["payload_hash"]:
                raise Conflict(
                    "Reviewed partial history differs from the current projection"
                )
            record["projection_hash"] = prepared["payload_hash"]
        elif projection_hash is not None:
            raise ValueError(
                "Whole-row joint erasure has no partial history to approve"
            )
    else:
        # Parse the complete immutable original using the normal strict file adapter.
        file_payload(session, copy, current["owners"][0])
    copy.evidence = {**copy.evidence, "joint_erasure_review": record}
    copy.revision += 1
    from shift_scheduler.application.planning import emit

    emit(
        session,
        scope,
        subject,
        "copy.joint_review",
        {
            "copy_id": copy_id,
            "revision": copy.revision,
            "context_hash": context_hash,
            "review_hash": content_hash(record),
            "projection_hash": record.get("projection_hash"),
        },
    )
    return {
        "copy_id": copy_id,
        "revision": copy.revision,
        "review_hash": content_hash(record),
    }
