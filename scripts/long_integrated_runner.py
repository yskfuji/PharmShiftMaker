"""Run a frozen 25-month protocol without substituting simulation for API proof.

An adapter supplies an actual PostgreSQL identity, test clock, idempotent public
API operations, and observations. Unsupported kinds stop the run at their exact
position. First failure is append-only; resume reuses the same event key and
requires adapter recovery, never assumes a lost response was a rollback.
"""

import argparse
import fcntl
import hashlib
import importlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


@contextmanager
def journal(path, protocol, *, resume=False):
    path = Path(path)
    if path.exists() != resume:
        raise ValueError("Existing evidence requires explicit resume")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(".lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not resume:
            path.touch(exist_ok=False)
        db = sqlite3.connect(path)
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.executescript(
                """CREATE TABLE IF NOT EXISTS protocol(hash TEXT PRIMARY KEY,body TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS binding(identity TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY,body TEXT NOT NULL,event_key TEXT UNIQUE NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING');
              CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,sequence INTEGER NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,evidence TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS checks(id INTEGER PRIMARY KEY,month TEXT NOT NULL,phase TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL);"""
            )
            if not resume:
                with db:
                    db.execute(
                        "INSERT INTO protocol VALUES(?,?)",
                        (digest(protocol), canonical(protocol)),
                    )
                    for index, event in enumerate(protocol["events"]):
                        key = digest(
                            {
                                "protocol": digest(protocol),
                                "sequence": index,
                                "event": event,
                            }
                        )
                        db.execute(
                            "INSERT INTO events(sequence,body,event_key) VALUES(?,?,?)",
                            (index, canonical(event), key),
                        )
            elif db.execute("SELECT hash FROM protocol").fetchall() != [
                (digest(protocol),)
            ]:
                raise ValueError("Frozen event protocol changed; use a new run")
            yield db
        finally:
            db.close()


def run(db, adapter, *, max_events=None):
    protocol = json.loads(db.execute("SELECT body FROM protocol").fetchone()[0])
    identity = adapter.attach()
    if identity.get("backend") != "postgresql" or not identity.get(
        "database_instance_id"
    ):
        raise ValueError("Actual isolated PostgreSQL database identity required")
    old = db.execute("SELECT identity FROM binding").fetchall()
    if old and old != [(canonical(identity),)]:
        raise ValueError("Resume points to a different database/clock fixture")
    if not old:
        with db:
            db.execute("INSERT INTO binding VALUES(?)", (canonical(identity),))
    if not check_ready_months(db, adapter, protocol):
        return report(db)
    count = 0
    for index, body, key, state in db.execute(
        "SELECT sequence,body,event_key,state FROM events ORDER BY sequence"
    ).fetchall():
        if state == "APPLIED":
            continue
        if max_events is not None and count >= max_events:
            break
        event = json.loads(body)
        status = "FAILED"
        evidence = {}
        with db:
            attempt = db.execute(
                "INSERT INTO attempts(sequence,started_at,status,evidence) VALUES(?,?,?,?)",
                (index, datetime.now(UTC).isoformat(), "RUNNING", "{}"),
            ).lastrowid
        try:
            # Clock is controlled only by the isolated adapter. Application checks
            # remain intact; event recorded times are not rewritten to real time.
            adapter.advance_clock(event["recorded_at"])
            recovered = adapter.lookup(key)
            observed = recovered if recovered is not None else adapter.apply(event, key)
            evidence = {
                "event_key": key,
                "recovered": recovered is not None,
                "response": observed,
            }
            if not observed.get("committed") or not (
                observed.get("public_api_evidence")
                or (
                    event["kind"] in {"restore", "backup", "backup_expiry"}
                    and observed.get("authorized_cli_evidence")
                )
            ):
                raise AssertionError("Missing real API/commit evidence")
            if observed.get("event_digest") != digest(event):
                raise AssertionError("Recovered event body does not match frozen event")
            if event["kind"] == "erasure_attempt":
                if observed.get("accepted") is not False:
                    raise AssertionError("Hold did not reject erasure")
            elif observed.get("accepted") is not True:
                raise AssertionError("Required operation was rejected")
            if event["kind"] == "restore" and not observed.get(
                "physical_restore_evidence"
            ):
                raise NotImplementedError(
                    "Control overlay alone is not complete database/file restore"
                )
            status = "PASSED"
        except NotImplementedError as error:
            status = "BLOCKED"
            evidence["error"] = str(error)
        except Exception as error:
            evidence.update(error_type=type(error).__name__, error=str(error))
        with db:
            db.execute(
                "UPDATE attempts SET finished_at=?,status=?,evidence=? WHERE id=?",
                (datetime.now(UTC).isoformat(), status, canonical(evidence), attempt),
            )
            if status == "PASSED":
                db.execute(
                    "UPDATE events SET state='APPLIED' WHERE sequence=?", (index,)
                )
        count += 1
        if status != "PASSED":
            break
        if not check_ready_months(db, adapter, protocol):
            break
    return report(db)


def check_ready_months(db, adapter, protocol):
    complete = (
        db.execute("SELECT COUNT(*) FROM events WHERE state!='APPLIED'").fetchone()[0]
        == 0
    )
    for phase in ("AS_KNOWN", "RESTATED") if complete else ("AS_KNOWN",):
        for target in protocol["monthly_expected"]:
            month = target["month"]
            month_events = [
                json.loads(body)
                for body, state in db.execute("SELECT body,state FROM events")
                if json.loads(body)["recorded_at"][:7] == month and state != "APPLIED"
            ]
            if month_events:
                continue
            latest = db.execute(
                "SELECT status FROM checks WHERE month=? AND phase=? ORDER BY id DESC LIMIT 1",
                (month, phase),
            ).fetchone()
            if latest and latest[0] == "PASSED":
                continue
            known = (
                target["clock"]
                if phase == "AS_KNOWN"
                else protocol["end_exclusive"] + "T00:00:00+09:00"
            )
            expected = target["as_known"] if phase == "AS_KNOWN" else target["restated"]
            status = "PASSED"
            evidence = {}
            try:
                actual = adapter.observe(target["clock"], known)
                evidence = {"expected": expected, "observed": actual}
                if actual != expected:
                    raise AssertionError("Independent monthly oracle differs")
            except NotImplementedError as error:
                status = "BLOCKED"
                evidence["error"] = str(error)
            except Exception as error:
                status = "FAILED"
                evidence["error"] = str(error)
            with db:
                db.execute(
                    "INSERT INTO checks(month,phase,status,evidence) VALUES(?,?,?,?)",
                    (month, phase, status, canonical(evidence)),
                )
            if status != "PASSED":
                return False
    return True


def report(db):
    events = dict(db.execute("SELECT state,COUNT(*) FROM events GROUP BY state"))
    attempts = dict(db.execute("SELECT status,COUNT(*) FROM attempts GROUP BY status"))
    passed = {
        phase: db.execute(
            "SELECT COUNT(*) FROM checks c WHERE c.phase=? AND c.status='PASSED' AND c.id=(SELECT MAX(last.id) FROM checks last WHERE last.month=c.month AND last.phase=c.phase)",
            (phase,),
        ).fetchone()[0]
        for phase in ("AS_KNOWN", "RESTATED")
    }
    protocol = json.loads(db.execute("SELECT body FROM protocol").fetchone()[0])
    total = len(protocol["events"])
    complete = events.get("APPLIED", 0) == total and passed == {
        "AS_KNOWN": protocol["months"],
        "RESTATED": protocol["months"],
    }
    return {
        "events": total,
        "event_states": events,
        "attempt_statuses": attempts,
        "monthly_checks_passed": passed,
        "continuous_events_complete": events.get("APPLIED", 0) == total,
        "25_month_event_acceptance_complete": complete,
        "separate_required_evidence": [
            "all_specified_faults",
            "full_restore_RPO_RTO",
            "all_model_edges",
        ],
        "first_failures_retained": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["run", "report"])
    parser.add_argument("--protocol", required=True)
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--adapter")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    protocol = json.loads(Path(args.protocol).read_text())
    with journal(args.ledger, protocol, resume=args.resume) as db:
        if args.action == "run":
            if not args.adapter:
                parser.error("--adapter module:factory is required")
            module, factory = args.adapter.split(":", 1)
            adapter = getattr(importlib.import_module(module), factory)()
            try:
                result = run(db, adapter, max_events=args.limit)
            finally:
                adapter.close()
        else:
            result = report(db)
    print(json.dumps(result, indent=2))
    return 0 if result["25_month_event_acceptance_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
