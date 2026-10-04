"""Collect license and notice texts for the locked, installed dependencies.

The checked-in manifest is deterministic: it is bound to both lockfiles and
deduplicates identical texts by SHA-256. Platform-specific npm packages that
are locked but not installed are recorded as such; they are not part of the
generated browser or server artifacts on this platform.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PYTHON_LOCK = ROOT / "requirements.lock"
NODE_LOCK = ROOT / "frontend/package-lock.json"
NODE_MODULES = ROOT / "frontend/node_modules"
OUTPUT = ROOT / "docs/release/THIRD_PARTY_LICENSES"
CANONICAL_LICENSES = Path(__file__).with_name("canonical_licenses")
LICENSE_PREFIXES = ("license", "licence", "copying", "notice", "copyright")
CANONICAL_BY_EXPRESSION = {
    "MIT": "MIT.txt",
    "Apache-2.0": "Apache-2.0.txt",
    "BSD-2-Clause": "BSD-2-Clause.txt",
    "CC0-1.0": "CC0-1.0.txt",
    "ISC": "ISC.txt",
    "LGPL-3.0-or-later": "LGPL-3.0-or-later.txt",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def license_expression(metadata: importlib.metadata.PackageMetadata) -> str | None:
    value = metadata.get("License-Expression") or metadata.get("License")
    if value and str(value).strip().upper() not in {"UNKNOWN", "NONE"}:
        return str(value).strip()
    classifiers = [
        item.removeprefix("License :: ")
        for item in metadata.get_all("Classifier", [])
        if item.startswith("License :: ")
    ]
    return "; ".join(classifiers) or None


def python_locked() -> list[tuple[str, str]]:
    found = []
    for line in PYTHON_LOCK.read_text(encoding="utf-8").splitlines():
        match = re.match(r"([A-Za-z0-9_.-]+)==([^\s\\]+)\s*\\?$", line)
        if match:
            found.append(match.groups())
    return found


def direct_license_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return [
        path
        for path in sorted(directory.iterdir(), key=lambda item: item.name.lower())
        if path.is_file() and path.name.lower().startswith(LICENSE_PREFIXES)
    ]


def collect() -> tuple[dict[str, Any], dict[str, bytes]]:
    texts: dict[str, bytes] = {}
    packages: list[dict[str, Any]] = []
    unresolved: list[dict[str, str]] = []

    for name, expected_version in python_locked():
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            unresolved.append(
                {"ecosystem": "pypi", "name": name, "reason": "not installed"}
            )
            continue
        expression = license_expression(distribution.metadata)
        files = []
        for relative in distribution.files or []:
            if not relative.name.lower().startswith(LICENSE_PREFIXES):
                continue
            source = Path(distribution.locate_file(relative))
            if not source.is_file():
                continue
            content = source.read_bytes()
            digest = sha256(content)
            texts[digest] = content
            files.append({"source": relative.as_posix(), "sha256": digest})
        if distribution.version != expected_version or not expression or not files:
            unresolved.append(
                {
                    "ecosystem": "pypi",
                    "name": name,
                    "reason": "version, license metadata, or license text is unverified",
                }
            )
        packages.append(
            {
                "ecosystem": "pypi",
                "name": distribution.metadata.get("Name") or name,
                "version": distribution.version,
                "license": expression,
                "installed": True,
                "license_files": files,
            }
        )

    lock = json.loads(NODE_LOCK.read_text(encoding="utf-8"))
    for location, value in sorted(lock.get("packages", {}).items()):
        if not location or not isinstance(value, dict) or not value.get("version"):
            continue
        name = value.get("name") or location.rsplit("node_modules/", 1)[-1]
        package_root = ROOT / "frontend" / location
        installed = package_root.is_dir()
        metadata: dict[str, Any] = {}
        package_json = package_root / "package.json"
        if package_json.is_file():
            metadata = json.loads(package_json.read_text(encoding="utf-8"))
        expression: Any = metadata.get("license", value.get("license"))
        if isinstance(expression, list):
            expression = " OR ".join(
                str(item.get("type", item)) if isinstance(item, dict) else str(item)
                for item in expression
            )
        files = []
        for source in direct_license_files(package_root):
            content = source.read_bytes()
            digest = sha256(content)
            texts[digest] = content
            files.append({"source": source.name, "sha256": digest})
        license_text_basis = "installed distribution"
        canonical_name = CANONICAL_BY_EXPRESSION.get(str(expression))
        if installed and not files and canonical_name:
            canonical = CANONICAL_LICENSES / canonical_name
            if canonical.is_file():
                content = canonical.read_bytes()
                digest = sha256(content)
                texts[digest] = content
                files.append(
                    {"source": f"canonical/{canonical_name}", "sha256": digest}
                )
                license_text_basis = (
                    "canonical terms; package name, version, author and repository "
                    "identify the corresponding rights holder notice"
                )
        if not expression or (installed and not files):
            unresolved.append(
                {
                    "ecosystem": "npm",
                    "name": str(name),
                    "reason": "license metadata or installed license text is unverified",
                }
            )
        packages.append(
            {
                "ecosystem": "npm",
                "name": name,
                "version": str(value["version"]),
                "location": location,
                "license": str(expression) if expression else None,
                "author": metadata.get("author"),
                "repository": metadata.get("repository"),
                "installed": installed,
                "license_files": files,
                "license_text_basis": (
                    license_text_basis if installed else "not installed"
                ),
            }
        )

    document = {
        "format": "PharmShiftMaker third-party license manifest v1",
        "sources": {
            "requirements.lock": sha256(PYTHON_LOCK.read_bytes()),
            "frontend/package-lock.json": sha256(NODE_LOCK.read_bytes()),
        },
        "package_count": len(packages),
        "license_text_count": len(texts),
        "unresolved_count": len(unresolved),
        "unresolved": unresolved,
        "packages": sorted(
            packages,
            key=lambda item: (
                item["ecosystem"],
                str(item["name"]).lower(),
                item["version"],
                item.get("location", ""),
            ),
        ),
    }
    return document, texts


def rendered() -> dict[str, bytes]:
    manifest, texts = collect()
    if manifest["unresolved_count"]:
        details = ", ".join(
            f"{item['ecosystem']}:{item['name']}" for item in manifest["unresolved"]
        )
        raise SystemExit(f"Unresolved third-party licenses: {details}")
    files = {
        "manifest.json": (
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        ).encode(),
    }
    files.update({f"texts/{digest}.txt": content for digest, content in texts.items()})
    return files


def write(files: dict[str, bytes]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="third-party-licenses-", dir=OUTPUT.parent
    ) as temporary:
        staging = Path(temporary) / OUTPUT.name
        for relative, content in files.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        shutil.copytree(staging, OUTPUT)


def current() -> dict[str, bytes]:
    if not OUTPUT.is_dir():
        return {}
    return {
        path.relative_to(OUTPUT).as_posix(): path.read_bytes()
        for path in OUTPUT.rglob("*")
        if path.is_file()
    }


def validate_current() -> list[str]:
    """Validate the checked-in bundle from lockfiles without trusting host packages."""
    failures: list[str] = []
    files = current()
    try:
        manifest = json.loads(files["manifest.json"])
    except (KeyError, json.JSONDecodeError):
        return ["manifest.json is missing or invalid"]
    expected_sources = {
        "requirements.lock": sha256(PYTHON_LOCK.read_bytes()),
        "frontend/package-lock.json": sha256(NODE_LOCK.read_bytes()),
    }
    if manifest.get("sources") != expected_sources:
        failures.append("manifest lockfile hashes are stale")
    if manifest.get("unresolved_count") != 0 or manifest.get("unresolved") != []:
        failures.append("manifest contains unresolved licenses")

    expected_python = {
        (re.sub(r"[-_.]+", "-", name).lower(), version)
        for name, version in python_locked()
    }
    lock = json.loads(NODE_LOCK.read_text(encoding="utf-8"))
    expected_node = {
        (
            str(value.get("name") or location.rsplit("node_modules/", 1)[-1]),
            str(value["version"]),
            location,
        )
        for location, value in lock.get("packages", {}).items()
        if location and isinstance(value, dict) and value.get("version")
    }
    packages = manifest.get("packages", [])
    actual_python = {
        (re.sub(r"[-_.]+", "-", str(item["name"])).lower(), str(item["version"]))
        for item in packages
        if item.get("ecosystem") == "pypi"
    }
    actual_node = {
        (str(item["name"]), str(item["version"]), str(item["location"]))
        for item in packages
        if item.get("ecosystem") == "npm"
    }
    if actual_python != expected_python:
        failures.append("Python package identities do not match requirements.lock")
    if actual_node != expected_node:
        failures.append("npm package identities do not match package-lock.json")
    if manifest.get("package_count") != len(packages):
        failures.append("package_count does not match manifest entries")

    referenced: set[str] = set()
    for item in packages:
        if not item.get("license"):
            failures.append(
                f"{item.get('ecosystem')}:{item.get('name')} has no license"
            )
        license_files = item.get("license_files")
        if item.get("installed") and not license_files:
            failures.append(
                f"{item.get('ecosystem')}:{item.get('name')} has no license text"
            )
        for license_file in license_files or []:
            digest = license_file.get("sha256")
            relative = f"texts/{digest}.txt"
            content = files.get(relative)
            if (
                not isinstance(digest, str)
                or content is None
                or sha256(content) != digest
            ):
                failures.append(
                    f"{item.get('ecosystem')}:{item.get('name')} has an invalid text hash"
                )
            else:
                referenced.add(relative)
    present_texts = {name for name in files if name.startswith("texts/")}
    if referenced != present_texts:
        failures.append("license text set and manifest references differ")
    if manifest.get("license_text_count") != len(present_texts):
        failures.append("license_text_count does not match files")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-installed", action="store_true")
    args = parser.parse_args()
    if args.write:
        files = rendered()
        write(files)
        print(f"wrote {len(files)} files under {OUTPUT.relative_to(ROOT)}")
    elif args.check:
        failures = validate_current()
        if failures:
            raise SystemExit(
                "Third-party license bundle is invalid: " + "; ".join(failures)
            )
        print(f"Third-party license bundle is current ({len(current())} files)")
    elif args.check_installed:
        files = rendered()
        if current() != files:
            raise SystemExit(
                "Third-party license bundle is stale; run collect_licenses --write"
            )
        print(
            f"Third-party license bundle matches installed distributions ({len(files)} files)"
        )
    else:
        files = rendered()
        print(files["manifest.json"].decode(), end="")


if __name__ == "__main__":
    main()
