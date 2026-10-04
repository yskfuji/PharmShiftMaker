"""Create and audit the history-free public candidate tree.

The command is fail-closed: it requires a clean commit, refuses an existing
destination, rejects symlinks and files over the public size limit, and records
every copied file by SHA-256.  It does not alter Git state or contact GitHub.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = Path(__file__).with_name("public-tree.json")


def policy() -> dict[str, object]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def included(relative: str, document: dict[str, object] | None = None) -> bool:
    rules = document or policy()
    exact = set(rules["excluded_exact"]) | set(rules["excluded_ideal_ui_documents"])
    prefixes = tuple(rules["excluded_prefixes"])
    return relative not in exact and not relative.startswith(prefixes)


def clean_commit() -> str:
    status = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=ROOT,
        text=True,
    )
    if status:
        raise SystemExit("Public export requires a clean worktree")
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    if len(commit) != 40:
        raise SystemExit("Public export requires a resolved commit")
    return commit


def tracked_files() -> list[str]:
    payload = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", "-z", "HEAD"], cwd=ROOT
    )
    return [item.decode("utf-8") for item in payload.split(b"\0") if item]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(destination: Path) -> None:
    commit = clean_commit()
    destination = destination.resolve()
    if destination.exists():
        raise SystemExit(f"Destination already exists: {destination}")
    if destination == ROOT.resolve() or ROOT.resolve() in destination.parents:
        raise SystemExit("Public export destination must be outside the repository")
    rules = policy()
    selected = [name for name in tracked_files() if included(name, rules)]
    selected_set = set(selected)
    missing = sorted(set(rules["required"]) - selected_set)
    if missing:
        raise SystemExit("Required public files are missing: " + ", ".join(missing))
    maximum = int(rules["maximum_file_bytes"])
    oversize: list[str] = []
    symlinks: list[str] = []
    for relative in selected:
        source = ROOT / relative
        if source.is_symlink():
            symlinks.append(relative)
        elif not source.is_file():
            raise SystemExit(f"Tracked public source is not a file: {relative}")
        elif source.stat().st_size > maximum:
            oversize.append(relative)
    if symlinks:
        raise SystemExit("Public tree contains symlinks: " + ", ".join(symlinks))
    if oversize:
        raise SystemExit(
            "Public tree contains files over 50 MB: " + ", ".join(oversize)
        )

    destination.mkdir(parents=True)
    for relative in selected:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    manifest = {
        "format": "PharmShiftMaker public tree manifest v1",
        "source_commit": commit,
        "policy_sha256": sha256(POLICY_PATH),
        "file_count": len(selected),
        "files": [
            {
                "path": relative,
                "bytes": (destination / relative).stat().st_size,
                "sha256": sha256(destination / relative),
            }
            for relative in sorted(selected)
        ],
    }
    (destination / "PUBLIC-MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    lines = [f"{item['sha256']}  {item['path']}\n" for item in manifest["files"]]
    (destination / "PUBLIC-MANIFEST.sha256").write_text(
        "".join(lines), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "destination": str(destination),
                "source_commit": commit,
                "file_count": len(selected),
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    export(args.destination)


if __name__ == "__main__":
    main()
