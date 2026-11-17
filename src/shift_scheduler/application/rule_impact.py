"""Read-only impact of a revised rule source (G04).

Rule reviews and decisions belong to one department (planning scope). For a
review bound to a source document, list what that department decided under an
earlier rule revision within the review's effective interval:

- its planning publications of a period overlapping the interval under another rule;
- grant assessments recorded from its inputs under another rule for grants in the interval;
- annual-leave grant records of its people in the interval, entered before the review date.

Nothing is written. The impact hash is recorded in the publish/hold decision and
compared again at publication, so a changed impact requires a new decision.
Dates are judged in Japan time, like the rest of the application.
"""

from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    PlanningInput,
    PlanningPublication,
    PlanningReceipt,
)
from shift_scheduler.domain.compliance_v3 import RuleReview, SolverSnapshotV3
from shift_scheduler.domain.planning import Interval, content_hash

JST = ZoneInfo("Asia/Tokyo")


def today(timezone: str) -> date:
    return datetime.now(ZoneInfo(timezone)).date()


def _aware(value: datetime) -> datetime:
    # SQLite returns naive values for timezone-aware columns written in UTC.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _period(key: str) -> Interval | None:
    start, _, end = key.partition("|")
    try:
        return Interval.model_validate({"start": start, "end": end})
    except ValueError:
        return None


def rule_impact(session: Session, scope: str, review: RuleReview) -> dict[str, Any]:
    first, last = review.start.astimezone(JST).date(), review.end.astimezone(JST).date()
    cutoff = datetime.combine(review.reviewed_on, time(), JST)
    publications: list[dict[str, Any]] = []
    for publication in session.scalars(
        select(PlanningPublication)
        .where(PlanningPublication.scope_id == scope)
        .order_by(PlanningPublication.publication_id)
    ):
        if publication.payload.get("rule_revision") == review.rule_id:
            continue
        period = _period(publication.period_key)
        if period is not None and not period.overlaps(review):
            continue
        publications.append(
            {
                "publication_id": publication.publication_id,
                "period_key": publication.period_key,
                "version": publication.version,
                "rule_revision": publication.payload.get("rule_revision"),
                "period_known": period is not None,
            }
        )
    inputs = {
        input_hash: payload.get("people", [])
        for input_hash, payload in session.execute(
            select(PlanningInput.input_hash, PlanningInput.payload).where(
                PlanningInput.scope_id == scope
            )
        )
    }
    people = {p["person_id"] for payload in inputs.values() for p in payload}
    facility = scope.split("/")[0]
    accounts: dict[str, date] = {}
    records: list[dict[str, Any]] = []
    for row in session.scalars(
        select(ComplianceEntity)
        .where(
            ComplianceEntity.scope_id.startswith(facility + "/"),
            ComplianceEntity.kind == "leave_account",
        )
        .order_by(ComplianceEntity.key)
    ):
        if row.scope_id.split("/")[0] != facility or row.person_id not in people:
            continue
        granted = date.fromisoformat(row.payload["granted_on"])
        if not first <= granted < last:
            continue
        accounts[row.entity_id] = granted
        if _aware(row.created_at) < cutoff:
            records.append(
                {
                    "account_id": row.entity_id,
                    "granted_on": granted.isoformat(),
                    "revision": row.revision,
                }
            )
    assessments: list[dict[str, Any]] = []
    # Receipts carry no scope column. Assessments record their department;
    # older ones are attributed only when made from a stored department input.
    for receipt in session.scalars(
        select(PlanningReceipt).order_by(PlanningReceipt.receipt_id)
    ):
        response = receipt.response
        if not (
            isinstance(response, dict)
            and "assessment" in response
            and (
                response.get("scope_id") == scope
                if "scope_id" in response
                else response.get("input_hash") in inputs
            )
            and response.get("account_id") in accounts
            and response.get("rule_revision") != review.rule_id
        ):
            continue
        assessments.append(
            {
                "assessment_id": response.get("assessment_id"),
                "account_id": response["account_id"],
                "rule_revision": response.get("rule_revision"),
                "as_of": response.get("as_of"),
                "status": response.get("status"),
            }
        )
    assessments.sort(key=lambda a: (str(a["assessment_id"]), str(a["as_of"])))
    records.sort(key=lambda r: str(r["account_id"]))
    items = {
        "publications": publications,
        "grant_assessments": assessments,
        "grant_records": records,
    }
    return {
        "scope_id": scope,
        "review_id": review.review_id,
        "rule_id": review.rule_id,
        "source_sha256": review.source_sha256,
        "document_version": review.document_version,
        **items,
        "impact_count": sum(len(v) for v in items.values()),
        "impact_hash": content_hash(
            [scope, review.review_id, review.rule_id, review.source_sha256, items]
        ),
    }


def publication_findings(
    session: Session, scope_id: str, snapshot: SolverSnapshotV3
) -> list[str]:
    """Checks that depend on the date of publication and on stored records."""
    messages: list[str] = []
    day = today(snapshot.timezone)
    current = [
        r
        for r in snapshot.rule_reviews
        if r.rule_id == snapshot.rule_revision and r.contains(snapshot.period)
    ]
    # A correction of a past period keeps the review that was valid then.
    if snapshot.period.end.astimezone(JST).date() > day:
        messages += [
            f"Rule review {r.review_id} is overdue since {r.next_review_on}"
            for r in current
            if r.next_review_on < day
        ]
    # Changing the rule revision of a department requires a review bound to its
    # source document, whichever path registered the input.
    latest = session.scalar(
        select(PlanningPublication)
        .where(PlanningPublication.scope_id == scope_id)
        .order_by(PlanningPublication.created_at.desc())
        .limit(1)
    )
    if (
        latest is not None
        and latest.payload.get("rule_revision") != snapshot.rule_revision
        and not any(r.source_sha256 for r in current)
    ):
        messages.append(
            "Rule revision changed without a review bound to its source document"
        )
    for review in current:
        if review.source_sha256 is None:
            continue
        for decision in snapshot.rule_decisions:
            if decision.review_id != review.review_id:
                continue
            impact = rule_impact(session, scope_id, review)
            if (impact["impact_hash"], impact["impact_count"]) != (
                decision.impact_hash,
                decision.impact_count,
            ):
                messages.append(
                    f"Impact of rule review {review.review_id} changed after the decision"
                )
    return messages


def decision_problem(
    session: Session, scope: str, payload: dict[str, Any]
) -> str | None:
    """A decision must name a stored review of this department and the impact seen."""
    from shift_scheduler.application.compliance import entity_key
    from shift_scheduler.domain.compliance_v3 import RuleDecision

    try:
        decision = RuleDecision.model_validate(payload)
    except ValueError:
        return None  # the schema error is reported by save_entity
    row = session.get(
        ComplianceEntity, entity_key(scope, "rule_review", decision.review_id)
    )
    if row is None:
        return "判断の対象の制度確認が見つかりません。"
    review = RuleReview.model_validate(row.payload)
    if (review.rule_id, review.source_sha256) != (
        decision.rule_id,
        decision.source_sha256,
    ):
        return "判断が、制度確認の規則版または資料のハッシュと一致しません。"
    if (
        review.reviewed_on > today("Asia/Tokyo")
        or decision.decided_on < review.reviewed_on
    ):
        return "判断日は制度確認の日以後にし、確認日は今日以前にしてください。"
    impact = rule_impact(session, scope, review)
    if (impact["impact_hash"], impact["impact_count"]) != (
        decision.impact_hash,
        decision.impact_count,
    ):
        return "影響の一覧が変わりました。影響を表示し直してから判断してください。"
    return None
