"""Revision-bound deletion of exclusively owned, reviewed database copies.

Shared rows and live references remain explicit blockers. Metadata is the table
allowlist; locator strings are never interpolated as SQL identifiers. PostgreSQL
is required because its write triggers and table locks protect the inventory.
"""

import typing
from typing import Any

from sqlalchemy import Table, Text, cast, delete, func, select, text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from shift_scheduler.application.copy_graph import CONTROL, database_inventory
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import ManagedCopy
from shift_scheduler.domain.planning import content_hash


def resolve(copy: ManagedCopy) -> tuple[Table, list[Any]]:
    table = Base.metadata.tables.get(copy.locator.get("table") or "")
    keys = copy.locator.get("pk", {})
    if (
        table is None
        or table.name in CONTROL
        or not isinstance(keys, dict)
        or set(keys) != {c.name for c in table.primary_key}
        or copy.locator.get("hash_scheme") != "postgres-jsonb-sha256-v1"
    ):
        raise ValueError("Unknown or protected database locator")
    return table, [table.c[k] == value for k, value in keys.items()]


def current_hash(session: Session, copy: ManagedCopy) -> str | None:
    # The registration trigger canonicalizes timestamptz in UTC. The caller's
    # connection timezone must not invalidate an otherwise identical row.
    session.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    table, where = resolve(copy)
    digest = func.encode(
        func.sha256(
            func.convert_to(cast(func.to_jsonb(table.table_valued()), Text), "UTF8")
        ),
        "hex",
    )
    return session.scalar(select(digest).where(*where))


def lock_inventory(session: Session) -> None:
    if session.get_bind().dialect.name != "postgresql":
        raise ValueError("Database erasure requires PostgreSQL write barriers")
    # Also serializes raw SQL writers that do not take application advisory locks.
    quote = session.get_bind().dialect.identifier_preparer.quote
    tables = ", ".join(quote(name) for name in sorted(Base.metadata.tables))
    session.execute(text(f"LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE"))


def dependency_plan(
    session: Session,
    scope: str,
    person: str,
    targets: list[dict[str, Any]],
    graph: dict[str, Any] | None = None,
) -> list[str]:
    """Return child-before-parent order, propagating blocked dependencies.

    ``graph`` may be the caller's database_inventory for the same session state.
    """
    copies = {
        c.copy_id: c
        for c in session.scalars(select(ManagedCopy))
        if c.medium == "database" and c.state not in {"ERASED", "DELETED"}
    }
    object_ids = {
        content_hash([c.locator.get("table"), c.locator.get("pk")]): key
        for key, c in copies.items()
    }
    candidates = {t["copy_id"]: t for t in targets if t["medium"] == "database"}
    for key, target in candidates.items():
        try:
            resolve(copies[key])
        except (KeyError, ValueError):
            target["blockers"].append("database_locator_unsupported")
    edges: dict[str, set[str]] = {key: set() for key in candidates}
    graph = graph if graph is not None else database_inventory(session, scope, person)
    for record in graph["records"]:
        child = object_ids.get(record["object"])
        for ref in record["references"]:
            parent = object_ids.get(ref["target"])
            if parent in edges and child != parent:
                edges[parent].add(child or "unregistered-reference:" + record["object"])
    # Physical references outside the person's/facility's inventory must also block.
    for key in candidates:
        try:
            parent_table, where = resolve(copies[key])
        except (KeyError, ValueError):
            continue
        row = session.execute(select(parent_table).where(*where)).mappings().first()
        if row is None:
            candidates[key]["blockers"].append("database_source_missing")
            continue
        for table in Base.metadata.tables.values():
            for constraint in table.foreign_key_constraints:
                parts = list(constraint.elements)
                if not parts or parts[0].column.table.name != parent_table.name:
                    continue
                conditions = [
                    table.c[e.parent.name] == row[e.column.name] for e in parts
                ]
                for child_row in session.execute(
                    select(table).where(*conditions)
                ).mappings():
                    identity = content_hash(
                        [
                            table.name,
                            {c.name: child_row[c.name] for c in table.primary_key},
                        ]
                    )
                    child_key = object_ids.get(
                        identity, "unregistered-reference:" + identity
                    )
                    if child_key != key:
                        edges[key].add(child_key)
    eligible = {k for k, t in candidates.items() if not t["blockers"]}
    changed = True
    while changed:
        changed = False
        for key in sorted(eligible):
            missing = edges[key] - eligible
            if missing:
                candidates[key]["blockers"].append("retained_database_references")
                eligible.remove(key)
                changed = True
    order = []
    pending = set(eligible)
    while pending:
        ready = sorted(k for k in pending if not edges[k] & pending)
        if not ready:
            for key in pending:
                candidates[key]["blockers"].append("cyclic_database_references")
            break
        order.extend(ready)
        pending.difference_update(ready)
    for key, target in candidates.items():
        target["dependent_copy_ids"] = sorted(edges[key])
    return order


def erase(session: Session, copy: ManagedCopy) -> None:
    if current_hash(session, copy) != copy.content_hash:
        raise Conflict("Database content changed after subject review")
    table, where = resolve(copy)
    # DML returns a CursorResult, which carries rowcount.
    if (
        typing.cast(
            CursorResult[Any], session.execute(delete(table).where(*where))
        ).rowcount
        != 1
    ):
        raise Conflict("Database erasure target changed")
    # Trigger records DELETED. Preserve explicit approved ERASURE, with no raw content.
    session.refresh(copy)
    copy.state = "ERASED"
    copy.revision += 1
