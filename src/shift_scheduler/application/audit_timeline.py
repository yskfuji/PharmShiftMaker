"""A scope's audit timeline for administrators, read from the planning outbox.

Every recorded operation emits exactly one outbox event, so the outbox covers the case,
lifecycle and administrative-record histories without counting any twice. Receipts are
not included: they carry no time. People and accounts are never named: an entry says how
many people an event concerned, the actor's role when it can be resolved without an
identifier, and the publication/revision number where one was recorded.
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox

CATEGORIES = (
    ("change.", "change"),
    ("membership.", "membership"),
    ("lifecycle.", "lifecycle"),
    ("schedule.", "schedule"),
    ("draft.", "schedule"),
    ("job.", "schedule"),
    ("input.", "schedule"),
    ("candidates.", "schedule"),
    ("request.", "request"),
    ("leave.", "request"),
    ("compliance.", "compliance"),
    ("actual.", "compliance"),
    ("privacy.", "privacy"),
    ("copy.", "privacy"),
    ("erasure.", "privacy"),
    ("retention.", "privacy"),
)
LIMITS = (
    "計画の通知（planning_outbox）だけを材料にしています。受領記録には時刻がないため含みません。",
    "職員名・職員 ID・アカウント ID・業務オブジェクト ID は返しません。操作主体は現在の所属から一意に解決できる役割だけを示します。",
    "役割は現在の所属から導くため、操作時点の役割を証明する履歴ではありません。解決不能・複数候補なら「—」です。",
    "人数が通知に記録されていない出来事（管理記録の変更など）は、人数を「—」とします。",
    "根拠・理由・判断の本文は返しません。",
)


def category(kind: str) -> str:
    return next(
        (name for prefix, name in CATEGORIES if kind.startswith(prefix)), "other"
    )


def subject_count(payload: dict[str, Any]) -> int | None:
    """How many people an event concerned, or None when the event does not record it."""
    ids = payload.get("person_ids")
    if isinstance(ids, list):
        return len(set(ids))
    if "person_id" in payload:
        return 1 if payload["person_id"] else 0
    return None


def recorded_version(payload: dict[str, Any]) -> int | None:
    for key in ("version", "revision"):
        value = payload.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def encode(at: datetime, event_id: str) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{event_id}".encode()).decode()


def decode(cursor: str) -> tuple[datetime, str]:
    try:
        at, event_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(at), event_id
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Unreadable cursor") from error


def page(
    session: Session,
    scope_id: str,
    *,
    before: str | None,
    limit: int,
    only: str | None,
) -> dict[str, Any]:
    roles: dict[str, set[str]] = {}
    for subject, role in session.execute(
        select(AccountMembership.subject, AccountMembership.role).where(
            AccountMembership.scope_id == scope_id
        )
    ).tuples():
        roles.setdefault(subject, set()).add(role)
    query = select(PlanningOutbox).where(PlanningOutbox.scope_id == scope_id)
    if before:
        at, event_id = decode(before)
        query = query.where(
            or_(
                PlanningOutbox.created_at < at,
                and_(
                    PlanningOutbox.created_at == at, PlanningOutbox.event_id < event_id
                ),
            )
        )
    query = query.order_by(
        PlanningOutbox.created_at.desc(), PlanningOutbox.event_id.desc()
    )
    entries: list[dict[str, Any]] = []
    last: PlanningOutbox | None = None
    more = False
    # Filtering by category happens here (the category is derived from the kind), so
    # read in batches until the page is full.
    for row in session.scalars(query).yield_per(200):
        if only and category(row.kind) != only:
            continue
        if len(entries) == limit:
            more = True
            break
        payload = row.payload or {}
        actor_roles = roles.get(row.actor, set())
        entries.append(
            {
                "at": row.created_at,
                "kind": row.kind,
                "category": category(row.kind),
                "actor_role": (
                    next(iter(actor_roles)) if len(actor_roles) == 1 else None
                ),
                "subject_count": subject_count(payload),
                "version": recorded_version(payload),
            }
        )
        last = row
    return {
        "entries": entries,
        "next_cursor": (
            encode(last.created_at, last.event_id) if more and last else None
        ),
        "sources": ["planning_outbox"],
        "limits": list(LIMITS),
    }
