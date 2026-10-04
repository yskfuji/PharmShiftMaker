"""Four predeclared settings on identical tuning inputs; never use held-out data to choose."""

import json
import os
import subprocess
import sys
from pathlib import Path

TARGET = Path(
    os.environ.get("PHARMSHIFT_TUNING_OUTPUT", "audit/remediation-2026-09-22/tuning-r1")
)
COMPOSE = ["docker", "compose", "-f", "ops/remediation-compose.yml"]


def main():
    if TARGET.exists():
        raise ValueError("Never overwrite a tuning run")
    TARGET.mkdir()
    with (TARGET / "services.txt").open("w") as log:
        subprocess.run(
            [*COMPOSE, "up", "-d", "--force-recreate", "api", "worker", "frontend"],
            stdout=log,
            stderr=log,
            check=True,
        )
    summary = []
    for workers, budget in [(1, 20), (1, 25), (2, 20), (2, 25)]:
        name = f"w{workers}-b{budget}"
        env = {**os.environ, "PHARMSHIFT_SEARCH_WORKERS": str(workers)}
        with (TARGET / (name + ".txt")).open("w") as log:
            subprocess.run(
                [*COMPOSE, "up", "-d", "--no-deps", "--force-recreate", "worker"],
                env=env,
                stdout=log,
                stderr=log,
                check=True,
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "scripts.remediation_benchmark",
                    "--base",
                    "http://127.0.0.1:18512",
                    "--split",
                    "tuning",
                    "--samples",
                    "1",
                    "--people",
                    "30",
                    "--days",
                    "28",
                    "--budget",
                    str(budget),
                    "--lookahead",
                    "14",
                    "--output",
                    str(TARGET / (name + ".jsonl")),
                ],
                env=env,
                stdout=log,
                stderr=log,
            )
        rows = (
            [
                json.loads(line)
                for line in (TARGET / (name + ".jsonl")).read_text().splitlines()
            ]
            if (TARGET / (name + ".jsonl")).exists()
            else []
        )
        summary.append(
            {
                "workers": workers,
                "budget": budget,
                "returncode": result.returncode,
                "scope": "one tuning input only; not acceptance percentiles",
                "rows": rows,
            }
        )
        (TARGET / "results.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2)
        )
        print(
            json.dumps(
                {
                    "workers": workers,
                    "budget": budget,
                    "returncode": result.returncode,
                    "statuses": [r["status"] for r in rows],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    ids = subprocess.check_output([*COMPOSE, "ps", "-q"], text=True).split()
    details = json.loads(
        subprocess.check_output(["docker", "inspect", *ids], text=True)
    )
    (TARGET / "resource-caps.json").write_text(
        json.dumps(
            [
                {
                    "service": d["Config"]["Labels"]["com.docker.compose.service"],
                    "image_id": d["Image"],
                    "nano_cpus": d["HostConfig"]["NanoCpus"],
                    "memory_bytes": d["HostConfig"]["Memory"],
                }
                for d in details
            ],
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
