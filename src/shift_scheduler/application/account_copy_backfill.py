"""Reviewable actor-link backfill; original rows, hashes and retention clocks stay intact."""

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from shift_scheduler.application.copy_graph import CONTROL, typed_values
from shift_scheduler.application.database_erasure import (
    current_hash,
    lock_inventory,
    resolve,
)
from shift_scheduler.application.planning import Conflict
from shift_scheduler.application.subject_references import account_references
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy
from shift_scheduler.domain.planning import content_hash


def preview(session: Session, scope: str) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    unresolved: list[str] = []
    for copy in session.scalars(
        select(ManagedCopy).where(
            or_(
                ManagedCopy.scope_id == scope,
                ManagedCopy.scope_id == "__unclassified__",
            ),
            ManagedCopy.medium == "database",
            ManagedCopy.state == "PRESENT",
        )
    ):
        if copy.locator.get("table") in CONTROL or copy.locator.get("retained_control"):
            continue
        table, where = resolve(copy)
        row = session.execute(select(table).where(*where)).mappings().first()
        if row is None or current_hash(session, copy) != copy.content_hash:
            raise Conflict("Source changed before actor inventory review")
        inferred_scope, provenance = copy.scope_id, None
        typed_people: set[str] = set()
        if copy.locator.get("table") == "planning_leave_events":
            from shift_scheduler.db.planning_models import (
                LeaveBalance,
                PlanningPublication,
            )

            parent = (
                session.get(PlanningPublication, row["publication_id"])
                if row["publication_id"]
                else None
            )
            grant = session.get(LeaveBalance, row["grant_id"])
            if not parent or parent.scope_id != scope or not grant:
                if copy.scope_id == scope:
                    unresolved.append(copy.copy_id)
                continue
            inferred_scope = parent.scope_id
            typed_people = {grant.person_id} | {
                p for _, p in typed_values(parent.payload, {"person_id"})
            }
            provenance = content_hash(
                [parent.publication_id, parent.payload, grant.grant_id, grant.person_id]
            )
        elif copy.scope_id != scope:
            continue  # Unknown legacy scopes are not guessed from unrelated rows.
        refs = account_references(session, scope, dict(row))
        old = set(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        )
        added = sorted(
            ({p for ref in refs for p in ref["person_ids"]} | typed_people) - old
        )
        if any(not ref["resolved"] for ref in refs):
            unresolved.append(copy.copy_id)
        if added or inferred_scope != copy.scope_id:
            changes.append(
                {
                    "copy_id": copy.copy_id,
                    "revision": copy.revision,
                    "content_hash": copy.content_hash,
                    "additional_person_ids": added,
                    "source_scope": copy.scope_id,
                    "resolved_scope": inferred_scope,
                    "typed_parent_hash": provenance,
                }
            )
    result = {
        "changes": sorted(changes, key=lambda c: c["copy_id"]),
        "unresolved_copy_ids": sorted(unresolved),
    }
    return {**result, "preview_hash": content_hash([scope, result])}


def apply(session: Session, scope: str, expected_hash: str) -> dict[str, Any]:
    lock_inventory(session)
    result = preview(session, scope)
    if result["preview_hash"] != expected_hash:
        raise Conflict("Actor inventory changed; review the new preview")
    for item in result["changes"]:
        copy = session.get(ManagedCopy, item["copy_id"])
        if copy is None:  # listed by preview() in this transaction
            raise Conflict("Actor inventory changed; review the new preview")
        for person in item["additional_person_ids"]:
            session.add(CopySubject(copy_id=copy.copy_id, person_id=person))
        copy.scope_id = item["resolved_scope"]
        copy.revision += 1
        copy.subject_status = "UNVERIFIED"
        copy.evidence = {
            "reference": "actor-backfill-v1",
            "status": "unverified",
            "prior_review_hash": content_hash(copy.evidence),
            "backfill_hash": expected_hash,
        }
    session.flush()
    return {
        "updated_copies": len(result["changes"]),
        "unresolved_copy_ids": result["unresolved_copy_ids"],
        "subject_reviews_required": True,
    }
