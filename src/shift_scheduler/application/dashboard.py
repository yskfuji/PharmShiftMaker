"""Read-only presentation of already-authorized records; no legal recalculation."""

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo


def monthly_summary(
    scope_id: str,
    period: str,
    role: str,
    publications: list[dict[str, Any]],
    requests: list[dict[str, Any]],
    *,
    observed_at: datetime | None = None,
) -> dict[str, Any]:
    year, month = map(int, period.split("-"))
    start = datetime(year, month, 1, tzinfo=ZoneInfo("Asia/Tokyo"))
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=start.tzinfo)

    def overlaps(a: str, b: str) -> bool:
        left, right = datetime.fromisoformat(a), datetime.fromisoformat(b)
        if left.tzinfo is None or right.tzinfo is None or right <= left:
            raise ValueError("Missing or invalid source interval")
        return left < end and start < right

    def metric(value: int | None, reason: str | None = None) -> dict[str, Any]:
        return {
            "value": value,
            "state": "available" if value is not None else "unknown",
            "reason": reason,
        }

    sources: list[dict[str, Any]] = []
    try:
        period_rows = [p for p in publications if overlaps(*p["period"].split("|"))]
        rows = [
            p
            for p in publications
            if p in period_rows
            or any(overlaps(d["start"], d["end"]) for d in p["assignments"])
        ]
        # Duty IDs are unique within a snapshot, not across published periods.
        duties = {
            (p["publication_id"], d["duty_id"])
            for p in rows
            for d in p["assignments"]
            if overlaps(d["start"], d["end"])
        }
        publication_metrics = {
            "published_periods": metric(len(period_rows)),
            "assigned_duties": metric(len(duties)),
            "revalidation_required": metric(
                sum(p["validation_status"] == "revalidation_required" for p in rows)
            ),
        }
        sources.extend(
            {
                "kind": "publication",
                "id": p["publication_id"],
                "version": p["version"],
                "input_hash": p["input_hash"],
            }
            for p in rows
        )
    except (ValueError, TypeError, KeyError):
        publication_metrics = {
            k: metric(None, "公開記録の期間・参照情報を確認できません。")
            for k in ("published_periods", "assigned_duties", "revalidation_required")
        }
    try:
        pending = [
            r
            for r in requests
            if r["status"] == "PENDING"
            and overlaps(r["payload"]["start"], r["payload"]["end"])
        ]
        pending_metric = metric(len(pending))
        sources.extend(
            {"kind": "request", "id": r["request_id"], "version": r["version"]}
            for r in pending
        )
    except (ValueError, TypeError, KeyError):
        pending_metric = metric(None, "申請の対象期間を確認できません。")
    return {
        "scope_id": scope_id,
        "period": period,
        "role": role,
        "visibility": "department" if role in ("ADMIN", "LEADER") else "self",
        "observed_at": (observed_at or datetime.now(UTC)).isoformat(),
        "sources": sources,
        "metrics": {**publication_metrics, "pending_requests": pending_metric},
    }
