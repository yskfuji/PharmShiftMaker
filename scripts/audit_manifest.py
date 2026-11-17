"""Hash reviewable source/evidence and check the 42-item ledger, without secrets."""

from __future__ import annotations

import hashlib
import json
import platform
import re
import subprocess
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    directory = root / "audit/implementation-2026-09-21"
    checklist = json.loads((directory / "checklist.json").read_text())
    ids = [item["id"] for item in checklist["items"]]
    original = (root / "audit/coverage-2026-09-21/checklist.md").read_text()
    expected = set(
        re.findall(
            r"\b(?:G0[1-5]|L0[1-8]|F0[1-8]|D0[1-5]|S0[1-6]|O0[1-6]|Q0[1-4])\b", original
        )
    )
    if len(ids) != 42 or len(set(ids)) != 42 or set(ids) != expected:
        raise ValueError("Acceptance IDs are missing or duplicated")
    baseline = json.loads((directory / "baseline.json").read_text())
    files = set()
    for source in (
        "src",
        "tests",
        "scripts",
        "alembic",
        "frontend/src",
        "frontend/tests",
        "frontend/scripts",
        "ops",
        ".github",
        "audit",
    ):
        for path in (root / source).rglob("*"):
            if (
                path.is_file()
                and not path.is_symlink()
                and "__pycache__" not in path.parts
            ):
                files.add(path)
    for path in [*root.iterdir(), *(root / "frontend").iterdir()]:
        if path.is_file() and (
            path.suffix
            in {".md", ".toml", ".json", ".ini", ".yml", ".yaml", ".js", ".ts"}
            or path.name
            in {
                "requirements.lock",
                ".env.example",
                ".gitignore",
                ".dockerignore",
                "Dockerfile.backend",
                "Dockerfile.frontend",
            }
        ):
            files.add(path)
    files.discard(directory / "final-manifest.json")
    records = {}
    for path in sorted(files):
        if path.name.startswith(".env") and path.name != ".env.example":
            continue
        contents = path.read_bytes()
        relative = path.relative_to(root).as_posix()
        records[relative] = {
            "sha256": hashlib.sha256(contents).hexdigest(),
            "bytes": len(contents),
        }
    changes = {}
    for relative, before in baseline["files"].items():
        path = root / relative
        after = (
            hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        )
        if before != after:
            changes[relative] = {"before": before, "after": after}
    benchmark = json.loads((directory / "benchmark.json").read_text())
    for relative, digest in benchmark["code_hashes"].items():
        if records[relative]["sha256"] != digest:
            raise ValueError(f"Benchmark code has changed: {relative}")
    result = {
        "generated_at": datetime.now(UTC).isoformat(),
        "head": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip(),
        "baseline_head": baseline["head"],
        "platform": platform.platform(),
        "python": platform.python_version(),
        "audit_counts": dict(Counter(item["result"] for item in checklist["items"])),
        "scope": "Source and audit evidence; no secret values, installed packages, build directories or production DB. Hashes are not signatures.",
        "baseline_file_changes": changes,
        "files": records,
    }
    (directory / "final-manifest.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "ledger_ids": len(ids),
                "counts": result["audit_counts"],
                "hashed_files": len(records),
                "baseline_changes": len(changes),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
