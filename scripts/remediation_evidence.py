"""Local source/evidence manifests; never treats hashes as signatures or acceptance."""

import hashlib
import json
import platform
import re
import subprocess
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    root = Path(__file__).resolve().parents[1]
    target = root / "audit/remediation-2026-09-22"
    for name in ("tested-code.json", "evidence-manifest.json"):
        if (target / name).exists():
            raise ValueError(
                "Use a new evidence namespace rather than overwrite a manifest"
            )
    ledger = json.loads((target / "checklist.json").read_text())
    expected = {
        f"{group}{i:02}"
        for group, count in [
            ("G", 5),
            ("L", 8),
            ("F", 8),
            ("D", 5),
            ("S", 6),
            ("O", 6),
            ("Q", 4),
        ]
        for i in range(1, count + 1)
    }
    actual = [r["id"] for r in ledger["items"]]
    if len(actual) != 42 or set(actual) != expected:
        raise ValueError("Audit IDs are missing or duplicated")
    files = set()
    for directory in [
        "src",
        "tests",
        "scripts",
        "alembic",
        "ops",
        ".github",
        "frontend/src",
        "frontend/tests",
        "frontend/scripts",
    ]:
        files.update(
            p
            for p in (root / directory).rglob("*")
            if p.is_file()
            and not p.is_symlink()
            and "__pycache__" not in p.parts
            and not any(part.endswith(".egg-info") for part in p.parts)
        )
    for directory in [root, root / "frontend"]:
        files.update(
            p
            for p in directory.iterdir()
            if p.is_file()
            and not p.is_symlink()
            and (
                p.suffix
                in {
                    ".md",
                    ".toml",
                    ".ini",
                    ".json",
                    ".js",
                    ".ts",
                    ".mjs",
                    ".yaml",
                    ".yml",
                }
                or p.name.startswith("Dockerfile")
                or p.name
                in {"requirements.lock", ".dockerignore", ".gitignore", ".env.example"}
            )
        )
    files = {
        p for p in files if not p.name.startswith(".env") or p.name == ".env.example"
    }
    source = {p.relative_to(root).as_posix(): digest(p) for p in sorted(files)}
    stamp = datetime.now(UTC).isoformat()
    code = {
        "recorded_at": stamp,
        "head": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip(),
        "dirty_tree": True,
        "scope": "Current source and tests. Earlier tuning/mutations used their own historical revisions; not this final source.",
        "platform": platform.platform(),
        "python": platform.python_version(),
        "files": source,
    }
    (target / "tested-code.json").write_text(
        json.dumps(code, ensure_ascii=False, indent=2) + "\n"
    )
    evidence = {
        p.relative_to(target).as_posix(): {
            "sha256": digest(p),
            "bytes": p.stat().st_size,
        }
        for p in sorted(target.rglob("*"))
        if p.is_file() and not p.is_symlink()
    }
    baseline = json.loads((target / "baseline.json").read_text())
    changes = {
        p: {"before": h, "after": digest(root / p) if (root / p).is_file() else None}
        for p, h in baseline["files"].items()
        if not (root / p).is_file() or digest(root / p) != h
    }
    checks = {}
    for name in [
        "report.md",
        "sources.md",
        "remaining.md",
        "visual-review.md",
        "migration-recovery.md",
        "checklist.md",
    ]:
        missing = []
        for link in re.findall(r"\]\(([^)]+)\)", (target / name).read_text()):
            if link.startswith(("http:", "https:", "#")):
                continue
            if (
                not (target / link.split("#")[0]).exists()
                and link != "evidence-manifest.json"
            ):
                missing.append(link)
        checks[name] = missing
    if any(checks.values()):
        raise ValueError(f"Broken artifact links: {checks}")
    manifest = {
        "recorded_at": stamp,
        "scope": "Local hashes, not signatures, legal certification or full acceptance",
        "ids": actual,
        "counts": dict(Counter(r["result"] for r in ledger["items"])),
        "baseline_changes": changes,
        "artifacts": evidence,
        "links_checked": checks,
        "acceptance_complete": False,
        "performance_1200_complete": False,
    }
    (target / "evidence-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "source_files": len(source),
                "evidence_files": len(evidence),
                "counts": manifest["counts"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
