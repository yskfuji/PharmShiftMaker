"""Predeclared synthetic full-path suite; each response is persisted before observation.
Run tuning separately before the held-out suite. No fast failures in success percentiles.
"""

from __future__ import annotations

import random
from datetime import timedelta

from tests.test_reviewed_planning import snapshot

from shift_scheduler.domain.compliance import SolverSnapshotV2


def workload(people, days, seed):
    rng = random.Random(seed)
    data = snapshot(people, days)
    payload = data.model_dump(mode="json")
    # Homogeneous IDs are never shared across benchmark cases in the authoritative registry.
    suffix = f"-{people}-{days}-{seed}"
    ev = data.policy_evidence.model_dump(mode="json")
    payload.update(
        schema_version=2,
        source_revision=seed,
        rule_revision="completion-general-v2",
        employments=[],
        work_terms=[],
        leave_policies=[],
        leave_accounts=[],
        leave_records=[],
        leave_obligations=[],
    )
    for i, c in enumerate(payload["contracts"]):
        c.update(
            revision_id=c["revision_id"] + suffix,
            relationship_id=c["relationship_id"] + suffix,
            time_category="part_time" if i % 3 == 0 else "full_time",
            fixed_term=i % 2 == 0,
            engagement="agency" if i % 5 == 0 else "direct",
            dispatch_tasks=["dispensing"],
            dispatch_evidence=ev,
            allowed_kinds=["DAY", "NIGHT"],
            period_max_seconds=(days * 3 if i % 3 == 0 else days * 4) * 3600,
            rest_seconds=8 * 3600,
        )
        # Different designated holiday per person prevents a closed-hospital simplification.
        holiday = i % 7
        calendar = [
            (data.context.start + timedelta(days=d)).date().isoformat()
            for d in range((data.context.end - data.context.start).days)
            if (data.context.start + timedelta(days=d)).weekday() == holiday
        ]
        payload["employments"].append(
            {
                "revision_id": "emp" + str(i) + suffix,
                "relationship_id": c["relationship_id"],
                "person_id": c["person_id"],
                "employer_id": "hospital",
                "contract_order": 1,
                "week_start": 0,
                "calendar_confirmed": True,
                "statutory_holidays": calendar,
                "declaration": ev,
                "start": data.context.start.isoformat(),
                "end": data.context.end.isoformat(),
            }
        )
    for duty in payload["candidates"]:
        i = int(duty["person_id"][1:])
        duty["relationship_id"] += suffix
        duty["duty_id"] += suffix
        payload["work_terms"].append(
            {
                "duty_id": duty["duty_id"],
                "employment_revision_id": "emp" + str(i) + suffix,
                "scheduled_work": duty["work"],
            }
        )
    # Night candidates with explicitly classified crossing-midnight work.
    for day in range(days - 1):
        start = data.period.start + timedelta(days=day, hours=22)
        end = start + timedelta(hours=4)
        for i in range(people):
            if i % 3 == 0:
                continue
            identity = f"n{i}-{day}" + suffix
            payload["candidates"].append(
                {
                    "duty_id": identity,
                    "person_id": f"p{i}",
                    "relationship_id": f"e{i}" + suffix,
                    "kind": "NIGHT",
                    "location": "main",
                    "task": "dispensing",
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "work": [{"start": start.isoformat(), "end": end.isoformat()}],
                }
            )
            payload["work_terms"].append(
                {
                    "duty_id": identity,
                    "employment_revision_id": "emp" + str(i) + suffix,
                    "scheduled_work": [
                        {"start": start.isoformat(), "end": end.isoformat()}
                    ],
                }
            )
        payload["demands"].append(
            {
                "demand_id": "night" + str(day),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "task": "dispensing",
                "location": "main",
                "minimum": 1,
                "target": 1,
                "evidence": ev,
            }
        )
    for demand in payload["demands"]:
        if demand["demand_id"].startswith("d"):
            demand["minimum"] = max(2, people // 5) + rng.randrange(2)
            demand["target"] = demand["minimum"]
    # Confirmed second employment: low daily hours with independent employer holidays.
    for i in range(0, people, 10):
        relationship = f"outside-{i}" + suffix
        emp = dict(
            payload["employments"][i],
            revision_id=relationship,
            relationship_id=relationship,
            employer_id="outside",
            contract_order=2,
        )
        payload["employments"].append(emp)
        start = data.period.start + timedelta(hours=6)
        end = start + timedelta(hours=1)
        # Do not schedule an external shift on this employer's holiday.
        if start.date().isoformat() in emp["statutory_holidays"]:
            continue
        identity = "external-" + str(i) + suffix
        payload["history"].append(
            {
                "duty_id": identity,
                "person_id": f"p{i}",
                "relationship_id": relationship,
                "kind": "DAY",
                "location": "outside",
                "task": "dispensing",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "work": [{"start": start.isoformat(), "end": end.isoformat()}],
                "source": "external",
                "external_employer_id": "outside",
            }
        )
        payload["work_terms"].append(
            {
                "duty_id": identity,
                "employment_revision_id": relationship,
                "scheduled_work": [
                    {"start": start.isoformat(), "end": end.isoformat()}
                ],
            }
        )
    # Verified protected absences, concentrated but small enough to retain spare capacity.
    for i in rng.sample(range(people), max(2, people // 5)):
        day = rng.randrange(min(days, 5))
        start = data.period.start + timedelta(days=day)
        end = start + timedelta(days=1)
        payload["restrictions"].append(
            {
                "person_id": f"p{i}",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "evidence": ev,
            }
        )
    for i in range(2):
        policy_id = "leave-policy-" + str(i) + suffix
        account_id = "grant-" + str(i) + suffix
        day = data.period.start + timedelta(days=2)
        payload["leave_accounts"].append(
            {
                "account_id": account_id,
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "granted_on": "2026-01-01",
                "expires_on": "2028-01-01",
                "statutory_days": 5,
                "granted_days": 5,
                "grant_cycle_id": "cycle" + suffix,
                "evidence": ev,
            }
        )
        payload["leave_policies"].append(
            {
                "policy_id": policy_id,
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "start": data.context.start.isoformat(),
                "end": data.context.end.isoformat(),
                "hours_per_day": 4,
                "hourly_year_start": "2026-01-01",
                "evidence": ev,
            }
        )
        payload["leave_records"].append(
            {
                "event_id": "reserve-" + str(i) + suffix,
                "account_id": account_id,
                "policy_id": policy_id,
                "kind": "reserve",
                "unit": "day",
                "quantity": 1,
                "effective_on": day.date().isoformat(),
                "interval": {
                    "start": day.isoformat(),
                    "end": (day + timedelta(days=1)).isoformat(),
                },
                "evidence": ev,
            }
        )
    return SolverSnapshotV2.model_validate(payload)


def main(argv=None):
    from scripts.benchmark_runner import run

    return run(
        workload,
        argv,
        workload_configuration={
            "generator": "completion_benchmark",
            "schema_version": 2,
        },
    )


if __name__ == "__main__":
    raise SystemExit(main())
