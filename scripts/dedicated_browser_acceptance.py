"""Run existing browser cases once each against fresh, owned synthetic PG schemas.

This is diagnostic execution of the enumerated tests, not proof that every product
operation/state or WCAG criterion is covered. No normal server is stopped/reset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ARTIFACTS_ROOT = Path("/private/tmp/pharmshift-artifacts")
CONFIG = "playwright.remediation-linux.config.ts"
API_PORT = 18510
FRONTEND_PORT = 18511
FIXTURES = {
    "actual-workflow.spec.ts": {"PHARMSHIFT_E2E_ACTUAL": "1"},
    "actual-file-import.spec.ts": {"PHARMSHIFT_E2E_ACTUAL": "1"},
    "publication-artifacts.spec.ts": {"PHARMSHIFT_E2E_PUBLICATION": "1"},
    "grant-series.spec.ts": {"PHARMSHIFT_E2E_GRANT_SERIES": "1"},
    "flex-adoption.spec.ts": {"PHARMSHIFT_E2E_FLEX": "1"},
    "ideal-workspace.spec.ts": {"PHARMSHIFT_E2E_PUBLICATION": "1"},
}
PROJECTS = {"chromium-linux", "firefox-linux", "webkit-linux"}


def now():
    return datetime.now(UTC).isoformat()


def write(path, value):
    # Evidence is append-only by filename. Intermediate state is journalled below.
    with Path(path).open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def append(path, value):
    with Path(path).open("a") as stream:
        stream.write(json.dumps(value, ensure_ascii=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def occupied(port):
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def clean_environment(source, fixtures=None):
    runtime_site = source.get("E2E_RUNTIME_SITE_PACKAGES")
    prefixes = (
        "PHARMSHIFT_",
        "SHIFT_SCHEDULER_",
        "DATABASE_",
        "AUTH_",
        "API_CORS_",
        "FRONTEND_",
        "E2E_",
        "NEXT_",
        "PW_TEST_",
        "PLAYWRIGHT_",
        # The ideal UI flags are set by --ideal-ui only, never inherited from the shell.
        "IDEAL_",
    )
    env = {key: value for key, value in source.items() if not key.startswith(prefixes)}
    env.update(fixtures or {})
    python_paths = [str(ROOT / "src")]
    if runtime_site:
        runtime_path = Path(runtime_site).resolve()
        allowed_root = ARTIFACTS_ROOT.resolve()
        if not runtime_path.is_dir() or not runtime_path.is_relative_to(allowed_root):
            raise ValueError(
                "E2E_RUNTIME_SITE_PACKAGES must be an existing isolated artifact directory"
            )
        python_paths.insert(0, str(runtime_path))
    env["PYTHONPATH"] = os.pathsep.join(python_paths)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def validate_pg(url):
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    if (
        (parsed.get_backend_name(), parsed.host) != ("postgresql", "127.0.0.1")
        or parsed.query
        or not (
            (
                parsed.port == 55443
                and re.fullmatch(
                    r"pharmshift_audit(?:_[a-z0-9_]+)?", parsed.database or ""
                )
            )
            or (
                parsed.port == 55449
                and parsed.database == "pharmshift_audit_uiux"
                and parsed.username == "audit"
            )
        )
    ):
        raise ValueError(
            "Only an explicitly selected loopback audit PostgreSQL is allowed; no SQLite fallback"
        )
    return {"host": parsed.host, "port": parsed.port, "database": parsed.database}


def verify_test_api_targets(directory):
    # A configured fixture is not isolated if a test still addresses a fixed server.
    for path in Path(directory).glob("*.ts"):
        if re.search(r"https://(?:127\.0\.0\.1|localhost):\d+/", path.read_text()):
            raise ValueError(
                f"Hard-coded test API path in {path.name}; use the selected API origin"
            )


def flatten(report):
    cases = []

    def visit(suite):
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                filename = str(spec.get("file") or suite.get("file"))
                title = spec["title"]
                width = re.search(r"(?:^|\s)(320|768|1440)$", title)
                item = {
                    "file": filename,
                    "line": spec["line"],
                    "title": title,
                    "project": test.get("projectName", test.get("projectId")),
                    "declared_width": int(width[1]) if width else None,
                }
                item["case_id"] = hashlib.sha256(
                    json.dumps(item, sort_keys=True).encode()
                ).hexdigest()[:16]
                cases.append(item)
        for child in suite.get("suites", []):
            visit(child)

    for suite in report.get("suites", []):
        visit(suite)
    return cases


def classify_result(report, case):
    observed = flatten(report)
    results = []

    def visit(suite):
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                results.append(test)
        for child in suite.get("suites", []):
            visit(child)

    for suite in report.get("suites", []):
        visit(suite)
    if len(observed) != 1 or len(results) != 1:
        return "FAILED", "Expected exactly one selected test, got " + str(len(observed))
    actual = observed[0]
    if (
        any(actual[k] != case[k] for k in ("title", "project", "line"))
        or Path(actual["file"]).name != Path(case["file"]).name
    ):
        return "FAILED", "Executed identity differs from enumerated case"
    attempts = results[0].get("results", [])
    if (
        report.get("errors")
        or results[0].get("expectedStatus") != "passed"
        or len(attempts) != 1
        or attempts[0].get("status") != "passed"
    ):
        return (
            "FAILED",
            "Failure/skip/timeout/missing observation; never converted by retry",
        )
    return "PASSED", "One first attempt passed"


def stop_owned(process):
    if process.poll() is None:
        process.terminate()  # Only our direct owner; it terminates its API/worker and drops its schema.
    try:
        process.wait(timeout=25)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)
        return False
    return process.returncode == 0 and not occupied(API_PORT)


def require_owned_listener(process):
    # A mere listening port is insufficient: never send test writes to a raced-in server.
    listing = subprocess.run(
        ["lsof", "-nP", "-t", f"-iTCP:{API_PORT}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
    )
    pids = {int(value) for value in listing.stdout.split()}
    if not pids or any(os.getpgid(pid) != process.pid for pid in pids):
        raise RuntimeError(
            "API listener does not belong to this case's owned process group"
        )


def wait_api(process, timeout, ca_cert=None):
    ca_cert = Path(ca_cert or ROOT / "certs/dev-rootCA.pem").resolve()
    deadline = time.monotonic() + timeout
    context = ssl.create_default_context(cafile=str(ca_cert))
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Owned API exited during fixture preparation")
        try:
            if occupied(API_PORT):
                require_owned_listener(process)
            with urlopen(
                f"https://127.0.0.1:{API_PORT}/healthz", context=context, timeout=1
            ) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError("Owned API readiness deadline exceeded")


def select_cases(cases, specs):
    if not specs:
        return cases
    requested = set(specs)
    known = {Path(case["file"]).name for case in cases}
    if requested - known:
        raise ValueError(
            "Unknown requested spec: " + ", ".join(sorted(requested - known))
        )
    return [case for case in cases if Path(case["file"]).name in requested]


def freeze_files(build_dir, ca_cert=None):
    ca_cert = Path(ca_cert or ROOT / "certs/dev-rootCA.pem").resolve()
    """Sources and deployment metadata; generated caches are never source evidence."""
    files = set()
    for directory in (ROOT / "src", FRONTEND / "src"):
        files.update(
            path
            for path in directory.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix != ".pyc"
        )
    files.update((ROOT / "scripts").rglob("*.py"))
    files.update((FRONTEND / "tests/remediation-e2e").rglob("*.ts"))
    for directory, patterns in (
        (
            ROOT,
            (
                "pyproject.toml",
                "uv.lock",
                "poetry.lock",
                "requirements*.txt",
                "requirements*.lock",
            ),
        ),
        (
            FRONTEND,
            (
                "package*.json",
                "*lock*",
                "tsconfig*.json",
                "next.config.*",
                "next-env.d.ts",
                "playwright.remediation-linux.config.ts",
            ),
        ),
    ):
        for pattern in patterns:
            files.update(path for path in directory.glob(pattern) if path.is_file())
    files.add(ca_cert)
    files.add(build_dir / "BUILD_ID")
    files.update(build_dir.glob("*manifest*.json"))
    files.update(build_dir.glob("required-server-files.*"))
    build_id = (build_dir / "BUILD_ID").read_text().strip()
    files.update((build_dir / "static" / build_id).glob("*Manifest.js"))
    frozen = {}
    for path in sorted(files):
        resolved = path.resolve()
        if resolved == ca_cert:
            key = "runtime/ca-certificate.pem"
        elif resolved.is_relative_to(ROOT.resolve()):
            key = str(resolved.relative_to(ROOT.resolve()))
        else:
            key = "build/" + str(resolved.relative_to(build_dir.resolve()))
        frozen[key] = hashlib.sha256(resolved.read_bytes()).hexdigest()
    return frozen


def hash_differences(expected, observed):
    return [
        {"path": key, "expected": expected.get(key), "observed": observed.get(key)}
        for key in sorted(expected.keys() | observed.keys())
        if expected.get(key) != observed.get(key)
    ]


def verify_served_build(build_dir, ca_cert=None):
    ca_cert = Path(ca_cert or ROOT / "certs/dev-rootCA.pem").resolve()
    build_id = (build_dir / "BUILD_ID").read_text().strip()
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", build_id):
        raise ValueError("Unsafe frontend build ID")
    asset = build_dir / "static" / build_id / "_buildManifest.js"
    expected = hashlib.sha256(asset.read_bytes()).hexdigest()
    url = (
        f"https://127.0.0.1:{FRONTEND_PORT}/_next/static/"
        + build_id
        + "/_buildManifest.js"
    )
    with urlopen(
        url,
        context=ssl.create_default_context(cafile=str(ca_cert)),
        timeout=10,
    ) as response:
        observed = hashlib.sha256(response.read()).hexdigest()
    if expected != observed:
        raise RuntimeError(
            "Running frontend build manifest differs from the frozen local artifact"
        )
    return {
        "build_id": build_id,
        "asset": str(asset),
        "served_asset_url": url,
        "sha256": expected,
    }


def runtime_drift(build_dir, ca_cert, frozen_sources, served_build):
    """Compare the same explicitly selected TLS/build inputs before and after a case."""
    drift = hash_differences(frozen_sources, freeze_files(build_dir, ca_cert))
    if verify_served_build(build_dir, ca_cert) != served_build:
        drift.append({"path": "running_frontend", "reason": "build changed"})
    return drift


def execute(args):
    global API_PORT, FRONTEND_PORT
    API_PORT, FRONTEND_PORT = args.api_port, args.frontend_port
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,100}", args.run_id):
        raise ValueError("Run ID must be a safe, unique identifier")
    if args.browser_ws not in {"ws://127.0.0.1:18525", "ws://127.0.0.1:18526"}:
        raise ValueError(
            "Only an explicitly selected loopback browser service is allowed"
        )
    verify_test_api_targets(FRONTEND / "tests/remediation-e2e")
    pg = validate_pg(args.pg_url)
    ca_cert = Path(
        os.environ.get("PHARMSHIFT_E2E_CA_CERT", ROOT / "certs/dev-rootCA.pem")
    ).resolve()
    tls_cert = Path(
        os.environ.get("PHARMSHIFT_E2E_TLS_CERT", ROOT / "certs/localhost-cert.pem")
    ).resolve()
    tls_key = Path(
        os.environ.get("PHARMSHIFT_E2E_TLS_KEY", ROOT / "certs/localhost-key.pem")
    ).resolve()
    allowed_ca_roots = ((ROOT / "certs").resolve(), Path("/private/tmp").resolve())
    for variable, path in (
        ("PHARMSHIFT_E2E_CA_CERT", ca_cert),
        ("PHARMSHIFT_E2E_TLS_CERT", tls_cert),
        ("PHARMSHIFT_E2E_TLS_KEY", tls_key),
    ):
        if not path.is_file() or not any(
            path.is_relative_to(root) for root in allowed_ca_roots
        ):
            raise ValueError(
                f"{variable} must name an existing repository or /private/tmp TLS file"
            )
    build_dir = Path(args.frontend_build_dir).resolve()
    if (
        not (
            build_dir.is_relative_to(FRONTEND.resolve())
            or (
                str(build_dir).startswith("/private/tmp/pharm-ui-")
                and (build_dir.parent.parent / "build-manifest.json").is_file()
            )
        )
        or not (build_dir / "BUILD_ID").is_file()
    ):
        raise ValueError("A completed local frontend build directory is required")
    if not shutil.which("lsof"):
        raise RuntimeError(
            "lsof is required to prove the API listener belongs to the owned case"
        )
    if occupied(API_PORT):
        raise RuntimeError(
            f"Port {API_PORT} is already occupied. Refusing to stop or reuse any existing API."
        )
    if not occupied(FRONTEND_PORT) or not occupied(
        int(args.browser_ws.rsplit(":", 1)[1])
    ):
        raise RuntimeError(
            "Selected frontend and local browser WS must already be running"
        )
    output = (Path(args.output_root) / args.run_id).resolve()
    allowed_evidence_roots = (
        (ROOT / "audit").resolve(),
        ARTIFACTS_ROOT.resolve(),
    )
    if not any(output.is_relative_to(root) for root in allowed_evidence_roots):
        raise ValueError(
            "Evidence must remain in the repository audit directory or the isolated "
            "/private/tmp/pharmshift-artifacts directory"
        )
    output.mkdir(parents=True, exist_ok=False)
    frozen_sources = freeze_files(build_dir, ca_cert)
    served_build = verify_served_build(build_dir, ca_cert)
    browser_env = clean_environment(os.environ)
    browser_env.update(
        PHARMSHIFT_E2E_FRONTEND_ORIGIN=f"https://127.0.0.1:{FRONTEND_PORT}",
        PHARMSHIFT_E2E_API_URL=f"https://127.0.0.1:{API_PORT}",
        PW_TEST_CONNECT_WS_ENDPOINT=args.browser_ws,
        PW_TEST_CONNECT_EXPOSE_NETWORK="<loopback>",
        E2E_RETAIN_ALL="1",
        PHARMSHIFT_VISUAL_OUTPUT=str(output / "enumeration"),
        # What the specs expect of the served frontend: it must have been started with the
        # same IDEAL_UI (ideal-workspace.spec.ts checks the server behaves accordingly).
        IDEAL_UI="1" if args.ideal_ui == "on" else "0",
    )
    executable = [
        args.node,
        str(FRONTEND / "node_modules/@playwright/test/cli.js"),
        "test",
        "--config=" + CONFIG,
    ]
    listed = subprocess.run(
        executable + ["--list", "--reporter=json"],
        cwd=FRONTEND,
        env=browser_env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    (output / "list.stdout.json").write_text(listed.stdout)
    (output / "list.stderr.txt").write_text(listed.stderr)
    if listed.returncode:
        raise RuntimeError("Playwright enumeration failed; evidence retained")
    report = json.loads(listed.stdout)
    cases = flatten(report)
    if (
        not cases
        or len({c["case_id"] for c in cases}) != len(cases)
        or {c["project"] for c in cases} != PROJECTS
    ):
        raise ValueError("Missing/duplicate cases or required three browser projects")
    discovered_files = {Path(c["file"]).name for c in cases}
    expected_files = {
        p.name for p in (FRONTEND / "tests/remediation-e2e").glob("*.spec.ts")
    }
    if discovered_files != expected_files:
        raise ValueError("Some existing spec files were not enumerated")
    all_cases = cases
    cases = select_cases(all_cases, args.spec)
    manifest = {
        "enumerated_case_count": len(all_cases),
        "selected_case_count": len(cases),
        "excluded_case_count": len(all_cases) - len(cases),
        "selected_specs": args.spec or sorted(expected_files),
        "build_directory": str(build_dir),
        "served_build": served_build,
        "run_id": args.run_id,
        "created_at": now(),
        "case_count": len(cases),
        "spec_count": len(expected_files),
        "database": pg,
        "frontend": f"https://127.0.0.1:{FRONTEND_PORT}",
        "browser_ws": args.browser_ws,
        "runtime_started_by_runner": [
            "case-local API",
            "case-local worker",
            "case-local PostgreSQL schema",
        ],
        "external_runtime": [
            "fixed production frontend",
            "existing local PostgreSQL",
            "existing Linux browsers",
        ],
        "source_hashes": frozen_sources,
        "ca_certificate_sha256": hashlib.sha256(ca_cert.read_bytes()).hexdigest(),
        "fixtures": FIXTURES,
        "ideal_ui": args.ideal_ui,
        "cases": cases,
        "declared_width_counts": dict(Counter(str(c["declared_width"]) for c in cases)),
        "limits": [
            "Actual cases from Playwright list; missing width variants are not invented",
            "Not all product operations/states",
            "Not 1200-case performance acceptance",
            "Not VoiceOver, actual Safari, real-user or full WCAG conformance",
            "No automatic retries; every failure remains",
        ],
    }
    write(output / "manifest.json", manifest)
    if args.list_only:
        write(
            output / "summary.json",
            {
                "status": "ENUMERATED_ONLY",
                "total": len(cases),
                "executed": 0,
                "passed": 0,
            },
        )
        return 0
    results = []
    interrupted = False
    for ordinal, case in enumerate(cases, 1):
        before_drift = []
        try:
            before_drift = runtime_drift(
                build_dir, ca_cert, frozen_sources, served_build
            )
        except Exception as exc:
            before_drift.append(
                {
                    "path": "running_frontend",
                    "reason": type(exc).__name__ + ": " + str(exc),
                }
            )
        if before_drift:
            append(
                output / "journal.jsonl",
                {
                    "at": now(),
                    "state": "SOURCE_DRIFT",
                    "phase": "before",
                    "next_case": case["case_id"],
                    "differences": before_drift,
                },
            )
            interrupted = True
            break
        if occupied(API_PORT):
            append(
                output / "journal.jsonl",
                {
                    "at": now(),
                    "state": "BLOCKED",
                    "reason": f"{API_PORT} unexpectedly occupied",
                    "next_case": case["case_id"],
                },
            )
            interrupted = True
            break
        case_dir = output / "cases" / f"{ordinal:04d}-{case['case_id']}"
        case_dir.mkdir(parents=True)
        fixture = FIXTURES.get(Path(case["file"]).name, {})
        env = clean_environment(os.environ, fixture)
        env["PHARMSHIFT_E2E_PG_URL"] = args.pg_url
        env["PHARMSHIFT_E2E_PORT"] = str(API_PORT)
        env["PHARMSHIFT_E2E_FRONTEND_ORIGIN"] = f"https://127.0.0.1:{FRONTEND_PORT}"
        env["PHARMSHIFT_E2E_TLS_CERT"] = str(tls_cert)
        env["PHARMSHIFT_E2E_TLS_KEY"] = str(tls_key)
        item = {
            **case,
            "ordinal": ordinal,
            "started_at": now(),
            "fixture_flags": fixture,
            "status": "FAILED",
            "returncode": None,
        }
        append(output / "journal.jsonl", {**item, "state": "STARTED"})
        server = None
        server_log = (case_dir / "server.log").open("x")
        try:
            server = subprocess.Popen(
                [args.python, "-m", "scripts.remediation_test_server"],
                cwd=ROOT,
                env=env,
                stdout=server_log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            item["owned_server_pid"] = server.pid
            wait_api(server, args.startup_timeout, ca_cert)
            case_env = {**browser_env, "PHARMSHIFT_VISUAL_OUTPUT": str(case_dir)}
            location = (
                "tests/remediation-e2e/"
                + Path(case["file"]).name
                + ":"
                + str(case["line"])
            )
            command = executable + [
                location,
                "--project=" + case["project"],
                "--grep=" + re.escape(case["title"]) + "$",
                "--workers=1",
                "--retries=0",
            ]
            item["command"] = command
            with (case_dir / "playwright.log").open("x") as log:
                completed = subprocess.run(
                    command,
                    cwd=FRONTEND,
                    env=case_env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=args.case_timeout,
                )
            item["returncode"] = completed.returncode
            path = case_dir / "results.json"
            if path.exists():
                item["status"], item["reason"] = classify_result(
                    json.loads(path.read_text()), case
                )
                if completed.returncode:
                    item["status"] = "FAILED"
            else:
                item["reason"] = "Playwright result file missing"
        except (Exception, KeyboardInterrupt) as exc:
            item["reason"] = type(exc).__name__ + ": " + str(exc)
            if isinstance(exc, KeyboardInterrupt):
                interrupted = True
        finally:
            clean = stop_owned(server) if server else True
            server_log.close()
            item["cleanup_confirmed"] = clean
            try:
                drift = runtime_drift(build_dir, ca_cert, frozen_sources, served_build)
            except Exception as exc:
                drift = [
                    {
                        "path": "source_or_build",
                        "reason": type(exc).__name__ + ": " + str(exc),
                    }
                ]
            item["source_and_build_unchanged"] = not drift
            if drift:
                item["status"] = "FAILED"
                item["drift"] = drift
                item["reason"] = (
                    "Source/build changed during this case; result cannot be accepted"
                )
                interrupted = True
            item["finished_at"] = now()
            log_text = (case_dir / "server.log").read_text(errors="replace")
            item["owned_schema_names"] = re.findall(
                r"E2E PostgreSQL schema: (audit_browser_[a-f0-9]+)", log_text
            )
            if not clean:
                item["status"] = "FAILED"
                item["cleanup_issue"] = (
                    "Owned process cleanup did not complete normally; inspect owned schema before further execution"
                )
                interrupted = True
            write(case_dir / "case-result.json", item)
            results.append(item)
            append(output / "journal.jsonl", {"state": "FINISHED", **item})
            print(
                json.dumps(
                    {
                        "case": ordinal,
                        "total": len(cases),
                        "status": item["status"],
                        "project": case["project"],
                        "title": case["title"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        if interrupted:
            break
    summary = {
        "run_id": args.run_id,
        "total": len(cases),
        "executed": len(results),
        "passed": sum(r["status"] == "PASSED" for r in results),
        "failed": sum(r["status"] != "PASSED" for r in results),
        "unexecuted": len(cases) - len(results),
        "interrupted": interrupted,
        "all_selected_cases_passed": len(results) == len(cases)
        and all(r["status"] == "PASSED" for r in results),
        "all_enumerated_cases_passed": len(results) == len(all_cases)
        and all(r["status"] == "PASSED" for r in results),
        "enumerated_total": len(all_cases),
        "excluded": len(all_cases) - len(cases),
        "all_operation_states_accepted": False,
        "cases": [
            {
                k: r[k]
                for k in (
                    "case_id",
                    "status",
                    "project",
                    "title",
                    "declared_width",
                    "cleanup_confirmed",
                )
            }
            for r in results
        ],
        "limits": manifest["limits"],
    }
    write(output / "summary.json", summary)
    return 0 if summary["all_selected_cases_passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--output-root",
        default=str(
            ROOT / "audit/integrated-acceptance-2026-09-23-r1/browser-per-case"
        ),
    )
    parser.add_argument("--node", required=True)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument(
        "--pg-url",
        default=os.environ.get("PHARMSHIFT_E2E_PG_URL"),
        required=not bool(os.environ.get("PHARMSHIFT_E2E_PG_URL")),
    )
    parser.add_argument("--frontend-build-dir", required=True)
    parser.add_argument(
        "--spec",
        action="append",
        help="Explicit diagnostic subset; does not imply all-case acceptance",
    )
    parser.add_argument("--api-port", type=int, choices=[18510, 18540], default=18510)
    parser.add_argument(
        "--frontend-port", type=int, choices=[18511, 18531], default=18511
    )
    parser.add_argument("--browser-ws", default="ws://127.0.0.1:18525")
    parser.add_argument("--startup-timeout", type=int, default=90)
    parser.add_argument("--case-timeout", type=int, default=180)
    parser.add_argument("--list-only", action="store_true")
    parser.add_argument(
        "--ideal-ui",
        choices=["off", "on"],
        default="off",
        help="IDEAL_UI of the served frontend; the specs verify the served behavior matches",
    )
    args = parser.parse_args()
    signal.signal(
        signal.SIGTERM,
        lambda *_: (_ for _ in ()).throw(KeyboardInterrupt("runner terminated")),
    )
    raise SystemExit(execute(args))


if __name__ == "__main__":
    main()
