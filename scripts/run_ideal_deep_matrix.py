"""Run the mutation-level journey of every use case in disposable PostgreSQL schemas.

One invocation is used per browser/width case, so every variant gets a disposable
schema owned and dropped by the remediation server. The runner
rejects retries, missing variants, unexpected skips, and a success report whose
test identity differs from the machine-readable use-case contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
USE_CASES = ROOT / "docs" / "ideal-ui" / "usecases.json"
DISPOSABLE_SCHEMA = re.compile(r"audit_browser_[0-9a-f]{32}")


def disposable_schemas(url: str) -> set[str]:
    """Return only schemas owned by the browser fixture in the selected audit DB."""
    parsed = make_url(url)
    owned = (
        parsed.port == 55443
        and re.fullmatch(r"pharmshift_audit(?:_[a-z0-9_]+)?", parsed.database or "")
    ) or (
        parsed.port == 55449
        and parsed.database == "pharmshift_audit_uiux"
        and parsed.username == "audit"
    )
    if not (
        parsed.get_backend_name() == "postgresql"
        and parsed.host == "127.0.0.1"
        and owned
        and not parsed.query
    ):
        raise ValueError(
            "Deep E2E cleanup requires the owned loopback UI audit database"
        )
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            names = connection.scalars(
                text(
                    "SELECT schema_name FROM information_schema.schemata "
                    "WHERE schema_name LIKE 'audit_browser_%'"
                )
            ).all()
        return {name for name in names if DISPOSABLE_SCHEMA.fullmatch(name)}
    finally:
        engine.dispose()


def cleanup_case_schema(url: str, before: set[str]) -> tuple[bool, list[str]]:
    """Remove this case's sole leaked schema without touching concurrent cases."""
    created = sorted(disposable_schemas(url) - before)
    if not created:
        return True, []  # The child completed its own context-manager cleanup.
    if len(created) != 1:
        return False, created
    schema = created[0]
    if not DISPOSABLE_SCHEMA.fullmatch(schema):  # defensive guard before identifier SQL
        return False, created
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    finally:
        engine.dispose()
    return disposable_schemas(url) == before, created


def run_case(command: list[str], env: dict[str, str]) -> int:
    """Run one case in an owned process group so interruption cannot orphan servers."""
    process = subprocess.Popen(
        command,
        cwd=FRONTEND,
        env=env,
        start_new_session=True,
    )
    try:
        return process.wait()
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)
        raise


def node24() -> Path:
    configured = os.environ.get("E2E_NODE24")
    candidates = [Path(configured)] if configured else []
    candidates.append(
        ROOT / "tools" / "node24" / "node_modules" / "node" / "bin" / "node"
    )
    for candidate in candidates:
        if candidate.is_file():
            version = subprocess.check_output(
                [candidate, "-p", "process.versions.node"], text=True
            ).strip()
            if version.startswith("24."):
                return candidate
    raise SystemExit("Set E2E_NODE24 to a Node 24 executable")


def exact_result(path: Path, name: str) -> bool:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    stats = report.get("stats", {})
    if stats.get("expected") != 9 or any(
        stats.get(key) != 0 for key in ("skipped", "unexpected", "flaky")
    ):
        return False
    specs = [
        spec for suite in report.get("suites", []) for spec in suite.get("specs", [])
    ]
    tests = [test for spec in specs for test in spec.get("tests", [])]
    expected_titles = Counter({f"{name} {width}": 3 for width in (320, 768, 1440)})
    expected_projects = Counter(dict.fromkeys(("chromium", "firefox", "webkit"), 3))
    return (
        len(specs) == 9
        and len(tests) == 9
        and Counter(spec.get("title", "") for spec in specs) == expected_titles
        and Counter(test.get("projectName") for test in tests) == expected_projects
        and all(
            test.get("status") == "expected"
            and len(test.get("results", [])) == 1
            and test["results"][0].get("status") == "passed"
            and test["results"][0].get("retry") == 0
            for test in tests
        )
    )


def exact_single_result(path: Path, title: str, project: str) -> bool:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    stats = report.get("stats", {})
    specs = [
        spec for suite in report.get("suites", []) for spec in suite.get("specs", [])
    ]
    tests = [test for spec in specs for test in spec.get("tests", [])]
    return (
        stats.get("expected") == 1
        and all(stats.get(key) == 0 for key in ("skipped", "unexpected", "flaky"))
        and len(specs) == len(tests) == 1
        and specs[0].get("title") == title
        and tests[0].get("projectName") == project
        and tests[0].get("status") == "expected"
        and len(tests[0].get("results", [])) == 1
        and tests[0]["results"][0].get("status") == "passed"
        and tests[0]["results"][0].get("retry") == 0
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def executable_source_digest() -> tuple[str, int]:
    """Hash the tested executable/test tree, including untracked migration work."""
    listed = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=ROOT,
        )
        .decode()
        .split("\0")
    )
    prefixes = ("alembic/", "frontend/", "scripts/", "src/", "tests/")
    ignored_parts = {"node_modules", "__pycache__", "htmlcov"}
    paths = sorted(
        path
        for path in listed
        if path.startswith(prefixes)
        and path != "frontend/node_modules"
        and not any(
            part in ignored_parts or part.startswith(".next")
            for part in Path(path).parts
        )
    )
    value = hashlib.sha256()
    for relative in paths:
        path = ROOT / relative
        value.update(relative.encode())
        value.update(b"\0")
        if path.is_symlink():
            value.update(os.readlink(path).encode())
        else:
            value.update(path.read_bytes())
        value.update(b"\0")
    return value.hexdigest(), len(paths)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", nargs="*", default=[])
    parser.add_argument(
        "--projects",
        nargs="+",
        choices=("chromium", "firefox", "webkit"),
        default=("chromium", "firefox", "webkit"),
    )
    parser.add_argument(
        "--widths",
        nargs="+",
        type=int,
        choices=(320, 768, 1440),
        default=(320, 768, 1440),
    )
    args = parser.parse_args()
    if not os.environ.get("PHARMSHIFT_E2E_PG_URL"):
        raise SystemExit(
            "Set PHARMSHIFT_E2E_PG_URL to the owned loopback audit database"
        )
    database_url = os.environ["PHARMSHIFT_E2E_PG_URL"]
    # Validate the target before a browser or API process can write to it.
    disposable_schemas(database_url)
    document = json.loads(USE_CASES.read_text(encoding="utf-8"))
    rows = list(document["use_cases"])
    if args.ids:
        wanted = set(args.ids)
        rows = [row for row in rows if row["id"] in wanted]
        if {row["id"] for row in rows} != wanted:
            raise SystemExit("Unknown or out-of-range use-case id")
    run_root = Path(
        os.environ.get(
            "E2E_EVIDENCE_DIR",
            "/private/tmp/pharmshift-artifacts/ideal-ui-u01-u27/e2e",
        )
    )
    run_root.mkdir(parents=True, exist_ok=True)
    node = node24()
    runner = FRONTEND / "node_modules" / "@playwright" / "test" / "cli.js"
    build_root = FRONTEND / os.environ.get("E2E_DIST_DIR", ".next-ideal-deep")
    build_manifest = build_root / "required-server-files.json"
    build_id = build_root / "BUILD_ID"
    if not build_manifest.is_file() or not build_id.is_file():
        raise SystemExit("The selected production build is incomplete")
    source_before, source_count_before = executable_source_digest()
    contract_before = digest(USE_CASES)
    build_manifest_before = digest(build_manifest)
    build_id_before = digest(build_id)
    failures: list[str] = []
    passed_cases = 0
    for row in rows:
        usecase_root = run_root / row["id"].lower()
        case_results = []
        usecase_failed = False
        for project in args.projects:
            for width in args.widths:
                title = f'{row["deep_e2e"]} {width}'
                destination = usecase_root / f"{project}-{width}"
                destination.mkdir(parents=True, exist_ok=True)
                env = {
                    **os.environ,
                    "IDEAL_UI": "1",
                    "PHARMSHIFT_E2E_API_URL": "https://127.0.0.1:18540",
                    "PHARMSHIFT_E2E_PUBLICATION": "1",
                    "PHARMSHIFT_E2E_GRANT_SERIES": "1",
                    # Feature fixtures are scoped to their own journey.  Injecting an
                    # actual into every case makes otherwise valid schedule changes
                    # correctly fail the final current-ledger revalidation.
                    "PHARMSHIFT_E2E_FLEX": "1" if row["id"] == "U22" else "0",
                    "PHARMSHIFT_E2E_ACTUAL": "1" if row["id"] == "U23" else "0",
                    # Leave rules that allow half days and hours exist only for
                    # the journey that claims them; every other journey keeps the
                    # rules that allow whole days only.
                    "PHARMSHIFT_E2E_PARTIAL_DAY_LEAVE": (
                        "1" if row["id"] == "U28" else "0"
                    ),
                    # Superseded planning inputs (one past its retention) exist only
                    # for the journey that erases one.
                    "PHARMSHIFT_E2E_EXPIRED_INPUT": (
                        "1" if row["id"] == "U29" else "0"
                    ),
                    "PHARMSHIFT_E2E_DEEP": "1",
                    # The U27 cancellation assertion needs an observable QUEUED
                    # interval.  This fixture-only delay starts the real worker
                    # after the API, then the same worker completes the next run.
                    "PHARMSHIFT_E2E_WORKER_DELAY_SECONDS": (
                        "4" if row["id"] == "U27" else "0"
                    ),
                    "PHARMSHIFT_E2E_ERASURE_RECEIPT": (
                        str(destination / "erasure-receipt.json")
                        if row["id"] == "U25"
                        else ""
                    ),
                    "PHARMSHIFT_E2E_OBSERVATION_TIME": "2026-01-05T09:00:00+09:00",
                    "E2E_PYTHON": os.environ.get("E2E_PYTHON", sys.executable),
                    "E2E_EVIDENCE_DIR": str(destination),
                    "E2E_DIST_DIR": os.environ.get("E2E_DIST_DIR", ".next-ideal-deep"),
                }
                before_schemas = disposable_schemas(database_url)
                try:
                    returncode = run_case(
                        [
                            str(node),
                            str(runner),
                            "test",
                            "--config=playwright.ideal.config.ts",
                            "--project",
                            project,
                            "--grep",
                            re.escape(title),
                        ],
                        env,
                    )
                finally:
                    cleanup_confirmed, created_schemas = cleanup_case_schema(
                        database_url, before_schemas
                    )
                passed = not returncode and exact_single_result(
                    destination / "results.json", title, project
                )
                if passed and row["id"] == "U25":
                    try:
                        erasure = json.loads(
                            (destination / "erasure-receipt.json").read_text(
                                encoding="utf-8"
                            )
                        )
                        passed = (
                            erasure["remaining_entities"] == 0
                            and erasure["remaining_revisions"] == 0
                            and erasure["subject_control_count"] == 1
                            and erasure["database_erasure_tombstone_count"] >= 2
                            and erasure["reintroduction_blocked"] is True
                        )
                    except (OSError, ValueError, KeyError):
                        passed = False
                passed = passed and cleanup_confirmed
                passed_cases += int(passed)
                usecase_failed |= not passed
                case_results.append(
                    {
                        "project": project,
                        "width": width,
                        "passed": passed,
                        "schema_cleanup_confirmed": cleanup_confirmed,
                        "created_schema_count": len(created_schemas),
                    }
                )
        (usecase_root / "summary.json").write_text(
            json.dumps(
                {
                    "usecase": row["id"],
                    "deep_e2e": row["deep_e2e"],
                    "database_isolation": "one disposable schema per browser-width case",
                    "retry_policy": 0,
                    "cases": case_results,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if usecase_failed:
            failures.append(row["id"])
    source_tree_sha256, source_file_count = executable_source_digest()
    contract_after = digest(USE_CASES)
    build_manifest_after = digest(build_manifest)
    build_id_after = digest(build_id)
    source_drift = (
        (source_tree_sha256, source_file_count) != (source_before, source_count_before)
        or contract_after != contract_before
        or build_manifest_after != build_manifest_before
        or build_id_after != build_id_before
    )
    if source_drift:
        failures.append("SOURCE_DRIFT")
    summary = {
        "created_at": datetime.now(UTC).isoformat(),
        "source_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "executable_source_sha256": source_tree_sha256,
        "executable_source_file_count": source_file_count,
        "source_before_sha256": source_before,
        "source_before_file_count": source_count_before,
        "source_drift_detected": source_drift,
        "usecase_contract_sha256": contract_after,
        "usecase_contract_before_sha256": contract_before,
        "build_manifest_sha256": build_manifest_after,
        "build_manifest_before_sha256": build_manifest_before,
        "build_id_sha256": build_id_after,
        "build_id_before_sha256": build_id_before,
        "selected": [row["id"] for row in rows],
        "expected_cases": len(rows) * len(args.projects) * len(args.widths),
        "passed_cases": passed_cases,
        "failed_usecases": failures,
        "retry_policy": 0,
        "database": "owned loopback PostgreSQL; one disposable schema per browser-width case",
        "schema_cleanup": "parent verifies and removes only its sole newly-created audit_browser schema",
        "rendering": "Playwright 1.56; Chromium, Firefox, WebKit; 320/768/1440 CSS px",
    }
    (run_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
