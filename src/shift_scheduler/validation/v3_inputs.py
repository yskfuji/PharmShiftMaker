"""Fail-closed support envelope for V3; no completion flag substitutes for evidence."""

from typing import Any
from zoneinfo import ZoneInfo

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import Finding, Interval
from shift_scheduler.validation.work_accounting import month_boundary, verified

JST = ZoneInfo("Asia/Tokyo")


def input_findings(snapshot: SolverSnapshotV3) -> list[Finding]:
    findings: list[Finding] = []

    def add(rule: str, message: str) -> None:
        findings.append(Finding(rule_id=rule, status="unverified", message=message))

    if not verified(snapshot.catalogue_evidence, snapshot.horizon.end):
        add("catalogue.v3", "Approved duty template catalogue evidence is missing")
    else:
        catalogue = generate_catalogue(snapshot)
        expected = {d["duty_id"]: d for d in catalogue["candidates"]}
        actual = {
            d.duty_id: d.model_dump(mode="json")
            for d in snapshot.candidates
            if d.duty_id not in snapshot.previous_duty_ids
        }
        fixed = {duty.duty_id for duty in snapshot.history}
        ignored = set(snapshot.previous_duty_ids) | fixed
        expected = {key: value for key, value in expected.items() if key not in ignored}
        actual = {key: value for key, value in actual.items() if key not in fixed}
        if actual != expected:
            add(
                "catalogue.v3",
                "Candidate catalogue differs from approved pattern/relationship enumeration",
            )
        # Duties crossing inconsistent contract revisions are excluded with their
        # reason (catalogue["excluded"]); planning continues for everything else.
        # Fixed or published duties in that state still fail contract.effective.
        if any(
            e["reason"] == "employment_classification_unverified"
            for e in catalogue["excluded"]
        ):
            add(
                "catalogue.v3",
                "Some approved candidates lack employment classification",
            )
        terms = {t.duty_id: t for t in snapshot.work_terms}
        if any(
            terms[d["duty_id"]].scheduled_work
            != tuple(Interval.model_validate(w) for w in d["scheduled_work"])
            for d in catalogue["work_terms"]
            if d["duty_id"] in terms
        ):
            add(
                "catalogue.v3",
                "Scheduled classification differs from the approved template",
            )
    reviews = [
        r
        for r in snapshot.rule_reviews
        if r.rule_id == snapshot.rule_revision and r.contains(snapshot.period)
    ]
    if not reviews or any(
        not verified(r.evidence, snapshot.period.end)
        or r.next_review_on < snapshot.period.start.astimezone(JST).date()
        for r in reviews
    ):
        add("rules.v3", "Effective rule revision has no current review evidence")
    # A review bound to a source document needs one publish/hold decision made
    # after its impact was listed (scripts/rule_impact.py) for that document.
    for review in reviews:
        if review.source_sha256 is None:
            continue
        decisions = [
            d for d in snapshot.rule_decisions if d.review_id == review.review_id
        ]
        if not decisions:
            add("rules.v3", "Revised rule source has no publication decision")
        elif len(decisions) > 1 or (
            decisions[0].rule_id,
            decisions[0].source_sha256,
        ) != (
            review.rule_id,
            review.source_sha256,
        ):
            add(
                "rules.v3",
                "Publication decision does not match the reviewed rule source",
            )
        elif decisions[0].decision == "hold":
            add("rules.v3", "Publication is held for the revised rule")
        elif not verified(decisions[0].evidence, snapshot.period.end):
            add("rules.v3", "Publication decision evidence is unverified")
    if not verified(snapshot.fairness_history_evidence, snapshot.period.end):
        add(
            "fairness.v3",
            "Twelve-month burden/opportunity history or confirmed initial history is missing",
        )
    start = month_boundary(snapshot.period.start.astimezone(JST).date(), -12)
    keys = set()
    previous_periods: dict[Any, Any] = {}
    for history in snapshot.burden_history:
        identity = (
            history.person_id,
            history.kind,
            history.period_start,
            history.period_end,
        )
        if (
            identity in keys
            or not start
            <= history.period_start
            < history.period_end
            <= snapshot.period.start.astimezone(JST).date()
        ):
            add(
                "fairness.v3",
                "Burden history is duplicated or outside the twelve-month window",
            )
        keys.add(identity)
        person_kind = (history.person_id, history.kind)
        if any(
            a < history.period_end and history.period_start < b
            for a, b in previous_periods.get(person_kind, [])
        ):
            add("fairness.v3", "Historical opportunity periods overlap")
        previous_periods.setdefault(person_kind, []).append(
            (history.period_start, history.period_end)
        )
        if not verified(history.eligibility_evidence, snapshot.period.end):
            add("fairness.v3", "Historical opportunity evidence is missing")
    return findings
