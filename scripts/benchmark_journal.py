"""Append-only attempt evidence for interrupted, local performance runs.

A START without a RESULT remains interrupted evidence. A later attempt never
replaces it. This ledger alone does not authorize performance acceptance.
"""

import fcntl
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


class Journal:
    def __init__(self, path, configuration, *, resume=False):
        path = Path(path)
        if path.exists() != resume:
            raise ValueError("Use a new journal, or explicitly resume an existing one")
        if not resume:
            path.touch(exist_ok=False)
        # A separate inode avoids interfering with SQLite's platform VFS locks.
        self.lock = path.with_suffix(path.suffix + ".lock").open("ab")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise ValueError("Another benchmark runner owns this journal") from None
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS run (configuration TEXT NOT NULL)")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, attempt TEXT NOT NULL, case_key TEXT NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS case_checkpoints (sequence INTEGER PRIMARY KEY, case_key TEXT NOT NULL, phase TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        encoded = json.dumps(configuration, sort_keys=True)
        found = self.db.execute("SELECT configuration FROM run").fetchall()
        if not resume:
            self.db.execute("INSERT INTO run VALUES (?)", (encoded,))
            self.db.commit()
        elif found != [(encoded,)]:
            self.db.close()
            self.lock.close()
            raise ValueError("Run configuration or source changed; use new evidence")

    def _append(self, attempt, key, kind, payload):
        with self.db:
            self.db.execute(
                "INSERT INTO events(attempt,case_key,kind,recorded_at,payload) VALUES (?,?,?,?,?)",
                (
                    attempt,
                    key,
                    kind,
                    datetime.now(UTC).isoformat(),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )

    def succeeded(self, key):
        return any(
            json.loads(r[0]).get("success") is True
            for r in self.db.execute(
                "SELECT payload FROM events WHERE case_key=? AND kind='RESULT'", (key,)
            )
        )

    def first_attempt_succeeded(self, key):
        first = self.db.execute(
            "SELECT attempt FROM events WHERE case_key=? AND kind='START' ORDER BY sequence LIMIT 1",
            (key,),
        ).fetchone()
        if first is None:
            return False
        result = self.db.execute(
            "SELECT payload FROM events WHERE attempt=? AND kind='RESULT'", first
        ).fetchone()
        return result is not None and json.loads(result[0]).get("success") is True

    def start(self, key, descriptor):
        identity = uuid4().hex
        self._append(identity, key, "START", descriptor)
        return identity

    def case_state(self, key):
        state = {}
        for phase, payload in self.db.execute(
            "SELECT phase,payload FROM case_checkpoints WHERE case_key=? ORDER BY sequence",
            (key,),
        ):
            state.update(json.loads(payload))
            state["phase"] = phase
        return state

    def checkpoint(self, key, phase, payload):
        phases = ("GENERATED", "REGISTERED", "ACCEPTED", "COMMITTED", "OBSERVED")
        if phase not in phases:
            raise ValueError("Unknown benchmark checkpoint")
        previous = self.case_state(key)
        current = previous.get("phase")
        target = phases.index(phase)
        if current is None and target != 0:
            raise ValueError("Checkpoint requires a generated case")
        if current is not None and target not in (
            phases.index(current),
            phases.index(current) + 1,
        ):
            raise ValueError("Checkpoint cannot skip or reverse a phase")
        immutable = (
            "input_hash",
            "snapshot",
            "request_key",
            "job_id",
            "budget_seconds",
            "registered_input_hash",
            "persisted_observed_at",
            "terminal_status",
        )
        for field in immutable:
            if (
                field in payload
                and field in previous
                and payload[field] != previous[field]
            ):
                raise ValueError("Immutable case checkpoint changed: " + field)
        merged = {**previous, **payload}
        required = {
            "GENERATED": ("input_hash", "snapshot", "request_key", "budget_seconds"),
            "REGISTERED": ("registered_input_hash",),
            "ACCEPTED": ("job_id",),
            "COMMITTED": ("persisted_observed_at", "terminal_status"),
            "OBSERVED": ("observation_hash", "timing_complete"),
        }
        for checked in phases[: target + 1]:
            if any(
                field not in merged or merged[field] is None
                for field in required[checked]
            ):
                raise ValueError("Missing checkpoint evidence: " + checked)
        if (
            not merged["input_hash"]
            or not merged["request_key"]
            or not isinstance(merged["snapshot"], dict)
        ):
            raise ValueError("Invalid input identity")
        if (
            not isinstance(merged["budget_seconds"], int)
            or isinstance(merged["budget_seconds"], bool)
            or merged["budget_seconds"] <= 0
        ):
            raise ValueError("Invalid calculation budget")
        if target >= 1 and merged["registered_input_hash"] != merged["input_hash"]:
            raise ValueError("Registration evidence belongs to another input")
        if target >= 2 and not merged["job_id"]:
            raise ValueError("Missing job identity")
        if target >= 3:
            if merged["terminal_status"] not in (
                "FEASIBLE",
                "OPTIMAL",
                "UNKNOWN",
                "INFEASIBLE",
                "MODEL_INVALID",
                "FAILED",
                "CANCELLED",
            ):
                raise ValueError("Commit evidence must be terminal")
            if (
                datetime.fromisoformat(
                    merged["persisted_observed_at"].replace("Z", "+00:00")
                ).tzinfo
                is None
            ):
                raise ValueError("Commit observation must have a timezone")
        if target >= 4 and (
            not isinstance(merged["timing_complete"], bool)
            or len(merged["observation_hash"]) != 64
        ):
            raise ValueError("Invalid observation evidence")
        if current == phase:
            if any(
                field in previous and previous[field] != value
                for field, value in payload.items()
            ):
                raise ValueError("Existing checkpoint evidence cannot be replaced")
            if all(previous.get(field) == value for field, value in payload.items()):
                return
        with self.db:
            self.db.execute(
                "INSERT INTO case_checkpoints(case_key,phase,recorded_at,payload) VALUES (?,?,?,?)",
                (
                    key,
                    phase,
                    datetime.now(UTC).isoformat(),
                    json.dumps(payload, sort_keys=True),
                ),
            )

    def finish(self, identity, key, result):
        events = self.db.execute(
            "SELECT case_key,kind FROM events WHERE attempt=? ORDER BY sequence",
            (identity,),
        ).fetchall()
        if events != [(key, "START")]:
            raise ValueError("A result must complete exactly one unfinished attempt")
        self._append(identity, key, "RESULT", result)

    def close(self):
        self.db.close()
        self.lock.close()
