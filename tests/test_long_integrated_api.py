"""Real-PG public-API chronology diagnostics, not complete combined acceptance."""

import json
import os
from datetime import datetime, timedelta
from fractions import Fraction
from pathlib import Path

from scripts.long_integrated_api import Clock, LongApiDiagnostics
from scripts.long_integrated_scenario import month, project, scenario, stamp


def test_25_month_same_database_accounting_projection(pg):
    adapter = LongApiDiagnostics(pg)
    events = scenario()
    excluded = []
    processed = []
    checks = []
    evidence = os.getenv("PHARMSHIFT_LONG_DIAGNOSTIC_OUTPUT")
    if evidence and Path(evidence).exists():
        raise FileExistsError(evidence)
    try:
        adapter.setup()
        for index in range(25):
            month_events = [
                e for e in events if e["recorded_at"][:7] == str(month(index))[:7]
            ]
            for event in month_events:
                if event["kind"] not in {
                    "contract",
                    "grant",
                    "reservation",
                    "leave",
                    "hourly_leave",
                    "conversion",
                    "work",
                }:
                    excluded.append(
                        {
                            "event_id": event["event_id"],
                            "kind": event["kind"],
                            "status": "NOT_CONNECTED",
                        }
                    )
                    continue
                adapter.apply(event)
                processed.append(event)
            cutoff = (
                datetime.fromisoformat(stamp(month(index + 1))) - timedelta(seconds=1)
            ).isoformat()
            expected = project(processed, cutoff, cutoff)
            observed, raw = adapter.balances(cutoff, cutoff)
            for row in expected["lots"]:
                lot = observed[row["lot"]]
                assert lot["unreserved"] == Fraction(**row["unreserved"]), (
                    index,
                    row,
                    lot,
                    raw,
                )
                assert lot["reserved"] == Fraction(**row["reserved"]), (
                    index,
                    row,
                    lot,
                    raw,
                )
            checks.append(
                {
                    "month": str(month(index))[:7],
                    "lots": len(expected["lots"]),
                    "status": "PASSED",
                    "expected_lots": expected["lots"],
                    "observed": observed,
                }
            )
        assert len(checks) == 25
        # Later correction does not rewrite what was known at the original date.
        for index in range(25):
            cutoff = (
                datetime.fromisoformat(stamp(month(index + 1))) - timedelta(seconds=1)
            ).isoformat()
            for known in (cutoff, stamp(month(25))):
                expected = project(processed, cutoff, known)
                observed, raw = adapter.balances(cutoff, known)
                for row in expected["lots"]:
                    assert observed[row["lot"]]["unreserved"] == Fraction(
                        **row["unreserved"]
                    ), (index, known, row, observed)
                if known == cutoff and index < 12:
                    obligation = next(
                        o
                        for o in raw["obligations"]
                        if o["obligation_id"] == "obligation-p0-2026"
                    )
                    assert (
                        obligation["taken_half_days"] == index + 1
                    )  # One hour gives no five-day credit.
        # Persisted API intervals, classifications, agreements and method changes
        # feed the actual accounting implementation; expected totals use the
        # independently fixed integer interval oracle.
        work_report = adapter.work_accounting()
        assert not work_report["findings"], work_report["findings"]
        expected_work = project(processed, stamp(month(25)), stamp(month(25)))["work"]
        for expected_row in expected_work:
            rows = [
                r
                for r in work_report["trace"]
                if r["person_id"] == expected_row["person"]
                and r["date"][:7] == expected_row["month"]
            ]
            assert (
                sum(r["work_seconds"] for r in rows) == expected_row["work_seconds"]
            ), (expected_row, rows, work_report["findings"])
            assert (
                sum(r["holiday_seconds"] for r in rows)
                == expected_row["holiday_seconds"]
            ), (expected_row, rows)
        checks.append(
            {
                "calculation": "persisted_work_accounting",
                "expected": expected_work,
                "observed": work_report,
                "status": "PASSED",
            }
        )
        # The external actual source retains revision 1 and 2 rather than replacing
        # the original interval. Check raw persistence independently of accounting.
        from sqlalchemy import select

        from shift_scheduler.db.planning_models import ActualWorkEvent

        with pg() as session:
            rows = list(session.scalars(select(ActualWorkEvent)))
            for event in processed:
                if event["kind"] != "work":
                    continue
                match = [
                    r
                    for r in rows
                    if r.external_id == event["event_id"]
                    and r.revision == event["revision"]
                ]
                assert len(match) == 1
                assert match[0].payload["work"] == [
                    {"start": event["payload"]["start"], "end": event["payload"]["end"]}
                ]
        # Negative controls after the historical deficit: do not weaken balance,
        # per-day, or hourly annual cap constraints to pass the legitimate case.
        Clock.current = datetime.fromisoformat("2028-02-29T12:00:00+09:00")

        def attempt(identity, account, day, unit="half_day", quantity=1, hour=12):
            person = "p0" if account.startswith("p0") else "p1"
            start = datetime.fromisoformat(day + f"T{hour:02}:00:00+09:00")
            end = start + timedelta(hours=quantity if unit == "hour" else 2)
            body = {
                "expected_revision": adapter.revision("leave_account", account),
                "idempotency_key": identity,
                "payload": {
                    "event_id": identity,
                    "account_id": account,
                    "kind": "take",
                    "unit": unit,
                    "quantity": quantity,
                    "effective_on": day,
                    "policy_id": f"policy-{person}-2028",
                    "evidence": adapter.ev,
                    "interval": {"start": start.isoformat(), "end": end.isoformat()},
                },
            }
            reply = adapter.api.request(
                "/planning/compliance/leave-events" + adapter.query, body
            )
            adapter.responses.append(
                {"status": reply.status_code, "body": reply.json()}
            )
            return reply

        assert (
            attempt("reject-expired-deficit", "p0-2026", "2028-02-21").status_code
            == 422
        )
        # Already 0.5 day was taken on this day. A second half is legal, a third is not.
        assert (
            attempt("legal-second-half", "p1-2027-b", "2028-02-21", hour=12).status_code
            == 200
        )
        third = attempt("reject-third-half", "p1-2027-b", "2028-02-21", hour=15)
        assert third.status_code == 422 and "one equivalent workday" in third.text
        adapter.write(
            "/records/leave_account",
            {
                "account_id": "p1-hourly-test",
                "person_id": "p1",
                "employer_id": "hospital",
                "granted_on": "2028-02-01",
                "expires_on": "2030-02-01",
                "statutory_days": 6,
                "granted_days": 6,
                "evidence": adapter.ev,
            },
            "hourly-contrast-account",
        )
        adapter.recording(
            "leave_account",
            "p1-hourly-test",
            "2028-02-01T12:00:00+09:00",
            "hourly-contrast",
        )
        for day in range(1, 6):
            legal = attempt(
                f"legal-hourly-{day}",
                "p1-hourly-test",
                f"2028-02-{day:02}",
                unit="hour",
                quantity=6,
                hour=9,
            )
            assert legal.status_code == 200, legal.text
        excess = attempt(
            "reject-hourly-31",
            "p1-hourly-test",
            "2028-02-07",
            unit="hour",
            quantity=1,
            hour=9,
        )
        assert excess.status_code == 422, excess.text
        assert adapter.revision("leave_record", "reject-hourly-31") == 0

    finally:
        if evidence:
            Path(evidence).parent.mkdir(parents=True, exist_ok=True)
            Path(evidence).write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "months_checked": checks,
                        "processed_event_count": len(processed),
                        "excluded_events": excluded,
                        "api_responses": adapter.responses,
                        "full_25_month_acceptance": False,
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                )
                + "\n"
            )
        adapter.close()
