"""Synthetic V2/V3 compliance snapshots shared by tests and local evaluation servers.

These builders do not import pytest, so ``scripts.remediation_test_server`` can use
them from an installation that only contains the runtime dependencies.
"""

from datetime import timedelta

from tests.fixtures.reviewed_planning import reviewed_planning_snapshot as snapshot

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import SolverSnapshotV2, parse_snapshot
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3


def v2():
    base = snapshot(1, 7)
    payload = base.model_dump(mode="json")
    payload.update(
        schema_version=2,
        employments=[
            {
                "revision_id": "emp-A",
                "relationship_id": "e0",
                "person_id": "p0",
                "employer_id": "hospital",
                "contract_order": 1,
                "start": base.context.start,
                "end": base.context.end,
                "calendar_confirmed": True,
                "statutory_holidays": [
                    (base.context.start + timedelta(days=i)).date().isoformat()
                    for i in range((base.context.end - base.context.start).days)
                    if (base.context.start + timedelta(days=i)).weekday() == 6
                ],
                "declaration": base.policy_evidence.model_dump(mode="json"),
            }
        ],
        work_terms=[
            {
                "duty_id": d.duty_id,
                "employment_revision_id": "emp-A",
                "scheduled_work": [w.model_dump(mode="json") for w in d.work],
            }
            for d in base.candidates
        ],
    )
    return SolverSnapshotV2.model_validate(payload)


def upgrade(data):
    payload = data.model_dump(mode="json")
    payload["schema_version"] = 3
    sites = {}
    for row in payload["employments"]:
        row["establishment_id"] = "site-" + row["employer_id"]
        sites[row["establishment_id"]] = {
            "establishment_id": row["establishment_id"],
            "employer_id": row["employer_id"],
            "start": row["start"],
            "end": row["end"],
            "evidence": row["declaration"],
        }
    for row in payload["agreements"]:
        row["establishment_id"] = "site-" + row["employer_id"]
    payload["establishments"] = list(sites.values())
    payload["ledger_recordings"] = [
        {
            "recording_id": kind + ":" + row[key],
            "object_kind": kind,
            "object_id": row[key],
            "external_event_id": "hr:" + row[key],
            "external_revision": 1,
            "recorded_at": (
                "2026-01-01T00:00:00+09:00"
                if kind == "leave_account"
                else "2026-01-07T00:00:00+09:00"
            ),
            "evidence": row["evidence"],
        }
        for kind, collection, key in [
            ("leave_account", "leave_accounts", "account_id"),
            ("leave_record", "leave_records", "event_id"),
        ]
        for row in payload[collection]
    ]
    return payload


def data():
    old = v2()
    payload = upgrade(old)
    ev = old.policy_evidence.model_dump(mode="json")
    payload.update(
        catalogue_evidence=ev,
        fairness_history_evidence=ev,
        rule_reviews=[
            {
                "review_id": "review",
                "rule_id": old.rule_revision,
                "source_url": "synthetic:test",
                "provision": "general",
                "transitional_provision": "none in synthetic case",
                "reviewed_on": "2026-01-01",
                "next_review_on": "2026-02-01",
                "evidence": ev,
                "start": old.context.start,
                "end": old.context.end,
            }
        ],
        duty_templates=[
            {
                "template_id": "day",
                "kind": "DAY",
                "task": "dispensing",
                "location": "main",
                "dates": [
                    (old.period.start + timedelta(days=i)).date() for i in range(7)
                ],
                "start_second": 9 * 3600,
                "duration_seconds": 4 * 3600,
                "work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
                "scheduled_work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
            }
        ],
    )
    intermediate = SolverSnapshotV3.model_validate(payload)
    generated = generate_catalogue(intermediate)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    return parse_snapshot(payload)
