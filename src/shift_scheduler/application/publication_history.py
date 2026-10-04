"""Preserve a published plan separately from the actual work replacing its count.

No prior plan is edited. A later publication carries immutable planned duties
with their source publication and an actual-work hash from the reviewed input.
"""

from typing import Any

from sqlalchemy.orm import Session

from shift_scheduler.db.planning_models import PlanningPublication
from shift_scheduler.domain.planning import Duty, SolverSnapshot, content_hash


def lineage(
    session: Session, publication: PlanningPublication
) -> dict[str, PlanningPublication]:
    result: dict[str, PlanningPublication] = {}
    current: PlanningPublication | None = publication
    while current:
        if current.publication_id in result:
            raise ValueError("Cyclic publication ancestry")
        result[current.publication_id] = current
        predecessor = current.payload.get("replaces")
        if not predecessor:
            break
        parent = session.get(PlanningPublication, predecessor)
        if (
            not parent
            or parent.scope_id != publication.scope_id
            or parent.period_key != publication.period_key
            or parent.version >= current.version
        ):
            raise ValueError("Publication ancestry is unavailable or inconsistent")
        current = parent
    return result


def actualized(
    session: Session, snapshot: SolverSnapshot, publication: PlanningPublication
) -> dict[str, Any]:
    """Return only exact plans replaced by actual duties in the reviewed input."""
    actuals = {d.duty_id: d for d in snapshot.history if d.source == "actual"}
    terms = [
        t
        for t in getattr(snapshot, "work_terms", ())
        if t.planned_publication_id and t.duty_id in actuals
    ]
    if not actuals:
        return {}
    parents = lineage(session, publication)
    result = {}
    for raw in publication.payload["assignments"]:
        duty = Duty.model_validate(raw)
        matches = []
        for term in terms:
            parent = parents.get(term.planned_publication_id)
            if not parent or term.planned_duty_id != duty.duty_id:
                continue
            original = next(
                (
                    d
                    for d in parent.payload["assignments"]
                    if d["duty_id"] == duty.duty_id
                ),
                None,
            )
            actual = actuals[term.duty_id]
            if (
                original != raw
                or actual.person_id != duty.person_id
                or actual.relationship_id != duty.relationship_id
            ):
                raise ValueError(
                    "Actual-work link disagrees with the immutable planned duty"
                )
            matches.append((parent.publication_id, actual))
        # Legacy inputs identify a replaced duty by the same stable duty ID.
        if not hasattr(snapshot, "work_terms") and duty.duty_id in actuals:
            actual = actuals[duty.duty_id]
            if (actual.person_id, actual.relationship_id) != (
                duty.person_id,
                duty.relationship_id,
            ):
                raise ValueError(
                    "Actual duty identity belongs to another person/employment"
                )
            matches.append((publication.publication_id, actual))
        if len(matches) > 1:
            raise ValueError(
                "Multiple actual duties claim the same published assignment"
            )
        if matches:
            parent_id, actual = matches[0]
            result[duty.duty_id] = {
                "duty_id": duty.duty_id,
                "source_publication_id": parent_id,
                "actual_duty_id": actual.duty_id,
                "actual_hash": content_hash(actual.model_dump(mode="json")),
            }
    return result


def carried_duties(
    session: Session,
    payload: dict[str, Any],
    snapshot: SolverSnapshot,
    scope: str,
    period: str,
    version: int,
) -> list[dict[str, Any]]:
    """Verify a stored carry against immutable source and input before partitioning."""
    result = []
    actuals = {d.duty_id: d for d in snapshot.history if d.source == "actual"}
    predecessor = (
        session.get(PlanningPublication, payload.get("replaces"))
        if payload.get("replaces")
        else None
    )
    ancestors = lineage(session, predecessor) if predecessor else {}
    seen = set()
    for item in payload.get("carried_assignments", []):
        if set(item) != {
            "duty_id",
            "source_publication_id",
            "actual_duty_id",
            "actual_hash",
        }:
            raise ValueError("Unknown carried-assignment provenance")
        parent = session.get(PlanningPublication, item["source_publication_id"])
        actual = actuals.get(item["actual_duty_id"])
        if (
            not parent
            or parent.publication_id not in ancestors
            or parent.scope_id != scope
            or parent.period_key != period
            or parent.version >= version
            or not actual
            or content_hash(actual.model_dump(mode="json")) != item["actual_hash"]
        ):
            raise ValueError("Carried-assignment source or actual-work hash mismatch")
        work_terms = getattr(snapshot, "work_terms", ())
        if work_terms and not any(
            t.duty_id == actual.duty_id
            and t.planned_duty_id == item["duty_id"]
            and t.planned_publication_id == parent.publication_id
            for t in work_terms
        ):
            raise ValueError("Carried-assignment actual-work link mismatch")
        original = next(
            (
                d
                for d in parent.payload["assignments"]
                if d["duty_id"] == item["duty_id"]
            ),
            None,
        )
        if (
            not original
            or item["duty_id"] in seen
            or (original["person_id"], original["relationship_id"])
            != (actual.person_id, actual.relationship_id)
        ):
            raise ValueError("Carried-assignment ownership mismatch")
        seen.add(item["duty_id"])
        result.append(Duty.model_validate(original).model_dump(mode="json"))
    return result
