"""Local acceptance orchestration. A passing diagnostic never closes a missing gate.

Usage: python -m scripts.acceptance preflight|run|resume|report ...
Commands are argument lists (never shell), results are append-only attempts, and
resume rejects changed code/config. No remote execution or evidence upload.
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from collections import Counter
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "ops/acceptance-cases.json"
FAULT_OPT_INS = {
    "isolated_network_faults": "PHARMSHIFT_TEST_NETWORK_FAULTS",
    "isolated_tmpfs_faults": "PHARMSHIFT_TEST_TMPFS_FAULTS",
    "isolated_full_restore": "PHARMSHIFT_TEST_FULL_RESTORE",
}


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def read_spec(path):
    spec = json.loads(Path(path).read_text())
    cases = spec["cases"]
    if spec.get("version") != 1 or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("Unique versioned acceptance cases required")
    by_id = {c["id"]: c for c in cases}
    visiting, visited = set(), set()

    def visit(key):
        if key not in by_id or key in visiting:
            raise ValueError("Missing dependency or cyclic acceptance graph")
        if key in visited:
            return
        visiting.add(key)
        case = by_id[key]
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", key):
            raise ValueError("Safe stable case identifier required")
        if not case.get("requirements") or not case.get("criterion"):
            raise ValueError("Requirement mapping and criterion required")
        if case["kind"] not in {"diagnostic", "acceptance"}:
            raise ValueError("Explicit diagnostic/acceptance distinction required")
        if case.get("command") is not None and (
            not isinstance(case["command"], list)
            or not case["command"]
            or any(not isinstance(s, str) or not s for s in case["command"])
        ):
            raise ValueError("Command must be a nonempty argument list")
        for parent in case.get("requires", []):
            visit(parent)
        visiting.remove(key)
        visited.add(key)

    for key in by_id:
        visit(key)
    return spec


def source_fingerprint(root=ROOT):
    from scripts.benchmark_manifest import build_manifest

    files = build_manifest(root, configuration={}, workload={})["source_hashes"]
    for path in sorted((root / "tests").rglob("*.py")):
        if path.is_file() and not path.is_symlink():
            files[str(path.relative_to(root))] = hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
    return files


def availability(case):
    issues = []
    if not case.get("command"):
        issues.append("NOT_IMPLEMENTED")
    for capability in case.get("environment", []):
        if capability == "isolated_postgres":
            url = os.getenv("PHARMSHIFT_TEST_PG_URL", "")
            from sqlalchemy.engine import make_url

            try:
                parsed = make_url(url)
                valid = parsed.host in {"127.0.0.1", "localhost"} and (
                    parsed.database or ""
                ).startswith("pharmshift_audit")
            except Exception:
                valid = False
            if not valid:
                issues.append("ISOLATED_POSTGRES_REQUIRED")
        elif capability in FAULT_OPT_INS:
            if os.getenv(FAULT_OPT_INS[capability]) != "1":
                issues.append("EXPLICIT_FAULT_OPT_IN_REQUIRED:" + capability)
        elif capability == "owned_native_pg_dump":
            executable = os.getenv("PHARMSHIFT_TEST_PG_DUMP", "")
            if (
                not executable
                or not Path(executable).is_file()
                or not os.access(executable, os.X_OK)
            ):
                issues.append("OWNED_NATIVE_PG_DUMP_REQUIRED")
        else:
            issues.append("UNVERIFIED_ENVIRONMENT:" + capability)
    return issues


def environment_identity():
    from sqlalchemy.engine import make_url

    target = os.getenv("PHARMSHIFT_TEST_PG_URL")
    if target:
        parsed = make_url(target)
        target = {
            key: getattr(parsed, key)
            for key in ("drivername", "host", "port", "database", "username")
        }
    from importlib.metadata import PackageNotFoundError, version

    dependencies = {}
    for package in (
        "pytest",
        "SQLAlchemy",
        "fastapi",
        "ortools",
        "psycopg",
        "pydantic",
    ):
        try:
            dependencies[package] = version(package)
        except PackageNotFoundError:
            dependencies[package] = None
    return {
        "search_workers": os.getenv("PHARMSHIFT_SEARCH_WORKERS"),
        "fault_opt_ins": {
            key: os.getenv(value) for key, value in FAULT_OPT_INS.items()
        },
        "pg_dump": {
            "path": os.getenv("PHARMSHIFT_TEST_PG_DUMP"),
            "sha256": (
                hashlib.sha256(
                    Path(os.environ["PHARMSHIFT_TEST_PG_DUMP"]).read_bytes()
                ).hexdigest()
                if os.getenv("PHARMSHIFT_TEST_PG_DUMP")
                and Path(os.environ["PHARMSHIFT_TEST_PG_DUMP"]).is_file()
                else None
            ),
            "owned_container": os.getenv("PHARMSHIFT_AUDIT_PG_CONTAINER"),
        },
        "python": sys.version,
        "database_target": target,
        "dependencies": dependencies,
    }


def preflight(spec):
    return {
        "cases": [
            {
                "id": c["id"],
                "kind": c["kind"],
                "requirements": c["requirements"],
                "state": (
                    "NOT_IMPLEMENTED"
                    if not c.get("command")
                    else "BLOCKED" if availability(c) else "READY"
                ),
                "issues": availability(c),
                "dependencies": c.get("requires", []),
            }
            for c in spec["cases"]
        ],
        "acceptance_complete": False,
        "boundary": "Readiness is not execution or acceptance; no generated pass evidence",
    }


@contextmanager
def run_lock(path):
    with (path / "owner.lock").open("ab") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ValueError("Another runner owns this run") from exc
        yield lock.fileno()


def create_run(path, spec, selected, fingerprint=None):
    known = {c["id"] for c in spec["cases"]}
    if not set(selected) <= known:
        raise ValueError("Unknown selected acceptance case")
    path.mkdir(parents=True, exist_ok=False)
    manifest = {
        "run_id": uuid4().hex,
        "created_at": datetime.now(UTC).isoformat(),
        "spec": spec,
        "selected": selected,
        "sources": source_fingerprint() if fingerprint is None else fingerprint,
        "environment": environment_identity(),
        "boundary": "Execution provenance only; full resource/image evidence is a separate required case",
    }
    manifest["manifest_hash"] = digest(manifest)
    (path / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    with sqlite3.connect(path / "ledger.sqlite") as db:
        db.execute("PRAGMA synchronous=FULL")
        db.execute(
            "CREATE TABLE events(seq INTEGER PRIMARY KEY,case_id TEXT NOT NULL,attempt TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL)"
        )
    return manifest


def append(db, case, attempt, kind, payload):
    with db:
        db.execute(
            "INSERT INTO events(case_id,attempt,kind,at,payload) VALUES(?,?,?,?,?)",
            (
                case,
                attempt,
                kind,
                datetime.now(UTC).isoformat(),
                json.dumps(payload, ensure_ascii=False),
            ),
        )


def owner_active(path):
    """Observe kernel ownership, never infer a live run from an old PID or time.

    The child inherits this lock, so parent death alone does not mean that the
    command stopped. This is an instantaneous observation, not a liveness SLA.
    """
    try:
        lock = (path / "owner.lock").open("rb")
    except FileNotFoundError:
        return False
    with lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(lock, fcntl.LOCK_UN)
        return False


def report(path):
    manifest = json.loads((path / "manifest.json").read_text())
    original = manifest.pop("manifest_hash")
    if digest(manifest) != original:
        raise ValueError("Run manifest changed")
    with sqlite3.connect(
        (path / "ledger.sqlite").resolve().as_uri() + "?mode=ro", uri=True
    ) as db:
        events = db.execute(
            "SELECT case_id,attempt,kind,payload FROM events ORDER BY seq"
        ).fetchall()
    attempts = {}
    known = {c["id"] for c in manifest["spec"]["cases"]}
    for case, identity, kind, payload in events:
        if case not in known:
            raise ValueError("Unplanned case in execution ledger")
        value = json.loads(payload)
        if kind == "START":
            if identity in attempts:
                raise ValueError("Duplicate attempt")
            attempts[identity] = {"case": case, "start": value, "result": None}
        elif kind == "RESULT":
            if (
                identity not in attempts
                or attempts[identity]["result"] is not None
                or attempts[identity]["case"] != case
            ):
                raise ValueError("Orphan/duplicate result")
            attempts[identity]["result"] = value
        else:
            raise ValueError("Unknown ledger event")
    active = owner_active(path)
    # An earlier abandoned attempt remains interrupted even when a later
    # command now owns the run. Only the last started attempt can be active.
    last_attempt = next(reversed(attempts), None)
    states = {}
    rows = []
    for case in manifest["spec"]["cases"]:
        relevant = [
            {"attempt": identity, **value}
            for identity, value in attempts.items()
            if value["case"] == case["id"]
        ]
        latest = relevant[-1]["result"] if relevant else None
        if not case.get("command"):
            state = "NOT_IMPLEMENTED"
        elif relevant and latest is None:
            state = (
                "RUNNING"
                if active and relevant[-1]["attempt"] == last_attempt
                else "INTERRUPTED"
            )
        elif latest:
            log = (path / latest["log"]).resolve()
            intact = (
                latest.get("execution_context_intact") is True
                and log.parent == path.resolve()
                and log.is_file()
                and hashlib.sha256(log.read_bytes()).hexdigest() == latest["log_sha256"]
            )
            state = "PASSED" if latest["exit_code"] == 0 and intact else "FAILED"
        else:
            state = "NOT_RUN"
        states[case["id"]] = state
        rows.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "requirements": case["requirements"],
                "state": state,
                "attempts": relevant,
                "criterion": case["criterion"],
            }
        )
    by_id = {c["id"]: c for c in manifest["spec"]["cases"]}
    by_row = {r["id"]: r for r in rows}
    visited = set()

    def dependencies(key):
        if key in visited:
            return
        case, row = by_id[key], by_row[key]
        for parent in case.get("requires", []):
            dependencies(parent)
        row["unsatisfied_dependencies"] = [
            parent
            for parent in case.get("requires", [])
            if by_row[parent]["state"] != "PASSED"
        ]
        if row["state"] == "PASSED" and row["unsatisfied_dependencies"]:
            row["state"] = "BLOCKED"
        visited.add(key)

    for key in by_id:
        dependencies(key)
    required = [r for r in rows if r["kind"] == "acceptance"]
    return {
        "run_id": manifest["run_id"],
        "manifest_hash": original,
        "cases": rows,
        "owner_active_at_observation": active,
        "counts": dict(Counter(r["state"] for r in rows)),
        "selected_complete": bool(manifest["selected"])
        and all(by_row[key]["state"] == "PASSED" for key in manifest["selected"]),
        "acceptance_complete": bool(required)
        and all(r["state"] == "PASSED" for r in required),
        "note": "All attempts retained. Performance first-attempt criteria must additionally pass acceptance_assessment.",
    }


def execute(path, *, fingerprint=None):
    with run_lock(path) as ownership_fd:
        manifest = json.loads((path / "manifest.json").read_text())
        supplied = manifest.pop("manifest_hash")
        if digest(manifest) != supplied:
            raise ValueError("Manifest integrity failure")
        if manifest["sources"] != (
            source_fingerprint() if fingerprint is None else fingerprint
        ):
            raise ValueError(
                "Code/config changed; create a new run, never resume mixed versions"
            )
        if manifest["environment"] != environment_identity():
            raise ValueError("Runtime/database target/search worker setting changed")

        def context_intact():
            return (
                manifest["sources"]
                == (source_fingerprint() if fingerprint is None else fingerprint)
                and manifest["environment"] == environment_identity()
            )

        selected = set(manifest["selected"])
        by_id = {c["id"]: c for c in manifest["spec"]["cases"]}

        def include(key):
            for parent in by_id[key].get("requires", []):
                if parent not in selected:
                    selected.add(parent)
                    include(parent)

        for key in list(selected):
            include(key)
        pending = set(selected)
        with sqlite3.connect(path / "ledger.sqlite") as db:
            db.execute("PRAGMA synchronous=FULL")
            while pending:
                changed = False
                states = {r["id"]: r["state"] for r in report(path)["cases"]}
                for key in sorted(pending):
                    case = by_id[key]
                    if states[key] == "PASSED":
                        pending.remove(key)
                        changed = True
                        continue
                    if availability(case) or any(
                        states[parent] != "PASSED"
                        for parent in case.get("requires", [])
                    ):
                        continue
                    if not context_intact():
                        raise ValueError(
                            "Execution context drift before case; create a new run"
                        )
                    identity = uuid4().hex
                    log_name = key + "-" + identity + ".log"
                    command = [
                        (
                            sys.executable
                            if part == "{python}"
                            else part.replace("{run_dir}", str(path))
                        )
                        for part in case["command"]
                    ]
                    append(
                        db,
                        key,
                        identity,
                        "START",
                        {"command": command, "log": log_name},
                    )
                    started = time.monotonic()
                    with (path / log_name).open("xb") as log:
                        child = subprocess.Popen(
                            command,
                            cwd=ROOT,
                            stdout=log,
                            stderr=subprocess.STDOUT,
                            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                            pass_fds=(ownership_fd,),
                        )
                        try:
                            code = child.wait()
                        except BaseException:
                            child.terminate()
                            try:
                                child.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                child.kill()
                                child.wait()
                            raise  # START remains evidence of interrupted execution.
                        log.flush()
                        os.fsync(log.fileno())
                    unchanged = context_intact()
                    append(
                        db,
                        key,
                        identity,
                        "RESULT",
                        {
                            "exit_code": code,
                            "seconds": time.monotonic() - started,
                            "execution_context_intact": unchanged,
                            "log": log_name,
                            "log_sha256": hashlib.sha256(
                                (path / log_name).read_bytes()
                            ).hexdigest(),
                        },
                    )
                    if not unchanged:
                        return report(path)
                    pending.remove(key)
                    changed = True
                if not changed:
                    break
        return report(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["preflight", "run", "resume", "report"])
    parser.add_argument("--spec", default=str(SPEC))
    parser.add_argument("--directory")
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--detach", action="store_true")
    args = parser.parse_args(argv)
    if args.action == "preflight":
        value = preflight(read_spec(args.spec))
    else:
        if not args.directory:
            parser.error("--directory required")
        path = Path(args.directory).resolve()
        if args.action == "run":
            spec = read_spec(args.spec)
            create_run(path, spec, args.case or [c["id"] for c in spec["cases"]])
        if args.action in {"run", "resume"}:
            if args.detach:
                with (path / ("supervisor-" + uuid4().hex + ".log")).open("xb") as log:
                    proc = subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "scripts.acceptance",
                            "resume",
                            "--directory",
                            str(path),
                        ],
                        cwd=ROOT,
                        stdin=subprocess.DEVNULL,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                value = {
                    "pid": proc.pid,
                    "directory": str(path),
                    "state": "STARTED_NOT_ACCEPTED",
                }
            else:
                value = execute(path)
        else:
            value = report(path)
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return (
        0
        if args.action == "preflight"
        or value.get("state") == "STARTED_NOT_ACCEPTED"
        or value.get("selected_complete")
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
