"""Rebuild twelve-month burden from current published versions and latest actuals."""

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any, Literal, TypedDict, cast
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    ActualWorkEvent,
    PlanningHead,
    PlanningInput,
    PlanningPublication,
)
from shift_scheduler.domain.compliance import (
    Employment,
    SolverSnapshotV2,
    WorkTerms,
    parse_snapshot,
)
from shift_scheduler.domain.compliance_v3 import BurdenV3
from shift_scheduler.domain.planning import Duty, Evidence, Interval
from shift_scheduler.optimizer.fairness import revision_burden_spans, union_seconds
from shift_scheduler.validation.leave_accounting import account_leave
from shift_scheduler.validation.planning import working_days
from shift_scheduler.validation.work_accounting import month_boundary, verified

JST = ZoneInfo("Asia/Tokyo")

Span = tuple[datetime, datetime]
RevisionKey = tuple[str, str]  # (publication scope, contract revision)


class _Group(TypedDict):
    spans: list[Span]
    burden: list[Span]
    caps: dict[RevisionKey, int]
    spans_by_revision: defaultdict[RevisionKey, list[Span]]
    sources: set[str]


def _new_group() -> _Group:
    return {
        "spans": [],
        "burden": [],
        "caps": {},
        "spans_by_revision": defaultdict(list),
        "sources": set(),
    }


def rebuild(session: Session, snapshot: SolverSnapshotV2) -> tuple[BurdenV3, ...]:
    cutoff = month_boundary(snapshot.period.start.astimezone(JST).date(), -12)
    people = {p.person_id for p in snapshot.people}
    prefix = snapshot.facility_id + "/"
    latest: dict[tuple[str, str], ActualWorkEvent] = {}
    for r in session.scalars(
        select(ActualWorkEvent)
        .where(ActualWorkEvent.scope_id.startswith(prefix))
        .order_by(ActualWorkEvent.revision)
    ):
        latest[(r.scope_id, r.external_id)] = r
    terms = {
        (r.scope_id, r.entity_id): WorkTerms.model_validate(r.payload)
        for r in session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id.startswith(prefix),
                ComplianceEntity.kind == "work_terms",
            )
        )
    }
    replacement: dict[tuple[str | None, str | None], Duty] = {}
    for r in latest.values():
        t = terms.get((r.scope_id, r.payload["duty_id"]))
        if t and t.planned_publication_id:
            replacement[(t.planned_publication_id, t.planned_duty_id)] = (
                Duty.model_validate(r.payload)
            )
    groups: defaultdict[tuple[str, str, date, date], _Group] = defaultdict(_new_group)
    for publication in session.scalars(
        select(PlanningPublication)
        .join(
            PlanningHead,
            PlanningHead.publication_id == PlanningPublication.publication_id,
        )
        .where(PlanningPublication.scope_id.startswith(prefix))
    ):
        source = session.get(PlanningInput, publication.payload["input_hash"])
        if source is None:
            raise ValueError("Burden history source was erased or is missing")
        old = parse_snapshot(source.payload)
        if (
            old.period.end.astimezone(JST).date()
            > snapshot.period.start.astimezone(JST).date()
            or old.period.start.astimezone(JST).date() < cutoff
        ):
            continue
        if not isinstance(old, SolverSnapshotV2):
            raise ValueError(
                "Historical opportunity requires explicit V2/V3 employment classification"
            )
        employment = {e.revision_id: e for e in old.employments}
        # Every employment revision a duty runs into (not only the first one).
        own_terms = {
            t.duty_id: tuple(
                employment[k]
                for k in (t.employment_revision_ids or (t.employment_revision_id,))
            )
            for t in old.work_terms
        }
        leave = account_leave(old, old.period.start.astimezone(JST).date())[
            "live_intervals"
        ]
        from shift_scheduler.application.publication_history import carried_duties

        retained = carried_duties(
            session,
            publication.payload,
            old,
            publication.scope_id,
            publication.period_key,
            publication.version,
        )
        origins = {
            r["duty_id"]: r["source_publication_id"]
            for r in publication.payload.get("carried_assignments", [])
        }
        assignments = [
            replacement.get(
                (publication.publication_id, d["duty_id"]),
                replacement.get(
                    (origins.get(d["duty_id"]), d["duty_id"]), Duty.model_validate(d)
                ),
            )
            for d in publication.payload["assignments"]
        ]
        opportunities = {d.duty_id: d for d in old.candidates}
        opportunity_sources: dict[
            str, tuple[SolverSnapshotV2, tuple[Employment, ...], Any]
        ] = {}
        for raw in retained:
            # Actualized plans were removed from selectable candidates. They
            # remain historical opportunities, once, with their original time.
            opportunities.setdefault(raw["duty_id"], Duty.model_validate(raw))
            ancestor = session.get(PlanningPublication, origins[raw["duty_id"]])
            if ancestor is None:
                raise ValueError(
                    "Carried opportunity publication was erased or is missing"
                )
            original_input = session.get(PlanningInput, ancestor.payload["input_hash"])
            if original_input is None:
                raise ValueError("Carried opportunity input was erased or is missing")
            original = parse_snapshot(original_input.payload)
            if not isinstance(original, SolverSnapshotV2):
                raise ValueError("Carried opportunity lacks employment classification")
            original_terms = next(
                (t for t in original.work_terms if t.duty_id == raw["duty_id"]), None
            )
            original_by_id = {e.revision_id: e for e in original.employments}
            keys = (
                (
                    original_terms.employment_revision_ids
                    or (original_terms.employment_revision_id,)
                )
                if original_terms
                else ()
            )
            original_employment = (
                tuple(original_by_id[k] for k in keys if k in original_by_id) or None
            )
            if original_employment is None or len(original_employment) != len(keys):
                raise ValueError(
                    "Carried opportunity has no original employment classification"
                )
            opportunity_sources[raw["duty_id"]] = (
                original,
                original_employment,
                account_leave(original, original.period.start.astimezone(JST).date())[
                    "live_intervals"
                ],
            )
        for person in people:
            burden_kinds: tuple[Literal["night", "holiday"], ...] = (
                "night",
                "holiday",
            )
            for kind in burden_kinds:
                group = groups[
                    (
                        person,
                        kind,
                        old.period.start.astimezone(JST).date(),
                        old.period.end.astimezone(JST).date(),
                    )
                ]
                group["sources"].add(publication.publication_id)
                # Per contract revision. Revision ids are unique only within one
                # scope (department), so the key includes the publication scope.
                for c in old.contracts:
                    if c.person_id == person and c.overlaps(old.period):
                        group["caps"][
                            (publication.scope_id, c.revision_id)
                        ] = c.period_max_seconds
                for duty in opportunities.values():
                    if duty.person_id != person:
                        continue
                    eligible_input, revisions, eligible_leave = opportunity_sources.get(
                        duty.duty_id, (old, own_terms.get(duty.duty_id), leave)
                    )
                    if revisions is None:
                        raise ValueError(
                            "Historical duty has no employment classification"
                        )
                    # The revision in effect at the duty start governs it (same rule as planning).
                    from shift_scheduler.domain.contract_segments import (
                        resolve_contract,
                    )

                    governing = resolve_contract(
                        eligible_input.contracts, duty.relationship_id, duty, person
                    ).governing
                    contracts = [governing] if governing is not None else []
                    if not contracts or not any(
                        duty.kind in c.allowed_kinds for c in contracts
                    ):
                        continue
                    if not any(
                        all(
                            day.weekday() in c.allowed_weekdays
                            for day in working_days(duty)
                        )
                        and (
                            c.engagement != "agency"
                            or (
                                duty.task in c.dispatch_tasks
                                and verified(c.dispatch_evidence, duty.end)
                            )
                        )
                        for c in contracts
                    ):
                        continue
                    if not eligible_input.agreements and _touches_holiday(
                        duty, revisions
                    ):
                        continue
                    from shift_scheduler.domain.capability_coverage import (
                        capability_covers,
                    )

                    if not capability_covers(
                        eligible_input.capabilities,
                        person,
                        duty.task,
                        duty.location,
                        duty,
                        verified,
                    ):
                        continue
                    if any(
                        r.person_id == person
                        and r.overlaps(duty)
                        and (not r.prohibited_kinds or duty.kind in r.prohibited_kinds)
                        for r in eligible_input.restrictions
                    ):
                        continue
                    if any(
                        entry["person_id"] == person
                        and entry["employer_id"] == revisions[0].employer_id
                        and duty.overlaps(Interval.model_validate(entry["interval"]))
                        for entry in eligible_leave
                    ):
                        continue
                    assert governing is not None  # `contracts` was non-empty above
                    spans = revision_burden_spans(duty, kind, revisions)
                    group["spans"].extend(spans)
                    key = (publication.scope_id, governing.revision_id)
                    group["spans_by_revision"][key].extend(spans)
                    # A carried opportunity keeps its original contract revision.
                    group["caps"].setdefault(key, governing.period_max_seconds)
                for duty in assignments:
                    if duty.person_id != person:
                        continue
                    revisions = own_terms.get(duty.duty_id) or _actual_revisions(
                        terms.get((publication.scope_id, duty.duty_id)), old, duty
                    )
                    group["burden"].extend(revision_burden_spans(duty, kind, revisions))
    return tuple(
        BurdenV3(
            person_id=person,
            kind=cast(Literal["night", "holiday"], kind),
            period_start=start,
            period_end=end,
            seconds=union_seconds(values["burden"]),
            eligible_seconds=min(
                sum(
                    min(cap, union_seconds(values["spans_by_revision"].get(rid, [])))
                    for rid, cap in values["caps"].items()
                ),
                union_seconds(values["spans"]),
            ),
            eligibility_evidence=Evidence(
                reference="published-history:" + ",".join(sorted(values["sources"])),
                status="verified",
                verified_by="history-rebuild",
            ),
        )
        for (person, kind, start, end), values in sorted(groups.items())
    )


def _touches_holiday(duty: Duty, revisions: Iterable[Employment]) -> bool:
    """Whether any part of the duty works on a statutory holiday of its own revision."""
    for revision in revisions:
        work = tuple(
            w.model_copy(
                update={
                    "start": max(w.start, revision.start),
                    "end": min(w.end, revision.end),
                }
            )
            for w in duty.work
            if w.overlaps(revision)
        )
        if work and any(
            day in revision.statutory_holidays
            for day in working_days(duty.model_copy(update={"work": work}))
        ):
            return True
    return False


def _actual_revisions(
    actual_terms: WorkTerms | None, old: SolverSnapshotV2, duty: Duty
) -> tuple[Employment, ...]:
    """Employment revisions for a corrected actual: its own classification, else a
    gap-free chain of revisions of the same relationship covering the actual."""
    by_id = {e.revision_id: e for e in old.employments}
    if actual_terms is not None:
        keys = actual_terms.employment_revision_ids or (
            actual_terms.employment_revision_id,
        )
        if all(k in by_id for k in keys):
            return tuple(by_id[k] for k in keys)
    chain = sorted(
        (
            e
            for e in old.employments
            if e.relationship_id == duty.relationship_id and e.overlaps(duty)
        ),
        key=lambda e: e.start,
    )
    if (
        not chain
        or chain[0].start > duty.start
        or chain[-1].end < duty.end
        or any(a.end != b.start for a, b in zip(chain, chain[1:], strict=False))
        or len({(e.person_id, e.employer_id) for e in chain}) != 1
    ):
        raise ValueError("Corrected actual has no effective historical employment")
    return tuple(chain)
