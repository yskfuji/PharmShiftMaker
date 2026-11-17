"""Copy registry with conservative, revision-bound erasure.

External copies require confirmation. Unknown inventories block a completion
claim. A manifest hash is evidence of the selected content, not anonymisation.
"""

import hashlib
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.application.planning import Conflict, emit, lock_facility
from shift_scheduler.db.compliance_models import (
    CopyErasure,
    CopySubject,
    LegalHold,
    ManagedCopy,
)
from shift_scheduler.domain.copies import (
    CopyRegistration,
    DatabaseCopyReview,
    SharedProjectionReview,
)
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.validation.work_accounting import verified


def storage_root() -> Path:
    configured = os.environ.get("PHARMSHIFT_MANAGED_STORAGE")
    if not configured:
        raise ValueError("Managed storage root must be explicitly configured")
    return Path(configured).resolve(strict=True)


def checked_file(relative: str) -> Path:
    path = Path(relative)
    if (
        path.is_absolute()
        or any(p in {"..", ".erasure"} for p in path.parts)
        or not path.parts
    ):
        raise ValueError("Only managed relative file paths are accepted")
    root = storage_root()
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Links are not managed erasure targets")
    if not current.resolve().is_relative_to(root):
        raise ValueError("File escapes the managed root")
    return current


def file_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def register(
    session: Session, scope: str, item: CopyRegistration, expected: int, actor: str
) -> dict[str, Any]:
    lock_facility(session, scope)
    from shift_scheduler.db.compliance_models import ErasedSubject

    if session.scalar(
        select(ErasedSubject).where(
            ErasedSubject.facility_id == scope.split("/")[0],
            ErasedSubject.person_id.in_(item.person_ids),
        )
    ):
        raise Conflict("Approved subject erasure prevents copy registration")
    row = session.get(ManagedCopy, item.copy_id)
    if row and (row.scope_id != scope or row.revision != expected):
        raise Conflict("Copy identity or revision changed")
    if not row and expected:
        raise Conflict("Copy revision does not exist")
    if item.medium != "external":
        path = checked_file(item.relative_path)
        if not path.is_file() or file_digest(path) != item.content_hash:
            raise ValueError("Copy content does not match the manifest")
    if row and row.state != "PRESENT":
        raise Conflict("Erased copies require a new identity and reviewed restoration")
    if row is None:
        row = ManagedCopy(copy_id=item.copy_id, scope_id=scope, revision=0)
        session.add(row)
    row.category, row.medium = item.category, item.medium
    row.locator = {"relative_path": item.relative_path}
    row.content_hash, row.anchor_at = item.content_hash, item.anchor_at
    row.anchor = item.anchor
    row.subject_status, row.evidence = (
        item.subject_status,
        item.evidence.model_dump(mode="json"),
    )
    row.state, row.revision = "PRESENT", expected + 1
    session.flush()
    for old in session.scalars(
        select(CopySubject).where(CopySubject.copy_id == row.copy_id)
    ):
        session.delete(old)
    session.flush()
    session.add_all(
        CopySubject(copy_id=row.copy_id, person_id=p) for p in set(item.person_ids)
    )
    emit(
        session,
        scope,
        actor,
        "copy.register",
        {"copy_id": row.copy_id, "revision": row.revision},
    )
    return {"copy_id": row.copy_id, "revision": row.revision}


def inventory(
    session: Session, scope: str, person: str, at: datetime
) -> dict[str, Any]:
    from shift_scheduler.application.copy_coverage import coverage

    prefix = scope.split("/")[0] + "/"
    holds = list(
        session.scalars(
            select(LegalHold).where(
                LegalHold.scope_id.startswith(prefix), LegalHold.active.is_(True)
            )
        )
    )
    copies = list(
        session.scalars(
            select(ManagedCopy).where(
                or_(
                    ManagedCopy.scope_id.startswith(prefix),
                    ManagedCopy.scope_id == "__unclassified__",
                )
            )
        )
    )
    owners: dict[str, set[str]] = {}
    for link in session.scalars(select(CopySubject)):
        owners.setdefault(link.copy_id, set()).add(link.person_id)
    targets = []
    unknown = []
    for row in sorted(copies, key=lambda r: r.copy_id):
        if row.state in {"ERASED", "DELETED"} or row.locator.get("retained_control"):
            continue
        from shift_scheduler.domain.planning import Evidence

        subjects_verified = row.subject_status == "VERIFIED" and verified(
            Evidence.model_validate(
                {k: v for k, v in row.evidence.items() if k in Evidence.model_fields}
            ),
            at,
        )
        if not subjects_verified:
            unknown.append(row.copy_id)
        if person not in owners.get(row.copy_id, set()):
            continue
        blockers = []
        if row.state in {
            "RESERVED",
            "WRITING",
            "WRITE_RETRY",
            "CAPTURE_RESERVED",
            "CAPTURING",
            "CAPTURE_RETRY",
            "CAPTURE_READY",
        }:
            blockers.append("file_creation_unfinished")
        if not subjects_verified:
            blockers.append("subject_inventory_unverified")
        if any(
            h.person_id is None or h.person_id in owners[row.copy_id] for h in holds
        ):
            blockers.append("legal_hold")
        projection = None
        if owners[row.copy_id] != {person}:
            try:
                from shift_scheduler.application.shared_projection import proposal

                projection = proposal(session, row, person, at)
            except (ValueError, KeyError, Conflict) as error:
                blockers.append(
                    "joint_review_required"
                    if "joint" in str(error).lower()
                    else "shared_copy_schema_unsupported"
                )
            review = row.evidence.get("preservation_review", {})
            joint_review = projection and projection.get("adapter") in {
                "joint-whole-copy-erasure-v1",
                "joint-partial-history-v1",
            }
            if not joint_review and (
                not projection
                or review.get("person_id") != person
                or review.get("source_digest") != row.content_hash
                or review.get("projection_hash") != projection["payload_hash"]
                or not review.get("shared_text_reviewed")
                or not verified(
                    Evidence.model_validate(
                        review.get(
                            "evidence", {"reference": "missing preservation review"}
                        )
                    ),
                    at,
                )
            ):
                blockers.append("shared_copy_requires_separate_preservation_decision")
        from shift_scheduler.application.privacy import applicable_rule, rule_categories

        policy_row = applicable_rule(session, row.scope_id, row.category, row.anchor)
        deadline = None
        if not policy_row:
            # A rule for this category exists, but only for another anchor.
            blockers.append(
                "retention_anchor_mismatch"
                if (row.scope_id, row.category) in rule_categories(session)
                else "retention_rule_missing"
            )
        else:
            policy = RetentionPolicy.model_validate(policy_row.payload)
            if (
                not verified(policy.evidence, at)
                or not policy.effective_from <= at.date() < policy.effective_until
                or policy.next_review < at.date()
                or policy.retention_days < policy.legal_minimum_days
            ):
                blockers.append("retention_rule_unverified_or_stale")
            anchor = (
                row.anchor_at.replace(tzinfo=UTC)
                if row.anchor_at.tzinfo is None
                else row.anchor_at
            )
            deadline = anchor + timedelta(
                days=max(policy.retention_days, policy.legal_minimum_days)
            )
            if at < deadline:
                blockers.append("retention_not_expired")
        if row.medium == "external":
            blockers.append(
                "external_confirmation_recorded"
                if row.state == "EXTERNAL_CONFIRMED"
                else "external_confirmation_required"
            )
        if row.medium == "database" and session.get_bind().dialect.name != "postgresql":
            blockers.append("database_erasure_requires_postgresql")
        targets.append(
            {
                "copy_id": row.copy_id,
                "revision": row.revision,
                "hash": row.content_hash,
                "medium": row.medium,
                "state": row.state,
                "external_confirmation": (
                    row.evidence.get("external_confirmation")
                    if row.medium == "external"
                    else None
                ),
                "blockers": blockers,
                "expires_at": deadline.isoformat() if deadline else None,
                **(
                    {
                        "preservation": {
                            k: v for k, v in projection.items() if k != "payload"
                        }
                    }
                    if projection
                    else {}
                ),
            }
        )
    # Existing DB ledgers remain an explicit separate inventory, never silently
    # counted as erased merely because registered files have been removed.
    from shift_scheduler.application.copy_graph import database_inventory

    database = database_inventory(session, scope, person)
    from shift_scheduler.application.database_erasure import dependency_plan

    database_order = dependency_plan(session, scope, person, targets, database)
    return {
        "storage_coverage": coverage(session, scope),
        "database_erasure_order": database_order,
        "person_id": person,
        "targets": targets,
        "unverified_copies": unknown,
        "database_records_remaining": sorted(r["object"] for r in database["records"]),
        "database_inventory": database,
        "boundary": "managed copies and typed database references; unverified, external and retained control data remain",
        "retained_control_categories": [
            "erasure decisions",
            "copy review audit",
            "restore prevention",
        ],
    }


def review_database_copy(
    session: Session,
    scope: str,
    item: DatabaseCopyReview,
    expected: int,
    actor: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Bind free-text subject review to this exact DB revision and content hash."""
    lock_facility(session, scope)
    row = session.scalar(
        select(ManagedCopy).where(ManagedCopy.copy_id == item.copy_id).with_for_update()
    )
    if not row or row.scope_id != scope or row.medium != "database":
        raise LookupError("Database copy not found in authorized scope")
    if (
        row.state != "PRESENT"
        or row.revision != expected
        or row.content_hash != item.content_hash
    ):
        raise Conflict("Database content changed; inspect the new revision")
    if not verified(item.evidence, at or datetime.now(UTC)):
        raise ValueError("Subject review requires current verified evidence")
    known = set(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == row.copy_id)
        )
    )
    if not known.issubset(item.person_ids):
        raise ValueError("Structured subject references cannot be removed by review")
    session.add_all(
        CopySubject(copy_id=row.copy_id, person_id=p)
        for p in set(item.person_ids) - known
    )
    row.subject_status = "VERIFIED"
    row.evidence = {
        **item.evidence.model_dump(mode="json"),
        "reviewed_by": actor,
        "reviewed_content_hash": row.content_hash,
    }
    row.revision += 1
    emit(
        session,
        scope,
        actor,
        "copy.review",
        {"copy_id": row.copy_id, "revision": row.revision},
    )
    return {
        "copy_id": row.copy_id,
        "revision": row.revision,
        "subject_status": row.subject_status,
    }


def inventory_fingerprint(data: dict[str, Any]) -> str:
    from copy import deepcopy

    value = deepcopy(data)
    # Display-only retained receipts/plans grow when this preview is recorded.
    # They are never deletion targets. Protecting rules, holds and erasure
    # barriers remain bound; do not invalidate a plan merely by recording it.
    # Live cross-store diagnostics can discover the journal/receipt produced by
    # this very preview. They are NOT an erasure grant. Bind schema/producer policy
    # here; actual targets, holds, retention, hashes and dependencies stay bound
    # below and are rechecked during execution. Unknown bytes remain displayed.
    diagnostics = value.get("storage_coverage", {})
    value["storage_coverage"] = {
        k: diagnostics[k]
        for k in (
            "schema_covered",
            "missing_tables",
            "obsolete_tables",
            "changed_tables",
            "database_policies",
            "storage_routes",
        )
        if k in diagnostics
    }
    graph = value.get("database_inventory", {})
    graph["control_records_remaining"] = [
        r
        for r in graph.get("control_records_remaining", [])
        if r["table"]
        in {"legal_holds", "retention_rules", "erased_subjects", "restore_gates"}
    ]
    return content_hash(value)


def preview(
    session: Session, scope: str, person: str, actor: str, at: datetime | None = None
) -> dict[str, Any]:
    lock_facility(session, scope)
    data = inventory(session, scope, person, at or datetime.now(UTC))
    row = CopyErasure(
        plan_id=uuid4().hex,
        scope_id=scope,
        person_id=person,
        fingerprint=inventory_fingerprint(data),
        payload=data,
        state="PREVIEW",
        revision=1,
    )
    session.add(row)
    session.flush()
    emit(session, scope, actor, "copy.preview", {"plan_id": row.plan_id})
    return {
        "plan_id": row.plan_id,
        "fingerprint": row.fingerprint,
        "revision": row.revision,
        **data,
    }


def review_shared_projection(
    session: Session,
    scope: str,
    item: SharedProjectionReview,
    expected: int,
    actor: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Approval of exact retained content, never an approval of unknown prose."""
    from shift_scheduler.application.shared_projection import proposal

    lock_facility(session, scope)
    row = session.get(ManagedCopy, item.copy_id, with_for_update=True)
    now = at or datetime.now(UTC)
    if not row or row.scope_id != scope:
        raise LookupError("Copy not found in authorized scope")
    if (
        row.state != "PRESENT"
        or row.revision != expected
        or row.content_hash != item.content_hash
    ):
        raise Conflict("Shared source changed; review its current projection")
    if row.subject_status != "VERIFIED" or not verified(item.evidence, now):
        raise ValueError(
            "Verified subject inventory and preservation evidence required"
        )
    projected = proposal(session, row, item.person_id, now)
    if projected["payload_hash"] != item.projection_hash:
        raise Conflict("Preservation projection changed")
    row.evidence = {
        **row.evidence,
        "preservation_review": {
            "person_id": item.person_id,
            "source_digest": item.content_hash,
            "projection_hash": item.projection_hash,
            "shared_text_reviewed": True,
            "evidence": item.evidence.model_dump(mode="json"),
            "reviewed_by": actor,
        },
    }
    row.revision += 1
    emit(
        session,
        scope,
        actor,
        "copy.preservation_review",
        {
            "copy_id": row.copy_id,
            "revision": row.revision,
            "projection_hash": item.projection_hash,
        },
    )
    return {
        "copy_id": row.copy_id,
        "revision": row.revision,
        "projection_hash": projected["payload_hash"],
    }


def execute(
    session: Session,
    scope: str,
    plan_id: str,
    fingerprint: str,
    expected: int,
    actor: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    from shift_scheduler.control.transaction import stage_control

    stage_control(session)
    from shift_scheduler.application.copy_coverage import require_schema_coverage

    require_schema_coverage()
    lock_facility(session, scope)
    if session.get_bind().dialect.name == "postgresql":
        from shift_scheduler.application.database_erasure import lock_inventory

        lock_inventory(session)
    plan = session.get(CopyErasure, plan_id)
    if not plan or plan.scope_id != scope:
        raise LookupError("Copy erasure plan not found")
    if plan.revision != expected or plan.fingerprint != fingerprint:
        raise Conflict("Copy erasure preview changed")
    now = at or datetime.now(UTC)
    current = inventory(session, scope, plan.person_id, now)
    if inventory_fingerprint(current) != fingerprint:
        raise Conflict("Copies, hold or retention changed; preview again")
    queued: list[str] = []
    preserved_archives: list[str] = []
    database_targets: list[str] = []
    # Preflight every eligible target before committing any irreversible action.
    for target in current["targets"]:
        if target["blockers"]:
            continue
        row = session.get(ManagedCopy, target["copy_id"])
        if row is None:  # listed by inventory() in this transaction
            raise Conflict("Copies changed; preview again")
        if row.medium == "database":
            from shift_scheduler.application.database_erasure import current_hash

            if current_hash(session, row) != row.content_hash:
                raise Conflict("Reviewed database content changed")
            database_targets.append(row.copy_id)
            continue
        path = checked_file(row.locator["relative_path"])
        if not path.is_file() or file_digest(path) != row.content_hash:
            raise Conflict("Managed file content changed")
        if target.get("preservation"):
            from shift_scheduler.application.shared_projection import preserve, proposal

            projected = proposal(session, row, plan.person_id, now)
            if projected["payload_hash"] != target["preservation"]["payload_hash"]:
                raise Conflict("File preservation projection changed")
            if projected["adapter"] == "joint-whole-copy-erasure-v1":
                row.evidence = {
                    **row.evidence,
                    "joint_erasure_intent_hash": projected["payload_hash"],
                }
            else:
                archive_id = preserve(session, row, projected, now)
                preserved_archives.append(archive_id)
                row.evidence = {**row.evidence, "preserved_archive_id": archive_id}
        row.state, row.revision = "PENDING_ERASURE", row.revision + 1
        row.evidence = {**row.evidence, "approved_plan": plan_id, "approved_by": actor}
        queued.append(row.copy_id)
    from shift_scheduler.application.database_erasure import erase

    erased_database = []
    for identity in current["database_erasure_order"]:
        if identity not in database_targets:
            continue
        row = session.get(ManagedCopy, identity)
        if row is None:  # preflighted above in this transaction
            raise Conflict("Copies changed; preview again")
        approved_hash = row.content_hash
        target = next(t for t in current["targets"] if t["copy_id"] == identity)
        joint_intent = {}
        reviewed = row.evidence.get("joint_erasure_review")
        if reviewed:
            # The trigger replaces evidence on DELETE; keep who approved what,
            # as hashes and references only (no reason text or row content).
            joint_intent["joint_review_record"] = {
                "review_hash": content_hash(reviewed),
                "context_hash": content_hash(reviewed["context"]),
                "projection_hash": reviewed.get("projection_hash"),
                "actor_issuer": reviewed["actor_issuer"],
                "actor_subject": reviewed["actor_subject"],
                "evidence_reference": reviewed["evidence"].get("reference"),
            }
        if target.get("preservation"):
            from shift_scheduler.application.shared_projection import preserve, proposal

            projected = proposal(session, row, plan.person_id, now)
            if projected["payload_hash"] != target["preservation"]["payload_hash"]:
                raise Conflict("Preservation projection changed")
            if projected["adapter"] == "joint-whole-copy-erasure-v1":
                # Every owner is controlled: nothing to keep, nobody recreated.
                joint_intent["joint_erasure_intent_hash"] = projected["payload_hash"]
            else:
                preserved_archives.append(preserve(session, row, projected, now))
        erase(session, row)
        row.evidence = {
            **row.evidence,
            **joint_intent,
            "approved_plan": plan_id,
            "approved_by": actor,
            "prior_hash": approved_hash,
        }
        erased_database.append(identity)
    plan.state, plan.revision = "QUEUED" if queued else "REMAINS", plan.revision + 1
    session.flush()
    remaining = inventory(session, scope, plan.person_id, now)
    plan.payload = {
        **current,
        "queued_copy_ids": queued,
        "erased_database_copy_ids": erased_database,
        "preserved_archive_ids": preserved_archives,
        "remaining_after_database_erasure": remaining,
        "all_copies_complete": False,
    }
    emit(
        session,
        scope,
        actor,
        "copy.erasure_queued",
        {"plan_id": plan_id, "count": len(queued)},
    )
    return {
        "plan_id": plan_id,
        "revision": plan.revision,
        "state": plan.state,
        **plan.payload,
    }


def process_one(factory: sessionmaker[Session], at: datetime | None = None) -> bool:
    """Only committed intents can reach filesystem mutation. Restart is idempotent."""
    with factory.begin() as session:
        now = at or datetime.now(UTC)
        pending = session.execute(
            select(ManagedCopy.copy_id, ManagedCopy.scope_id, ManagedCopy.evidence)
            .where(
                ManagedCopy.state.in_(["PENDING_ERASURE", "RETRY_WAIT"]),
                ManagedCopy.medium.in_(["file", "backup"]),
            )
            .order_by(ManagedCopy.copy_id)
        )
        candidate = next(
            (
                r
                for r in pending
                if not r.evidence.get("retry_after")
                or datetime.fromisoformat(r.evidence["retry_after"]) <= now
            ),
            None,
        )
        if candidate is None:
            return False
        # Same order as preview/execute/hold updates: facility, then copy row.
        # Taking the copy row first can deadlock against an API holding facility.
        lock_facility(session, candidate.scope_id)
        row = session.scalar(
            select(ManagedCopy)
            .where(
                ManagedCopy.copy_id == candidate.copy_id,
                ManagedCopy.state.in_(["PENDING_ERASURE", "RETRY_WAIT"]),
            )
            .with_for_update(skip_locked=True)
        )
        if row is None:
            return False
        now = at or datetime.now(UTC)
        plan = session.get(CopyErasure, row.evidence.get("approved_plan"))
        if not plan:
            raise Conflict("Committed erasure intent missing")
        from shift_scheduler.control.transaction import stage_control

        stage_control(session)
        fresh = inventory(session, row.scope_id, plan.person_id, now)
        item = next((t for t in fresh["targets"] if t["copy_id"] == row.copy_id), None)
        if item is None or item["blockers"]:
            row.state = "PRESENT"
            row.revision += 1
            plan.state = "REMAINS"
            plan.revision += 1
            return True
        path = checked_file(row.locator["relative_path"])
        if path.exists() and (
            not path.is_file() or file_digest(path) != row.content_hash
        ):
            row.state = "CHANGED"
            row.revision += 1
            plan.state = "REMAINS"
            plan.revision += 1
            return True
        # If the worker died after unlink, the committed intent remains and the
        # same verified target can be acknowledged without deleting another file.
        from shift_scheduler.ops.managed_erasure import erase_verified

        try:
            erase_verified(
                storage_root(),
                row.locator["relative_path"],
                row.copy_id,
                row.content_hash,
            )
        except OSError as error:
            attempts = int(row.evidence.get("erasure_attempts", 0)) + 1
            row.evidence = {
                **row.evidence,
                "erasure_attempts": attempts,
                "last_error_errno": error.errno,
                "retry_after": (
                    now + timedelta(seconds=min(300, 2 ** min(attempts, 8)))
                ).isoformat(),
            }
            row.state = "RETRY_WAIT"
            row.revision += 1
            plan.state = "RETRY_WAIT"
            plan.revision += 1
            return True
        except ValueError:
            row.state = "CHANGED"
            row.revision += 1
            plan.state = "REMAINS"
            plan.revision += 1
            return True
        row.state, row.revision = "ERASED", row.revision + 1
        row.evidence = {k: v for k, v in row.evidence.items() if k != "retry_after"}
        session.flush()
        remaining = inventory(session, row.scope_id, plan.person_id, now)
        plan.state = (
            "REMAINS"
            if (
                remaining["targets"]
                or remaining["unverified_copies"]
                or remaining["database_records_remaining"]
            )
            else "REGISTERED_COPIES_ERASED"
        )
        plan.revision += 1
        plan.payload = {**remaining, "all_copies_complete": False}
        emit(
            session,
            row.scope_id,
            "copy-worker",
            "copy.erased",
            {
                "copy_id": row.copy_id,
                "prior_hash": row.content_hash,
                "plan_id": plan.plan_id,
            },
        )
    return True


def confirm_external(
    session: Session,
    scope: str,
    copy_id: str,
    expected_revision: int,
    evidence: Any,
    actor: str,
    at: datetime | None = None,
) -> dict[str, Any]:
    """Record an external custodian's confirmation; never assert local erasure.

    The entire registered artifact is confirmed. All its people, applicable
    retention and facility-wide holds are checked, including multi-person copies.
    Caller authorization/idempotency is enforced by the API transaction wrapper.
    """
    from shift_scheduler.domain.planning import Evidence

    now = at or datetime.now(UTC)
    evidence = Evidence.model_validate(evidence)
    lock_facility(session, scope)
    row = session.get(ManagedCopy, copy_id, with_for_update=True)
    if not row or row.scope_id != scope or row.medium != "external":
        raise LookupError("External copy not found in authorized scope")
    if row.revision != expected_revision or row.state != "PRESENT":
        raise Conflict("External copy revision or confirmation state changed")
    people = set(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == copy_id)
        )
    )
    original_evidence = Evidence.model_validate(
        {k: v for k, v in row.evidence.items() if k in Evidence.model_fields}
    )
    if (
        not people
        or row.subject_status != "VERIFIED"
        or not verified(original_evidence, now)
    ):
        raise ValueError("External copy subject inventory requires verified evidence")
    if not verified(evidence, now):
        raise ValueError(
            "External custodian confirmation requires current verified evidence"
        )
    prefix = scope.split("/")[0] + "/"
    holds = session.scalars(
        select(LegalHold).where(
            LegalHold.scope_id.startswith(prefix), LegalHold.active.is_(True)
        )
    )
    if any(h.person_id is None or h.person_id in people for h in holds):
        raise Conflict("External copy is subject to an active legal hold")
    from shift_scheduler.application.privacy import applicable_rule

    rule = applicable_rule(session, scope, row.category, row.anchor)
    if not rule:
        raise ValueError("External copy retention rule is missing")
    policy = RetentionPolicy.model_validate(rule.payload)
    if (
        policy.anchor != row.anchor
        or not verified(policy.evidence, now)
        or not policy.effective_from <= now.date() < policy.effective_until
        or policy.next_review < now.date()
        or policy.retention_days < policy.legal_minimum_days
    ):
        raise ValueError("External copy retention rule is unverified or stale")
    anchor = (
        row.anchor_at.replace(tzinfo=UTC)
        if row.anchor_at.tzinfo is None
        else row.anchor_at
    )
    if now < anchor + timedelta(
        days=max(policy.retention_days, policy.legal_minimum_days)
    ):
        raise Conflict("External copy retention has not expired")
    row.evidence = {
        **row.evidence,
        "external_confirmation": {
            "content_hash": row.content_hash,
            "source_revision": row.revision,
            "person_ids": sorted(people),
            "retention_revision": rule.revision,
            "recorded_by": actor,
            "recorded_at": now.isoformat(),
            "evidence": evidence.model_dump(mode="json"),
            "local_physical_erasure_verified": False,
        },
    }
    row.state = "EXTERNAL_CONFIRMED"
    row.revision += 1
    emit(
        session,
        scope,
        actor,
        "copy.external_confirmed",
        {
            "copy_id": copy_id,
            "revision": row.revision,
            "content_hash": row.content_hash,
            "person_ids": sorted(people),
            "local_physical_erasure_verified": False,
        },
    )
    return {
        "copy_id": copy_id,
        "revision": row.revision,
        "state": row.state,
        "confirmation": row.evidence["external_confirmation"],
        "all_copies_complete": False,
    }
