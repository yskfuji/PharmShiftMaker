"""Deterministic planning snapshot shared by tests and isolated audit servers."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from shift_scheduler.domain.planning import (
    Capability,
    ContractRevision,
    Demand,
    Duty,
    Evidence,
    Interval,
    Person,
    SolverSnapshot,
)

JST = ZoneInfo("Asia/Tokyo")


def reviewed_planning_snapshot(n: int = 2, days: int = 2) -> SolverSnapshot:
    """Return the fixed synthetic snapshot used by reviewed planning controls."""

    start = datetime(2026, 1, 5, tzinfo=JST)
    end = start + timedelta(days=days)
    evidence = Evidence(
        reference="synthetic-confirmed-test-only",
        status="verified",
        verified_by="test-oracle",
    )
    people = tuple(Person(person_id=f"p{i}", name=f"Person {i}") for i in range(n))
    contracts = tuple(
        ContractRevision(
            revision_id=f"c{i}",
            relationship_id=f"e{i}",
            person_id=p.person_id,
            employer_id="hospital",
            facility_id="hospital",
            department_id="pharmacy",
            start=start - timedelta(days=400),
            end=end + timedelta(days=400),
            evidence=evidence,
            regime_evidence=evidence,
            external_work_confirmed=True,
            period_max_seconds=days * 4 * 3600,
            contractual_week_seconds=20 * 3600,
            rest_seconds=11 * 3600,
        )
        for i, p in enumerate(people)
    )
    capabilities = tuple(
        Capability(
            person_id=p.person_id,
            task="dispensing",
            location="main",
            start=start - timedelta(days=400),
            end=end + timedelta(days=400),
            evidence=evidence,
        )
        for p in people
    )
    duties, demands = [], []
    for day in range(days):
        duty_start = start + timedelta(days=day, hours=9)
        duty_end = duty_start + timedelta(hours=4)
        span = Interval(start=duty_start, end=duty_end)
        demands.append(
            Demand(
                demand_id=f"d{day}",
                start=duty_start,
                end=duty_end,
                task="dispensing",
                location="main",
                minimum=1,
                target=1,
                evidence=evidence,
            )
        )
        for i, person in enumerate(people):
            duties.append(
                Duty(
                    duty_id=f"p{i}d{day}",
                    person_id=person.person_id,
                    relationship_id=f"e{i}",
                    kind="DAY",
                    location="main",
                    task="dispensing",
                    start=duty_start,
                    end=duty_end,
                    work=(span,),
                )
            )
    return SolverSnapshot(
        facility_id="hospital",
        department_id="pharmacy",
        lookahead_days=0,
        period=Interval(start=start, end=end),
        context=Interval(
            start=start - timedelta(days=400), end=end + timedelta(days=14)
        ),
        rule_revision="general-test-v1",
        policy_evidence=evidence,
        history_complete=True,
        candidate_catalog_complete=True,
        people=people,
        contracts=contracts,
        capabilities=capabilities,
        candidates=tuple(duties),
        demands=tuple(demands),
    )
