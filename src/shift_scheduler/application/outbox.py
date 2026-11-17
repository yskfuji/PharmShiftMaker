"""At-least-once audit delivery. Receiver deduplicates the immutable event_id."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.db.planning_models import PlanningOutbox


def deliver_batch(
    session: Session, send: Callable[[dict[str, Any]], None], limit: int = 100
) -> int:
    if not 1 <= limit <= 1000:
        raise ValueError("Invalid delivery batch bound")
    rows = session.scalars(
        select(PlanningOutbox)
        .where(PlanningOutbox.delivered_at.is_(None))
        .order_by(PlanningOutbox.created_at, PlanningOutbox.event_id)
        .with_for_update(skip_locked=True)
        .limit(limit)
    ).all()
    for row in rows:
        send(
            {
                "event_id": row.event_id,
                "kind": row.kind,
                "scope_id": row.scope_id,
                "actor": row.actor,
                "created_at": row.created_at.isoformat(),
                "payload": row.payload,
            }
        )
        # Transaction commits only after acknowledgement. Ambiguous ACK can repeat,
        # never silently discard; external transport must use a bounded timeout.
        row.delivered_at = datetime.now(UTC)
    return len(rows)
