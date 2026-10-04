"""Generate all approved pattern/relationship pairs and explain exclusions."""

from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from shift_scheduler.domain.contract_segments import resolve_contract
from shift_scheduler.domain.planning import Duty, Interval, content_hash

if TYPE_CHECKING:
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3


def generate_catalogue(snapshot: "SolverSnapshotV3") -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    classifications: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for template in snapshot.duty_templates:
        for day in template.dates:
            start = datetime.combine(day, time(), ZoneInfo("Asia/Tokyo")) + timedelta(
                seconds=template.start_second
            )
            end = start + timedelta(seconds=template.duration_seconds)
            interval = Interval(start=start, end=end)
            for relationship in sorted({c.relationship_id for c in snapshot.contracts}):
                resolution = resolve_contract(
                    snapshot.contracts, relationship, interval
                )
                identity = content_hash(
                    [template.template_id, day.isoformat(), relationship]
                )
                if (
                    not snapshot.horizon.contains(interval)
                    or resolution.reason == "no_effective_contract"
                ):
                    excluded.append(
                        {
                            "candidate_id": identity,
                            "reason": "effective_contract_or_horizon",
                            "template_id": template.template_id,
                            "relationship_id": relationship,
                            "date": day.isoformat(),
                        }
                    )
                    continue
                if resolution.reason is not None:
                    # A duty past its revision end is never dropped silently.
                    excluded.append(
                        {
                            "candidate_id": identity,
                            "reason": resolution.reason,
                            "template_id": template.template_id,
                            "relationship_id": relationship,
                            "date": day.isoformat(),
                            "revision_ids": list(resolution.revision_ids),
                        }
                    )
                    continue
                contract = resolution.governing
                assert (
                    contract is not None
                )  # resolve_contract sets it whenever reason is None
                employment = sorted(
                    [
                        e
                        for e in snapshot.employments
                        if e.relationship_id == relationship and e.overlaps(interval)
                    ],
                    key=lambda e: e.start,
                )
                if (
                    not employment
                    or employment[0].start > start
                    or employment[-1].end < end
                    or any(
                        a.end != b.start
                        for a, b in zip(employment, employment[1:], strict=False)
                    )
                    or len({(e.person_id, e.employer_id) for e in employment}) != 1
                ):
                    excluded.append(
                        {
                            "candidate_id": identity,
                            "reason": "employment_classification_unverified",
                            "template_id": template.template_id,
                            "relationship_id": relationship,
                            "date": day.isoformat(),
                        }
                    )
                    continue
                work = [
                    Interval(
                        start=start + timedelta(seconds=w.start_seconds),
                        end=start + timedelta(seconds=w.end_seconds),
                    )
                    for w in sorted(template.work, key=lambda w: w.start_seconds)
                ]
                breaks = []
                cursor = start
                for w in work:
                    if cursor < w.start:
                        breaks.append(Interval(start=cursor, end=w.start))
                    cursor = w.end
                if cursor < end:
                    breaks.append(Interval(start=cursor, end=end))
                duty = Duty(
                    duty_id=identity,
                    person_id=contract.person_id,
                    relationship_id=relationship,
                    kind=template.kind,
                    location=template.location,
                    task=template.task,
                    start=start,
                    end=end,
                    work=tuple(work),
                    breaks=tuple(breaks),
                )
                candidates.append(duty.model_dump(mode="json"))
                classifications.append(
                    {
                        "duty_id": identity,
                        "employment_revision_id": employment[0].revision_id,
                        **(
                            {
                                "employment_revision_ids": [
                                    e.revision_id for e in employment
                                ]
                            }
                            if len(employment) > 1
                            else {}
                        ),
                        "scheduled_work": [
                            Interval(
                                start=start + timedelta(seconds=w.start_seconds),
                                end=start + timedelta(seconds=w.end_seconds),
                            ).model_dump(mode="json")
                            for w in template.scheduled_work
                        ],
                    }
                )
    return {
        "candidates": candidates,
        "work_terms": classifications,
        "excluded": excluded,
        "catalogue_hash": content_hash(
            [t.model_dump(mode="json") for t in snapshot.duty_templates]
        ),
        "input_hash": snapshot.input_hash,
    }
