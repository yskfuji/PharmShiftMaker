"""Fail fast before a long 25-month run: Docker, isolated PostgreSQL, disk, output path.

A long run that dies on an unavailable Docker VM costs 10-30 minutes; these
checks take seconds. Passing them is not evidence of anything else.
"""

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def check(output, min_free_gb=20):
    problems, facts = [], {}
    try:
        version = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        facts["docker"] = version.stdout.strip() or version.stderr.strip()[:120]
        if version.returncode:
            problems.append("Docker daemon is not responding")
    except (OSError, subprocess.TimeoutExpired):
        problems.append("Docker daemon did not answer within 20 seconds")
    container = "pharmshift-storage-closure-20260923-r1"
    probe = subprocess.run(
        [
            "docker",
            "inspect",
            container,
            "--format",
            '{{index .Config.Labels "pharmshift.synthetic-audit"}} {{.State.Running}}',
        ],
        capture_output=True,
        text=True,
    )
    facts["isolated_pg"] = probe.stdout.strip()
    if probe.stdout.strip() != "true true":
        problems.append("Labelled isolated PostgreSQL is not running")
    free = shutil.disk_usage(Path(".").resolve()).free / 1e9
    facts["free_gb"] = round(free, 1)
    if free < min_free_gb:
        problems.append(f"Less than {min_free_gb} GB free disk")
    if output and Path(output).exists():
        problems.append("Output directory already exists; use a new run ID")
    return {"ok": not problems, "problems": problems, "facts": facts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = check(args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
