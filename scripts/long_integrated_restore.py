"""Read/write source and read-only verification callbacks for physical restore.

The 25-month accounting chronology shares the physically restored database with
the separate erasure fixture. This does not connect the chronology's unsupported
publication/erasure events, nor certify all specified combined fault boundaries.
"""

import json
from datetime import UTC, datetime, timedelta
from fractions import Fraction
from hashlib import sha256
from pathlib import Path

from scripts.long_integrated_api import LongApiDiagnostics
from scripts.long_integrated_scenario import month, project, scenario, stamp
from sqlalchemy import select

from shift_scheduler.db.compliance_models import ComplianceEntity, ComplianceRevision
from shift_scheduler.db.planning_models import ActualWorkEvent, PlanningInput

SUPPORTED = {
    "contract",
    "grant",
    "reservation",
    "leave",
    "hourly_leave",
    "conversion",
    "work",
}


def serialized(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
    )


def digest(value):
    return sha256(serialized(value).encode()).hexdigest()


def content(factory):
    """Preserve complete rows, original revisions, timestamps and input hashes."""
    with factory() as session:
        entities = list(
            session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == "hospital/a"
                )
            )
        )
        keys = [row.key for row in entities]
        groups = {
            "compliance_entities": entities,
            "compliance_revisions": list(
                session.scalars(
                    select(ComplianceRevision).where(
                        ComplianceRevision.entity_key.in_(keys)
                    )
                )
            ),
            "actual_work_events": list(
                session.scalars(
                    select(ActualWorkEvent).where(
                        ActualWorkEvent.scope_id == "hospital/a"
                    )
                )
            ),
            "planning_inputs_v3": [
                r
                for r in session.scalars(
                    select(PlanningInput).where(PlanningInput.scope_id == "hospital/a")
                )
                if r.payload.get("schema_version") == 3
            ],
        }
        result = {}
        for name, rows in groups.items():
            values = [
                {c.name: getattr(row, c.name) for c in row.__table__.columns}
                for row in rows
            ]
            values.sort(key=serialized)
            result[name] = {"count": len(values), "sha256": digest(values)}
        return result


def receipt(factory, key=None):
    with factory() as session:
        # work_terms is committed atomically with ActualWorkEvent (which has no
        # receipt timestamp). Include it so a later actual is not hidden behind
        # the last leave event. Stable key ordering resolves equal timestamps.
        query = select(ComplianceEntity).where(
            ComplianceEntity.scope_id == "hospital/a",
            ComplianceEntity.kind.in_(
                [
                    "leave_record",
                    "grant_amendment",
                    "work_terms",
                    "contract",
                    "employment",
                ]
            ),
        )
        if key:
            query = query.where(ComplianceEntity.key == key)
        row = session.scalars(
            query.order_by(ComplianceEntity.created_at.desc(), ComplianceEntity.key)
        ).first()
        if row is None:
            raise AssertionError("No confirmed canonical business event")
        return {
            "table": "compliance_entities",
            "kind": row.kind,
            "key": row.key,
            "entity_id": row.entity_id,
            "revision": row.revision,
            "payload_sha256": digest(row.payload),
            "recorded_at": row.created_at.astimezone(UTC).isoformat(),
        }


def check_balances(adapter, events, effective, known):
    expected = project(events, effective, known)
    observed, raw = adapter.balances(effective, known)
    for row in expected["lots"]:
        for field in ("unreserved", "reserved"):
            assert observed[row["lot"]][field] == Fraction(**row[field]), (
                effective,
                known,
                row,
                observed,
            )
    return {
        "effective_at": effective,
        "known_at": known,
        "expected": expected["lots"],
        "observed": observed,
        "status": "PASSED",
    }


def check_work(adapter, events):
    report = adapter.work_accounting()
    assert not report["findings"], report["findings"]
    expected = project(events, stamp(month(25)), stamp(month(25)))["work"]
    for expected_row in expected:
        rows = [
            r
            for r in report["trace"]
            if r["person_id"] == expected_row["person"]
            and r["date"][:7] == expected_row["month"]
        ]
        for field in ("work_seconds", "holiday_seconds"):
            assert sum(r[field] for r in rows) == expected_row[field], (
                expected_row,
                rows,
            )
    # Accounting's latest projection must not hide loss of an earlier actual.
    with adapter.factory() as session:
        rows = list(
            session.scalars(
                select(ActualWorkEvent).where(ActualWorkEvent.scope_id == adapter.scope)
            )
        )
        for event in events:
            if event["kind"] != "work":
                continue
            matches = [
                r
                for r in rows
                if r.external_id == event["event_id"]
                and r.revision == event["revision"]
            ]
            assert len(matches) == 1
            assert matches[0].payload["work"] == [
                {"start": event["payload"]["start"], "end": event["payload"]["end"]}
            ]
    return {"status": "PASSED", "expected": expected, "observed": report}


def setup(factory, output):
    """Only a fresh, explicitly owned restore database may be reset by this call."""
    adapter = LongApiDiagnostics(
        factory, allow_owned_database=True, person_prefix="long-"
    )
    events = scenario()
    processed = []
    excluded = []
    checks = []
    try:
        adapter.setup()
        for index in range(25):
            for event in events:
                if event["recorded_at"][:7] != str(month(index))[:7]:
                    continue
                if event["kind"] not in SUPPORTED:
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
            checks.append(check_balances(adapter, processed, cutoff, cutoff))
        committed = receipt(factory)
        committed["observed_at"] = datetime.now(UTC).isoformat()
        proof = {
            "schema_version": 1,
            "subjects": ["long-p0", "long-p1"],
            "operator": "long-operator",
            "protocol_sha256": digest(events),
            "processed_events": processed,
            "excluded_events": excluded,
            "mapping": adapter.mapping,
            "monthly_expected": checks,
            "work_check": check_work(adapter, processed),
            "canonical_tables": content(factory),
            "business_receipt": committed,
            "full_specified_combined_acceptance": False,
            "limits": [
                "Publication/erasure/hold/backup domain events remain unconnected to the fixed chronology.",
                "Physical restore and shared-erasure fixture are assessed by the outer harness.",
                "Test clocks apply only to ledger input validation; receipt timestamps are actual database wall time.",
            ],
        }
        target = Path(output) / "canonical-25-month-source.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x") as stream:
            stream.write(
                json.dumps(proof, ensure_ascii=False, indent=2, default=str) + "\n"
            )
        return proof
    finally:
        adapter.close()


def verify(factory, proof, phase="after_restore"):
    """No reset/write: inspect the same committed rows and historical API views."""
    assert (
        digest(scenario()) == proof["protocol_sha256"]
    ), "Protocol changed after source creation"
    actual = content(factory)
    assert actual == proof["canonical_tables"], (
        phase,
        proof["canonical_tables"],
        actual,
    )
    recovered = receipt(factory, proof["business_receipt"]["key"])
    assert recovered == {
        k: v for k, v in proof["business_receipt"].items() if k != "observed_at"
    }
    adapter = LongApiDiagnostics(
        factory, allow_owned_database=True, person_prefix="long-"
    )
    try:
        adapter.mapping = proof["mapping"]
        adapter.api.attach_existing()
        checks = []
        for index in range(25):
            cutoff = (
                datetime.fromisoformat(stamp(month(index + 1))) - timedelta(seconds=1)
            ).isoformat()
            for known in (cutoff, stamp(month(25))):
                checks.append(
                    check_balances(adapter, proof["processed_events"], cutoff, known)
                )
        work = check_work(adapter, proof["processed_events"])
        assert (
            content(factory) == actual
        ), "Readback unexpectedly changed canonical business rows"
        return {
            "phase": phase,
            "status": "PASSED",
            "canonical_tables": actual,
            "business_receipt": recovered,
            "historical_checks": checks,
            "work_check": work,
            "full_specified_combined_acceptance": False,
        }
    finally:
        adapter.close()
