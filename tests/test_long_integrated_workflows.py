"""Same-subject publication/accounting/hold integration with explicit gaps."""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

from scripts.long_integrated_restore import SUPPORTED, check_balances, check_work
from scripts.long_integrated_scenario import month, scenario, stamp
from scripts.long_integrated_workflows import LongWorkflowDiagnostics


def test_same_subject_month_publication_leave_actual_and_late_hold(pg):
    adapter = LongWorkflowDiagnostics(pg, person_prefix="long-")
    processed = []
    try:
        adapter.setup()
        for event in scenario():
            if event["recorded_at"][:7] != "2026-02" or event[
                "kind"
            ] not in SUPPORTED | {"publication"}:
                continue
            adapter.apply(event)
            processed.append(event)
        check_balances(
            adapter, processed, "2026-02-28T23:59:59+09:00", "2026-02-28T23:59:59+09:00"
        )
        check_work(adapter, processed)
        assert len(adapter.publications) == 1 and adapter.publications[0]["accepted"]
        assert len(adapter.links) == 4
        hold = next(e for e in scenario() if e["event_id"] == "hold-p0")
        adapter.apply(hold)
        assert adapter.counterexamples[-1]["late_hold_erase_status"] == 409
        assert adapter.counterexamples[-1]["canonical_unchanged"]
        # Distinguish a real preservation reason from an incidental stale plan.
        fresh = adapter.require(
            adapter.api.request(
                adapter.base + "/copies/preview" + adapter.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": "verify-held-subject-plan",
                    "payload": {"person_id": "long-p0"},
                },
            )
        )
        assert fresh["targets"]
        assert all("legal_hold" in row["blockers"] for row in fresh["targets"])
        attempt = next(e for e in scenario() if e["event_id"] == "blocked-erasure-p0")
        result = adapter.apply(attempt)
        assert result["active_hold_confirmed"] and not result["person_control_created"]
    finally:
        adapter.close()


def test_25_month_publication_accounting_and_holds(pg):
    adapter = LongWorkflowDiagnostics(pg, person_prefix="long-")
    processed = []
    excluded = []
    checks = []
    try:
        adapter.setup()
        for index in range(25):
            for event in scenario():
                if event["recorded_at"][:7] != str(month(index))[:7]:
                    continue
                if event["kind"] not in SUPPORTED | {
                    "publication",
                    "hold",
                    "erasure_attempt",
                }:
                    excluded.append(event)
                    continue
                adapter.apply(event)
                processed.append(event)
            cutoff = (
                datetime.fromisoformat(stamp(month(index + 1))) - timedelta(seconds=1)
            ).isoformat()
            checks.append(check_balances(adapter, processed, cutoff, cutoff))
        check_work(adapter, processed)
        assert len(adapter.publications) == 26
        assert all(
            row["accepted"] for row in adapter.publications[:25]
        ), adapter.publications
        assert adapter.publications[-1]["accepted"] is False
        assert adapter.publications[-1]["expected_stop"] == "retroactive-grant-deficit"
        assert adapter.holds == {"p0": 2, "p1": 2}
        assert len(processed) == 293 and len(excluded) == 6
        assert (
            len([v for v in adapter.counterexamples if v.get("active_hold_confirmed")])
            == 2
        )
        assert any(
            row["period"] == "2026-08"
            and row["person"] == "p0"
            and row["kind"] == "night"
            and row["expected_seconds"] == 5 * 3600
            for row in adapter.burden_checks
        )
    finally:
        path = os.getenv("PHARMSHIFT_LONG_WORKFLOW_OUTPUT")
        if path:
            with Path(path).open("x") as output:
                json.dump(
                    {
                        "processed_count": len(processed),
                        "excluded": excluded,
                        "monthly_checks": checks,
                        "publications": adapter.publications,
                        "counterexamples": adapter.counterexamples,
                        "responses": adapter.responses,
                        "burden_checks": adapter.burden_checks,
                        "full_combined_acceptance": False,
                    },
                    output,
                    indent=2,
                    default=str,
                )
        adapter.close()
