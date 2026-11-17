# Type-annotated copy of src/shift_scheduler/application/subject_references.py for strict mypy.
# The original's bytes are hashed into the restore policy_hash / reconcile
# code_hash, so it must not change. tests/test_type_shadow.py checks that this
# copy has the same logic (annotations, casts and imports removed), the same
# imports in the same scope and order (plus typing-only additions) and the same
# signatures as the .pyi stub, and runs strict mypy on it. Do not reorder imports.
"""Explicit account-role references; never infer identity from display names/prose."""
from typing import Any
from shift_scheduler.application.hashed_types import AccountReference

from sqlalchemy import select
from sqlalchemy.orm import Session
from shift_scheduler.db.planning_models import AccountMembership

ACCOUNT_FIELDS = {"actor", "created_by", "requested_by", "reviewed_by", "published_by", "decided_by"}


def account_references(session: Session, scope: str | None, document: Any) -> list[AccountReference]:
    references: list[AccountReference] = []
    def walk(value: Any, path: tuple[str | int, ...] = ()) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if (key in ACCOUNT_FIELDS or (key == "verified_by" and path in (("decision",), ("payload", "decision")))) and isinstance(child, str) and child:
                    query = select(AccountMembership).where(AccountMembership.subject == child)
                    if scope and scope != "__unclassified__":
                        query = query.where(AccountMembership.scope_id == scope)
                    if isinstance(value.get("issuer"), str):
                        query = query.where(AccountMembership.issuer == value["issuer"])
                    # Inactive memberships remain relevant to historical records.
                    rows = list(session.scalars(query))
                    people = sorted({r.person_id for r in rows})
                    references.append({"path": [*path, key], "role": key,
                        "person_ids": people, "resolved": len(people) == 1})
                else:
                    walk(child, (*path, key))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, (*path, index))
    walk(document)
    return references
