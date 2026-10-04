import json

import pytest
from scripts.acceptance_assessment import assess, nearest_rank, wilson_interval


def fixtures(count=100):
    cases = [
        {
            "people": 30,
            "days": 28,
            "case": i,
            "seed": i,
            "split": "held-out",
            "budget": 20,
        }
        for i in range(count)
    ]
    events = []
    for c in cases:
        start = {
            "case_key": json.dumps(c, sort_keys=True),
            "attempt": str(c["case"]),
            "kind": "START",
            "payload": c,
        }
        events.extend(
            [
                start,
                {
                    **start,
                    "kind": "RESULT",
                    "payload": {
                        "success": True,
                        "status": "FEASIBLE",
                        "commit_telemetry_complete": True,
                        "persisted_observed_at": "2026-09-23T00:00:00Z",
                        "observed_end_to_end_seconds": 30 if c["case"] < 95 else 31,
                    },
                },
            ]
        )
    return cases, events


def test_nearest_rank_boundary_does_not_claim_complete_protocol():
    cases, events = fixtures()
    report = assess(events, cases)
    assert report["timing_groups_passed"]
    assert not report["protocol_dimensions_complete"]
    assert report["strata"][0]["over_30_seconds"] == 5
    assert nearest_rank([30] * 94 + [31] * 6) == 31
    assert wilson_interval(0, 100)[1] > 0


@pytest.mark.parametrize(
    "corruption", ["failure", "missing_commit", "nan", "interrupted", "absent"]
)
def test_successful_retry_cannot_replace_first_attempt(corruption):
    cases, events = fixtures()
    first = events[:2]
    if corruption == "failure":
        events[1] = {
            **events[1],
            "payload": {**events[1]["payload"], "success": False, "status": "UNKNOWN"},
        }
    if corruption == "missing_commit":
        events[1] = {
            **events[1],
            "payload": {**events[1]["payload"], "commit_telemetry_complete": False},
        }
    if corruption == "nan":
        events[1] = {
            **events[1],
            "payload": {
                **events[1]["payload"],
                "observed_end_to_end_seconds": float("nan"),
            },
        }
    if corruption == "interrupted":
        del events[1]
    if corruption == "absent":
        del events[:2]
    if corruption != "absent":
        events.extend([{**e, "attempt": "retry"} for e in first])
    report = assess(events, cases)
    assert not report["timing_groups_passed"]
    assert report["strata"][0]["valid_first_attempts"] == 99


def test_duplicate_receipt_or_unplanned_data_invalidates_assessment():
    cases, events = fixtures()
    events.append(events[1])
    assert (
        assess(events, cases)["anomalies"][0]["reason"] == "orphan_or_duplicate_result"
    )
    assert not assess(events, cases)["timing_groups_passed"]
