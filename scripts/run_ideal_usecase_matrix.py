"""Run U01–U27 in independent disposable PostgreSQL schemas.

Each Playwright invocation starts the remediation server once. That server creates a
fresh owned schema and removes it on shutdown. The three widths × three browser projects
for one use case therefore share only that use case's synthetic schema, never another
use case's state.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
USE_CASES = ROOT / "docs" / "ideal-ui" / "usecases.json"


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
    raise SystemExit(
        "Set E2E_NODE24 to a Node 24 executable; other Node versions are not accepted."
    )


def exact_result(path: Path, name: str) -> bool:
    """Reject a green command if discovery, project coverage, or retry policy drifted."""
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
    if len(specs) != 9 or any(len(spec.get("tests", [])) != 1 for spec in specs):
        return False
    tests = [test for spec in specs for test in spec.get("tests", [])]
    expected_titles = Counter({f"{name} {width}": 3 for width in (320, 768, 1440)})
    expected_projects = Counter(dict.fromkeys(("chromium", "firefox", "webkit"), 3))
    return (
        Counter(spec.get("title", "") for spec in specs) == expected_titles
        and Counter(test.get("projectName") for test in tests) == expected_projects
        and all(
            test.get("status") == "expected"
            and len(test.get("results", [])) == 1
            and test["results"][0].get("status") == "passed"
            and test["results"][0].get("retry") == 0
            for test in tests
        )
    )


def main() -> int:
    if not os.environ.get("PHARMSHIFT_E2E_PG_URL"):
        raise SystemExit(
            "Set PHARMSHIFT_E2E_PG_URL to the owned loopback audit PostgreSQL database."
        )
    document = json.loads(USE_CASES.read_text(encoding="utf-8"))
    run_root = Path(
        os.environ.get(
            "E2E_EVIDENCE_DIR", "/private/tmp/pharmshift-artifacts/ideal-ui-v3/e2e"
        )
    )
    runner = FRONTEND / "node_modules" / "@playwright" / "test" / "cli.js"
    node = node24()
    failed: list[str] = []
    for row in document["use_cases"]:
        name = row["e2e"]
        destination = run_root / row["id"].lower()
        destination.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "IDEAL_UI": "1",
            "PHARMSHIFT_E2E_PUBLICATION": "1",
            "PHARMSHIFT_E2E_OBSERVATION_TIME": "2026-01-05T09:00:00+09:00",
            "E2E_EVIDENCE_DIR": str(destination),
            "E2E_DIST_DIR": os.environ.get("E2E_DIST_DIR", ".next-v3-e2e"),
        }
        result = subprocess.run(
            [
                str(node),
                str(runner),
                "test",
                "--config=playwright.ideal.config.ts",
                "--grep",
                name,
            ],
            cwd=FRONTEND,
            env=env,
            check=False,
        )
        if result.returncode or not exact_result(destination / "results.json", name):
            failed.append(row["id"])
    summary = {"total": 27, "failed": failed, "passed": 27 - len(failed)}
    run_root.mkdir(parents=True, exist_ok=True)
    (run_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
