"""Restartable exhaustive semantic exploration and separately accounted API replay."""

import argparse
import fcntl
import importlib
import json
import sqlite3
import traceback
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from scripts import coupled_acceptance_model as model


def definition():
    import hashlib

    return {
        "spec": model.SPEC,
        "actions": model.actions(),
        "model_source_sha256": hashlib.sha256(
            Path(model.__file__).read_bytes()
        ).hexdigest(),
    }


@contextmanager
def ledger(path, *, resume=False):
    path = Path(path)
    if path.exists() != resume:
        raise ValueError("New ledger or explicit resume required")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(path.suffix + ".lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not resume:
            path.touch(exist_ok=False)
        db = sqlite3.connect(path)
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.executescript(
                """CREATE TABLE IF NOT EXISTS definition(value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS states(sequence INTEGER PRIMARY KEY, identity TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, parent TEXT, action TEXT, expanded INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS edges(origin TEXT NOT NULL, action_id INTEGER NOT NULL, target TEXT NOT NULL, accepted INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(origin,action_id));
              CREATE TABLE IF NOT EXISTS replay(attempt INTEGER PRIMARY KEY, origin TEXT NOT NULL, action_id INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, evidence TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS unexpanded_queue ON states(sequence) WHERE expanded=0;
              CREATE INDEX IF NOT EXISTS replay_edge ON replay(origin,action_id,attempt);"""
            )
            expected = model.canonical(definition())
            found = db.execute("SELECT value FROM definition").fetchall()
            if not resume:
                with db:
                    db.execute("INSERT INTO definition VALUES(?)", (expected,))
                    state = model.State().json()
                    db.execute(
                        "INSERT INTO states(identity,payload) VALUES(?,?)",
                        (model.digest(state), model.canonical(state)),
                    )
            elif found != [(expected,)]:
                raise ValueError("Model/spec changed; use new evidence")
            yield db
        finally:
            db.close()


def explore(db, *, max_states=None):
    count = 0
    while max_states is None or count < max_states:
        found = db.execute(
            "SELECT identity,payload FROM states WHERE expanded=0 ORDER BY sequence LIMIT 1"
        ).fetchone()
        if found is None:
            break
        key, payload = found
        state = model.State.parse(json.loads(payload))
        with db:
            for action_id, action in enumerate(model.actions()):
                target, result = model.transition(state, action)
                value = target.json()
                identity = model.digest(value)
                db.execute(
                    "INSERT OR IGNORE INTO states(identity,payload,parent,action) VALUES(?,?,?,?)",
                    (identity, model.canonical(value), key, model.canonical(action)),
                )
                db.execute(
                    "INSERT INTO edges VALUES(?,?,?,?,?)",
                    (
                        key,
                        action_id,
                        identity,
                        int(result["accepted"]),
                        result["reason"],
                    ),
                )
            db.execute("UPDATE states SET expanded=1 WHERE identity=?", (key,))
        count += 1
    return report(db)


def trace(db, key):
    path = []
    while True:
        found = db.execute(
            "SELECT parent,action FROM states WHERE identity=?", (key,)
        ).fetchone()
        if not found:
            raise ValueError("Missing BFS predecessor")
        parent, action = found
        if parent is None:
            return list(reversed(path))
        path.append(json.loads(action))
        key = parent


def replay_fingerprint(adapter):
    """Bind observations to implementation/configuration, not just the model."""
    from scripts.acceptance import environment_identity, source_fingerprint

    cls = type(adapter)
    return model.canonical(
        {
            "sources": source_fingerprint(),
            "environment": environment_identity(),
            "adapter": cls.__module__ + ":" + cls.__qualname__,
        }
    )


def bind_replay(db, adapter):
    current = replay_fingerprint(adapter)
    with db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS replay_binding (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, valid INTEGER NOT NULL)"
        )
        previous = db.execute(
            "SELECT fingerprint,valid FROM replay_binding WHERE id=1"
        ).fetchone()
        if previous:
            if previous != (current, 1):
                raise ValueError(
                    "Replay code/config/adapter changed or invalidated; use new replay evidence"
                )
        else:
            if db.execute("SELECT COUNT(*) FROM replay").fetchone()[0]:
                raise ValueError(
                    "Historical unbound replay cannot be adopted as current evidence"
                )
            db.execute("INSERT INTO replay_binding VALUES(1,?,1)", (current,))
    return current


def replay_edges(db, adapter, *, max_edges=None, retry_failed=False):
    """Adapter must reset a fresh PostgreSQL fixture and use real API operations.

    Unsupported operations and fixture setup errors remain BLOCKED; no software
    model response can substitute for an API observation.
    """
    binding = bind_replay(db, adapter)
    count = 0
    for origin, action_id in db.execute(
        "SELECT e.origin,e.action_id FROM edges e JOIN states s ON e.origin=s.identity ORDER BY s.sequence,e.action_id"
    ):
        previous = db.execute(
            "SELECT status FROM replay WHERE origin=? AND action_id=? ORDER BY attempt DESC LIMIT 1",
            (origin, action_id),
        ).fetchone()
        if previous and (previous[0] == "PASSED" or not retry_failed):
            continue
        if max_edges is not None and count >= max_edges:
            break
        with db:
            attempt = db.execute(
                "INSERT INTO replay(origin,action_id,started_at,status,evidence) VALUES(?,?,?,?,?)",
                (origin, action_id, datetime.now(UTC).isoformat(), "RUNNING", "{}"),
            ).lastrowid
        evidence = {
            "prefix": trace(db, origin),
            "action": model.actions()[action_id],
            "replay_binding_hash": model.digest(json.loads(binding)),
        }
        status = "FAILED"
        try:
            setup = adapter.reset(f"{origin}-{action_id}-{attempt}")
            evidence["fixture"] = setup
            if setup.get("backend") != "postgresql":
                raise NotImplementedError("Actual PostgreSQL fixture required")
            state = model.State()
            for action in [*evidence["prefix"], evidence["action"]]:
                expected_state, expected = model.transition(state, action)
                observed = adapter.apply(action)
                if observed.get("projection_complete") is False:
                    evidence["partial_observation"] = observed
                    raise NotImplementedError(
                        "API projection is incomplete; partial observations retained"
                    )
                expected_projection = {
                    "accepted": expected["accepted"],
                    "observation": expected["observation"],
                }
                observed_projection = {k: observed.get(k) for k in expected_projection}
                if observed_projection != expected_projection:
                    evidence.update(
                        expected=expected_projection,
                        observed=observed_projection,
                        failed_action=action,
                    )
                    raise AssertionError(
                        "Actual API response/state disagrees with independent model"
                    )
                state = expected_state
            status = "PASSED"
            evidence["observed_state_hash"] = model.digest(state.json())
        except NotImplementedError as error:
            status = "BLOCKED"
            evidence["error"] = str(error)
        except Exception as error:
            evidence.update(
                error_type=type(error).__name__,
                error=str(error),
                traceback=traceback.format_exc(),
            )
        finally:
            try:
                adapter.close()
            except Exception as error:
                status = "FAILED"
                evidence["cleanup_error"] = str(error)
            with db:
                db.execute(
                    "UPDATE replay SET finished_at=?,status=?,evidence=? WHERE attempt=?",
                    (
                        datetime.now(UTC).isoformat(),
                        status,
                        model.canonical(evidence),
                        attempt,
                    ),
                )
        count += 1
    if replay_fingerprint(adapter) != binding:
        with db:
            db.execute("UPDATE replay_binding SET valid=0 WHERE id=1")
        raise ValueError(
            "Replay implementation changed during execution; observations invalidated"
        )
    return report(db)


def report(db):
    total, expanded = db.execute(
        "SELECT COUNT(*),COALESCE(SUM(expanded),0) FROM states"
    ).fetchone()
    edges = db.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    statuses = dict(db.execute("SELECT status,COUNT(*) FROM replay GROUP BY status"))
    passed = db.execute(
        "SELECT COUNT(*) FROM edges e WHERE (SELECT r.status FROM replay r WHERE r.origin=e.origin AND r.action_id=e.action_id ORDER BY r.attempt DESC LIMIT 1)='PASSED'"
    ).fetchone()[0]
    has_binding = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='replay_binding'"
    ).fetchone()
    binding_valid = bool(
        has_binding
        and db.execute("SELECT valid FROM replay_binding WHERE id=1").fetchone() == (1,)
    )
    recorded_passed = passed
    if not binding_valid:
        passed = 0
    return {
        "replay_binding_valid": binding_valid,
        "recorded_edges_with_pass": recorded_passed,
        "states_discovered": total,
        "states_expanded": expanded,
        "unexpanded_states": total - expanded,
        "edges_enumerated": edges,
        "action_count_per_state": len(model.actions()),
        "replay_attempt_statuses": statuses,
        "edges_with_api_pass": passed,
        "edges_without_api_pass": edges - passed,
        "model_enumeration_complete": total > 0 and total == expanded,
        "coupled_model_api_complete": total > 0
        and total == expanded
        and edges > 0
        and passed == edges,
        "full_task_acceptance": False,
        "outside_model": model.SPEC["outside_model"],
        "initial_and_retry_evidence_retained": True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["explore", "replay", "report"])
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--adapter")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args(argv)
    if args.limit is not None and args.limit <= 0:
        parser.error("Positive explicit exploration/replay limit required")
    with ledger(args.ledger, resume=args.resume) as db:
        if args.action == "explore":
            result = explore(db, max_states=args.limit)
        elif args.action == "replay":
            if not args.adapter:
                parser.error("--adapter module:factory required")
            name, factory = args.adapter.split(":", 1)
            result = replay_edges(
                db,
                getattr(importlib.import_module(name), factory)(),
                max_edges=args.limit,
                retry_failed=args.retry_failed,
            )
        else:
            result = report(db)
    print(json.dumps(result, indent=2))
    return 0 if result["coupled_model_api_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
