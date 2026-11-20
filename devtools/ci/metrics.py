"""Measure CI duration, failure rate and suspected flakiness from GitHub Actions runs.

The statistics are descriptive. A suspected flake is a commit (head SHA) whose
attempts of the same workflow both failed and succeeded with no code change.
When none is observed across n commits, the one-sided 95% upper bound of the
per-commit flake rate is 1 - 0.05**(1/n) (independent Bernoulli trials assumed;
real CI runs are not fully independent, so this is an optimistic bound).

usage: python -m devtools.ci.metrics OWNER/REPO [--workflow ci.yml] [--runs 100]
Requires GITHUB_TOKEN with actions:read. Writes Markdown to stdout and, when
GITHUB_STEP_SUMMARY is set, to the job summary.
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.request
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

API = "https://api.github.com"


def _seconds(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    a = datetime.fromisoformat(start.replace("Z", "+00:00"))
    b = datetime.fromisoformat(end.replace("Z", "+00:00"))
    return (b - a).total_seconds()


def percentile(values: list[float], q: float) -> float | None:
    """Nearest-rank percentile (q in [0, 1]); None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(q * len(ordered)))
    return ordered[rank - 1]


def zero_failure_upper_bound(n: int, confidence: float = 0.95) -> float | None:
    if n <= 0:
        return None
    return 1 - (1 - confidence) ** (1 / n)


def job_durations(jobs: Iterable[dict[str, Any]]) -> dict[str, list[float]]:
    """Durations (minutes) of successful jobs, by job name."""
    result: dict[str, list[float]] = defaultdict(list)
    for job in jobs:
        if job.get("conclusion") != "success":
            continue
        seconds = _seconds(job.get("started_at"), job.get("completed_at"))
        if seconds is not None and seconds >= 0:
            result[str(job.get("name"))].append(seconds / 60)
    return dict(result)


def summarize_runs(runs: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Failure rate and suspected flakes from workflow runs (all attempts)."""
    outcomes_by_sha: dict[str, set[str]] = defaultdict(set)
    counted = failed = 0
    for run in runs:
        conclusion = run.get("conclusion")
        if conclusion in (None, "cancelled", "skipped"):
            continue
        counted += 1
        if conclusion != "success":
            failed += 1
        outcomes_by_sha[str(run.get("head_sha"))].add(
            "success" if conclusion == "success" else "failure"
        )
    flaky = sorted(
        sha for sha, seen in outcomes_by_sha.items() if seen == {"success", "failure"}
    )
    commits = len(outcomes_by_sha)
    return {
        "runs": counted,
        "failed": failed,
        "failure_rate": failed / counted if counted else None,
        "commits": commits,
        "suspected_flaky_commits": flaky,
        "flake_upper_bound_95": (
            zero_failure_upper_bound(commits) if not flaky else None
        ),
    }


def render(summary: dict[str, Any], durations: dict[str, list[float]]) -> str:
    def fmt(value: float | None, unit: str = "") -> str:
        return "—" if value is None else f"{value:.1f}{unit}"

    lines = [
        "## CI の計測",
        "",
        f"- 対象の実行：{summary['runs']}件（取消しを除く）、コミット：{summary['commits']}件",
        f"- 失敗率：{fmt(None if summary['failure_rate'] is None else summary['failure_rate'] * 100, '%')}",
        f"- フレークの疑い（同じコミットで成功と失敗の両方）：{len(summary['suspected_flaky_commits'])}件",
    ]
    if summary["flake_upper_bound_95"] is not None:
        lines.append(
            f"- 疑いが0件のときの片側95%信頼上限：{summary['flake_upper_bound_95'] * 100:.2f}%"
            "（実行が独立と仮定した楽観的な値）"
        )
    lines += [
        "",
        "| ジョブ | 件数 | 中央値（分） | 95パーセンタイル（分） |",
        "|---|---:|---:|---:|",
    ]
    for name in sorted(durations):
        values = durations[name]
        lines.append(
            f"| {name} | {len(values)} | {fmt(percentile(values, 0.5))} | {fmt(percentile(values, 0.95))} |"
        )
    return "\n".join(lines) + "\n"


def _get(path: str, token: str) -> Any:
    request = urllib.request.Request(
        API + path,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch(
    repo: str, workflow: str, limit: int, token: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    runs: list[dict[str, Any]] = []
    page = 1
    while len(runs) < limit:
        batch = _get(
            f"/repos/{repo}/actions/workflows/{workflow}/runs?status=completed&per_page=100&page={page}",
            token,
        )["workflow_runs"]
        if not batch:
            break
        runs.extend(batch)
        page += 1
    runs = runs[:limit]
    attempts: list[dict[str, Any]] = []
    jobs: list[dict[str, Any]] = []
    for run in runs:
        for attempt in range(1, int(run.get("run_attempt") or 1) + 1):
            detail = (
                run
                if attempt == run.get("run_attempt")
                else _get(
                    f"/repos/{repo}/actions/runs/{run['id']}/attempts/{attempt}", token
                )
            )
            attempts.append(detail)
        jobs.extend(
            _get(f"/repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100", token)[
                "jobs"
            ]
        )
    return attempts, jobs


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    repo = argv[0]
    workflow = argv[argv.index("--workflow") + 1] if "--workflow" in argv else "ci.yml"
    limit = int(argv[argv.index("--runs") + 1]) if "--runs" in argv else 100
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN is required")
        return 2
    attempts, jobs = fetch(repo, workflow, limit, token)
    report = render(summarize_runs(attempts), job_durations(jobs))
    print(report)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
