"""Repository policy for GitHub Actions workflows (complements zizmor).

Checked for every file in .github/workflows:
- every ``uses:`` of an external action is pinned to a full 40-hex commit SHA;
- no ``pull_request_target`` or ``workflow_run`` trigger (untrusted code with
  repository secrets or write tokens);
- a top-level ``permissions`` block exists and grants at most ``contents: read``
  (writes are declared per job);
- every job has ``timeout-minutes``;
- every ``actions/checkout`` step sets ``persist-credentials: false``.

usage: python -m devtools.ci.workflow_policy [WORKFLOW_DIR]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml

PINNED = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
FORBIDDEN_TRIGGERS = {"pull_request_target", "workflow_run"}


def _triggers(document: dict[Any, Any]) -> set[str]:
    # PyYAML reads the bare key ``on`` as the boolean True.
    raw = document.get("on", document.get(True))
    if isinstance(raw, str):
        return {raw}
    if isinstance(raw, list):
        return {str(item) for item in raw}
    if isinstance(raw, dict):
        return {str(key) for key in raw}
    return set()


def check_workflow(name: str, document: dict[Any, Any]) -> list[str]:
    problems: list[str] = []
    forbidden = _triggers(document) & FORBIDDEN_TRIGGERS
    if forbidden:
        problems.append(f"{name}: forbidden trigger(s) {sorted(forbidden)}")
    permissions = document.get("permissions")
    if not isinstance(permissions, dict) or any(
        not (scope == "contents" and level == "read")
        for scope, level in permissions.items()
    ):
        problems.append(f"{name}: top-level permissions must be exactly contents: read")
    for job_id, job in (document.get("jobs") or {}).items():
        if not isinstance(job, dict):
            continue
        if "uses" in job:  # reusable workflow call
            if not PINNED.match(str(job["uses"])) and not str(job["uses"]).startswith(
                "./"
            ):
                problems.append(f"{name}:{job_id}: reusable workflow is not SHA-pinned")
            continue
        if "timeout-minutes" not in job:
            problems.append(f"{name}:{job_id}: missing timeout-minutes")
        for index, step in enumerate(job.get("steps") or []):
            uses = step.get("uses") if isinstance(step, dict) else None
            if not uses:
                continue
            uses = str(uses)
            if uses.startswith("./") or uses.startswith("docker://"):
                if uses.startswith("docker://") and "@sha256:" not in uses:
                    problems.append(
                        f"{name}:{job_id}[{index}]: docker image not digest-pinned"
                    )
                continue
            if not PINNED.match(uses):
                problems.append(f"{name}:{job_id}[{index}]: {uses} is not SHA-pinned")
            if uses.startswith("actions/checkout@"):
                options = step.get("with") or {}
                if options.get("persist-credentials") is not False:
                    problems.append(
                        f"{name}:{job_id}[{index}]: checkout must set persist-credentials: false"
                    )
    return problems


def check_directory(directory: Path) -> list[str]:
    problems: list[str] = []
    files = sorted([*directory.glob("*.yml"), *directory.glob("*.yaml")])
    if not files:
        return [f"{directory}: no workflows found"]
    for path in files:
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        problems.extend(check_workflow(path.name, document))
    return problems


def main(argv: list[str]) -> int:
    directory = Path(argv[0]) if argv else Path(".github/workflows")
    problems = check_directory(directory)
    for problem in problems:
        print(problem)
    print(f"workflow policy: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
