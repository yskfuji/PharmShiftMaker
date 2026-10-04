"""Build the deterministic, checksummed offline cognitive ideal-UI v3 package.

Generated screenshots and archives stay outside the repository by default. The
package records pending human/field gates instead of presenting an automated
audit as WCAG conformance or production acceptance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import tempfile
import tomllib
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from shift_scheduler.api.main import app

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_NAME = "pharmshift-ideal-ui-v3"
FIXED_TIME = (2026, 10, 2, 0, 0, 0)
FIXED_GENERATED_AT = "2026-10-02T00:00:00+00:00"
REQUIRED_VERIFICATION_CHECKS = {
    "python",
    "frontend_jest",
    "typescript",
    "next_build",
    "storybook",
    "flag_off_e2e",
    "ideal_u01_u27",
    "role_route_optical",
    "security_counterexamples",
    "secret_scan",
    "license_scan",
    "file_size_scan",
    "independent_review",
}
MAX_ARTIFACT_FILE_BYTES = 50_000_000
MAX_ARTIFACT_TREE_BYTES = 2_000_000_000
PACKAGE_IDEAL_UI_FILES = (
    "README.md",
    "acceptance-matrix.md",
    "evidence.md",
    "independent-review-v3.md",
    "research/analyze_study.py",
    "research/assistive-technology-protocol.md",
    "research/participant-results-template.csv",
    "research/usability-protocol.md",
    "usecases.json",
    "v3-design-rationale.md",
    "verification.md",
)
CANONICAL_SBOM = ROOT / "docs/release/SBOM.cdx.json"
THIRD_PARTY_LICENSES = ROOT / "docs/release/THIRD_PARTY_LICENSES"

LANDING = """<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PharmShiftMaker 認知中心UI v3</title>
<style>body{font-family:system-ui,sans-serif;max-width:58rem;margin:8vh auto;padding:1.5rem;color:#17344a;background:#f5f7f5}main{background:white;border:1px solid #dce3ec;border-radius:1.2rem;padding:2rem}a{display:inline-flex;min-height:44px;align-items:center;margin:.3rem;padding:.5rem 1rem;border-radius:.6rem;color:white;background:#0e6f69}small{color:#526176}</style>
<main><small>合成データ・評価用 / OFFLINE PACKAGE</small><h1>PharmShiftMaker 認知中心UI v3</h1>
<p>実在する職員・施設・患者の情報を含まない、認知中心の8画面・25子画面・27業務系列レビュー用ショーケースです。</p>
<a href="storybook/index.html">Storybookを開く</a><!-- GALLERY --><a href="docs/ideal-ui/README.md">プレビュー手順</a>
<a href="docs/architecture/er/usecase-sequences.md">27系列の図とテキスト表</a>
<p><small>公開・外部デプロイは行っていません。MANIFEST.sha256で内容を検証できます。自動検査は人間評価やWCAG適合認定の代替ではありません。</small></p></main></html>"""


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_tree_inventory(root: Path) -> dict[str, int | str]:
    """Describe a regular-file tree without following links or special files."""
    root = root.resolve(strict=False) if not root.is_symlink() else root
    try:
        root_stat = root.lstat()
    except FileNotFoundError as error:
        raise SystemExit(f"Artifact tree not found: {root}") from error
    if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
        raise SystemExit(f"Artifact tree must be a real directory: {root}")
    files: list[tuple[str, int, str]] = []
    total = 0

    def visit(directory: Path) -> None:
        nonlocal total
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                path = Path(entry.path)
                metadata = entry.stat(follow_symlinks=False)
                relative = path.relative_to(root).as_posix()
                if stat.S_ISLNK(metadata.st_mode):
                    raise SystemExit(
                        f"Artifact tree contains a symbolic link: {root.name}/{relative}"
                    )
                if stat.S_ISDIR(metadata.st_mode):
                    visit(path)
                    continue
                if not stat.S_ISREG(metadata.st_mode):
                    raise SystemExit(
                        f"Artifact tree contains a non-regular file: {root.name}/{relative}"
                    )
                if metadata.st_size > MAX_ARTIFACT_FILE_BYTES:
                    raise SystemExit(
                        f"Artifact file exceeds 50 MB: {root.name}/{relative}"
                    )
                total += metadata.st_size
                if total > MAX_ARTIFACT_TREE_BYTES:
                    raise SystemExit(f"Artifact tree exceeds 2 GB: {root}")
                files.append((relative, metadata.st_size, digest(path)))

    visit(root)
    state = hashlib.sha256()
    for relative, size, sha256 in files:
        state.update(f"{relative}\0{size}\0{sha256}\n".encode())
    return {
        "file_count": len(files),
        "total_bytes": total,
        "tree_sha256": state.hexdigest(),
    }


def require_regular_file(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise SystemExit(f"{label} not found: {path}") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise SystemExit(f"{label} must be a regular file: {path}")
    if metadata.st_size > MAX_ARTIFACT_FILE_BYTES:
        raise SystemExit(f"{label} exceeds 50 MB: {path}")


def artifact_bundle_digest(inventories: dict[str, dict[str, int | str]]) -> str:
    state = hashlib.sha256()
    for label, inventory in sorted(inventories.items()):
        state.update(f"{label}\0{inventory['tree_sha256']}\n".encode())
    return state.hexdigest()


def validate_artifact_evidence(
    verification: dict[str, Any],
    inventories: dict[str, dict[str, int | str]],
    verification_assets: Path,
) -> None:
    expected = verification.get("artifact_trees")
    if expected != inventories:
        raise SystemExit(
            "Verification manifest does not match the package artifact trees"
        )
    bundle = artifact_bundle_digest(inventories)
    evidence = verification.get("required_check_evidence")
    if not isinstance(evidence, dict):
        raise SystemExit("Verification manifest has no required_check_evidence object")
    if set(evidence) != REQUIRED_VERIFICATION_CHECKS:
        missing = sorted(REQUIRED_VERIFICATION_CHECKS - set(evidence))
        unexpected = sorted(set(evidence) - REQUIRED_VERIFICATION_CHECKS)
        raise SystemExit(
            "Verification evidence does not exactly cover required checks: "
            f"missing={','.join(missing) or '-'}; "
            f"unexpected={','.join(unexpected) or '-'}"
        )
    source = verification.get("source_state_sha256")
    assets_root = verification_assets.resolve()
    for check in sorted(REQUIRED_VERIFICATION_CHECKS):
        item = evidence[check]
        if (
            not isinstance(item, dict)
            or item.get("source_state_sha256") != source
            or item.get("artifact_bundle_sha256") != bundle
        ):
            raise SystemExit(
                f"{check} evidence does not match the exact package inputs"
            )
        relative = item.get("path")
        expected_sha256 = item.get("sha256")
        if (
            not isinstance(relative, str)
            or not relative
            or Path(relative).is_absolute()
        ):
            raise SystemExit(f"{check} evidence has an invalid relative path")
        evidence_path = (assets_root / relative).resolve()
        if assets_root != evidence_path and assets_root not in evidence_path.parents:
            raise SystemExit(f"{check} evidence escapes the verification asset tree")
        require_regular_file(evidence_path, f"{check} evidence")
        if (
            not isinstance(expected_sha256, str)
            or digest(evidence_path) != expected_sha256
        ):
            raise SystemExit(
                f"{check} evidence hash does not match its recorded result"
            )


def scan_package_tree(root: Path, gitleaks: Path, report: Path) -> None:
    require_regular_file(gitleaks, "gitleaks binary")
    version = subprocess.run(
        [str(gitleaks), "version"], capture_output=True, text=True, check=False
    )
    if version.returncode != 0 or "8.30.1" not in version.stdout:
        raise SystemExit("Package generation requires gitleaks v8.30.1")
    result = subprocess.run(
        [
            str(gitleaks),
            "dir",
            "--config",
            str(ROOT / ".gitleaks.toml"),
            "--redact",
            "--no-banner",
            "--no-color",
            "--report-format",
            "json",
            "--report-path",
            str(report),
            str(root),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit("Secret scan rejected the exact package contents")


def command(*args: str) -> str | None:
    try:
        return subprocess.check_output(
            args, cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def require_clean_commit() -> str:
    """Return HEAD only when the package source is a clean, reproducible commit."""
    commit = command("git", "rev-parse", "HEAD")
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("A committed Git source revision is required")
    status = command("git", "status", "--porcelain=v1", "--untracked-files=all")
    if status:
        raise SystemExit("Package generation requires a clean worktree")
    return commit


def validate_verification(verification: dict[str, Any], commit: str) -> None:
    expected_source = source_state_digest()
    if verification.get("source_commit") != commit:
        raise SystemExit("Verification manifest does not match the current commit")
    if verification.get("source_state_sha256") != expected_source:
        raise SystemExit(
            "Verification manifest does not match the current source state"
        )
    checks = verification.get("required_checks")
    if not isinstance(checks, dict):
        raise SystemExit("Verification manifest has no required_checks object")
    missing = sorted(REQUIRED_VERIFICATION_CHECKS - set(checks))
    failed = sorted(
        name for name in REQUIRED_VERIFICATION_CHECKS if checks.get(name) != "passed"
    )
    if missing or failed:
        detail = []
        if missing:
            detail.append("missing=" + ",".join(missing))
        if failed:
            detail.append("not-passed=" + ",".join(failed))
        raise SystemExit(
            "Required verification gates are incomplete: " + "; ".join(detail)
        )


def source_state_digest() -> str:
    """Hash every tracked or untracked source path, including tracked deletions."""
    listed = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    ).split(b"\0")
    state = hashlib.sha256()
    for raw in sorted(path for path in listed if path):
        relative = raw.decode("utf-8", errors="surrogateescape")
        path = ROOT / relative
        state.update(raw + b"\0")
        if path.is_symlink():
            state.update(b"symlink\0" + str(path.readlink()).encode("utf-8") + b"\0")
        elif path.is_file():
            state.update(b"file\0" + hashlib.sha256(path.read_bytes()).digest())
        else:
            state.update(b"deleted\0")
    return state.hexdigest()


def dependency_inventory() -> dict[str, Any]:
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    node = []
    for location, value in sorted(lock.get("packages", {}).items()):
        if not location or not isinstance(value, dict) or not value.get("version"):
            continue
        name = value.get("name") or location.rsplit("node_modules/", 1)[-1]
        node.append({"name": name, "version": value["version"], "location": location})
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return {
        "format": "PharmShift dependency inventory v1",
        "not_a_vulnerability_attestation": True,
        "node": node,
        "python_declared": project["project"]["dependencies"],
    }


def source_manifest(node_binary: Path | None) -> dict[str, Any]:
    node_version = command(str(node_binary), "--version") if node_binary else None
    package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    return {
        "package": PACKAGE_NAME,
        "generated_at": FIXED_GENERATED_AT,
        "source": {
            "commit": command("git", "rev-parse", "HEAD"),
            "branch": command("git", "branch", "--show-current"),
            "worktree_dirty": bool(command("git", "status", "--porcelain")),
            "state_sha256": source_state_digest(),
        },
        "runtime": {
            "python": platform.python_version(),
            "node": node_version,
            "required_node": package.get("engines", {}).get("node"),
            "next": package["dependencies"]["next"],
            "react": package["dependencies"]["react"],
            "playwright": package["devDependencies"]["@playwright/test"],
        },
        "scope": {
            "primary_pages": 8,
            "child_routes": 25,
            "use_cases": 27,
            "data": "synthetic only",
            "deployment": False,
        },
        "release_gates": {
            "software": "see docs/ideal-ui/acceptance-matrix.md and verification.md",
            "participants_30": "pending",
            "voiceover_nvda_real_device": "pending",
            "field_core_web_vitals_p75": "pending",
            "production_default_IDEAL_UI": "off",
        },
    }


def package(
    storybook: Path,
    output: Path,
    gallery: Path,
    node_binary: Path | None,
    verification_manifest: Path,
    verification_assets: Path,
    gitleaks: Path,
) -> None:
    commit = require_clean_commit()
    output = output.resolve()
    try:
        output.relative_to(ROOT.resolve())
    except ValueError:
        pass
    else:
        raise SystemExit("Package output must be outside the repository")
    if not (storybook / "index.html").is_file():
        raise SystemExit(f"Storybook build not found: {storybook}")
    required = [
        ROOT / "docs/ideal-ui/usecases.json",
        ROOT / "docs/architecture/er/physical.mmd",
        ROOT / "docs/architecture/er/logical.md",
        ROOT / "docs/architecture/er/usecase-sequences.md",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Required review inputs are missing: " + ", ".join(missing))
    for label, path, kind in (
        ("Gallery", gallery, "directory"),
        ("Verification assets", verification_assets, "directory"),
        ("Verification manifest", verification_manifest, "file"),
    ):
        valid = path.is_dir() if kind == "directory" else path.is_file()
        if not valid:
            raise SystemExit(f"{label} not found: {path}")
    require_regular_file(verification_manifest, "Verification manifest")
    inventories = {
        "gallery": safe_tree_inventory(gallery),
        "storybook": safe_tree_inventory(storybook),
        "verification_assets": safe_tree_inventory(verification_assets),
    }
    for internal in (
        ROOT / "docs/ideal-ui",
        ROOT / "docs/architecture/er",
        THIRD_PARTY_LICENSES,
    ):
        safe_tree_inventory(internal)
    for source, label in (
        (ROOT / "LICENSE", "Project license"),
        (ROOT / "THIRD_PARTY_NOTICES.md", "Third-party notices"),
        (ROOT / "frontend/src/ideal/types.ts", "Public TypeScript types"),
    ):
        require_regular_file(source, label)
    if inventories["gallery"]["file_count"] == 0:
        raise SystemExit(f"Gallery is empty: {gallery}")
    if inventories["verification_assets"]["file_count"] == 0:
        raise SystemExit(f"Verification assets are empty: {verification_assets}")
    verification = json.loads(verification_manifest.read_text(encoding="utf-8"))
    validate_verification(verification, commit)
    validate_artifact_evidence(verification, inventories, verification_assets)
    with tempfile.TemporaryDirectory(prefix="pharmshift-ideal-package-") as temp:
        root = Path(temp) / PACKAGE_NAME
        root.mkdir()
        gallery_link = '<a href="gallery/index.html">画面ギャラリー</a>'
        (root / "index.html").write_text(
            LANDING.replace("<!-- GALLERY -->", gallery_link), encoding="utf-8"
        )
        shutil.copytree(storybook, root / "storybook")
        for relative in PACKAGE_IDEAL_UI_FILES:
            source = ROOT / "docs/ideal-ui" / relative
            require_regular_file(source, f"Packaged ideal-UI document {relative}")
            target = root / "docs/ideal-ui" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        shutil.copytree(ROOT / "docs/architecture/er", root / "docs/architecture/er")
        shutil.copy2(ROOT / "LICENSE", root / "LICENSE")
        shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", root / "THIRD_PARTY_NOTICES.md")
        require_regular_file(
            THIRD_PARTY_LICENSES / "manifest.json", "Third-party license manifest"
        )
        shutil.copytree(
            THIRD_PARTY_LICENSES, root / "docs/release/THIRD_PARTY_LICENSES"
        )
        shutil.copytree(gallery, root / "gallery")
        shutil.copytree(verification_assets, root / "verification")
        schema = app.openapi()
        (root / "openapi.json").write_text(
            json.dumps(schema, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        shutil.copy2(ROOT / "frontend/src/ideal/types.ts", root / "public-types.ts")
        (root / "DEPENDENCIES.json").write_text(
            json.dumps(
                dependency_inventory(), ensure_ascii=False, sort_keys=True, indent=2
            )
            + "\n",
            encoding="utf-8",
        )
        require_regular_file(CANONICAL_SBOM, "Canonical SBOM")
        shutil.copy2(CANONICAL_SBOM, root / "SBOM.cdx.json")
        (root / "docs/release").mkdir(parents=True, exist_ok=True)
        shutil.copy2(CANONICAL_SBOM, root / "docs/release/SBOM.cdx.json")
        (root / "RUN-MANIFEST.json").write_text(
            json.dumps(
                source_manifest(node_binary),
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        shutil.copy2(verification_manifest, root / "VERIFICATION-MANIFEST.json")
        # Re-check the assembled tree as a single trust boundary. copy2/copytree
        # must never turn a later tracked symlink or oversized input into an
        # unnoticed regular file in the distributable archive.
        safe_tree_inventory(root)
        scan_package_tree(root, gitleaks, Path(temp) / "gitleaks-package.json")
        files = sorted(path for path in root.rglob("*") if path.is_file())
        manifest = "".join(
            f"{digest(path)}  {path.relative_to(root).as_posix()}\n" for path in files
        )
        (root / "MANIFEST.sha256").write_text(manifest, encoding="utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(
            output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for path in sorted(p for p in root.rglob("*") if p.is_file()):
                info = zipfile.ZipInfo(
                    (Path(root.name) / path.relative_to(root)).as_posix(), FIXED_TIME
                )
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())
    print(f"{output} sha256={digest(output)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--storybook", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--gallery", required=True, type=Path)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--verification-manifest", required=True, type=Path)
    parser.add_argument("--verification-assets", required=True, type=Path)
    parser.add_argument("--gitleaks", required=True, type=Path)
    args = parser.parse_args()
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = (
        args.output
        or Path("/private/tmp/pharmshift-artifacts") / run_id / f"{PACKAGE_NAME}.zip"
    )
    package(
        args.storybook.absolute(),
        output.resolve(),
        args.gallery.absolute(),
        args.node.resolve() if args.node else None,
        args.verification_manifest.absolute(),
        args.verification_assets.absolute(),
        args.gitleaks.absolute(),
    )
