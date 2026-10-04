"""Fail when a locked Python distribution is absent, mismatched or unlicensed."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "requirements.lock"


def locked() -> list[tuple[str, str]]:
    result = []
    for line in LOCK.read_text(encoding="utf-8").splitlines():
        match = re.match(r"([A-Za-z0-9_.-]+)==([^\s\\]+)\s*\\?$", line)
        if match:
            result.append(match.groups())
    return result


def normalized(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def audit() -> dict[str, object]:
    packages = []
    unresolved = []
    for name, expected_version in locked():
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            unresolved.append(
                {"name": name, "version": expected_version, "reason": "not installed"}
            )
            continue
        actual_version = distribution.version
        metadata = distribution.metadata
        license_value = metadata.get("License-Expression") or metadata.get("License")
        if license_value and str(license_value).strip().upper() in {"UNKNOWN", "NONE"}:
            license_value = None
        if not license_value:
            classifiers = [
                item.removeprefix("License :: ")
                for item in metadata.get_all("Classifier", [])
                if item.startswith("License :: ")
            ]
            license_value = "; ".join(classifiers) or None
        reason = None
        if actual_version != expected_version:
            reason = f"installed version {actual_version} does not match lock"
        elif not license_value:
            reason = "license metadata is absent"
        if reason:
            unresolved.append(
                {"name": name, "version": expected_version, "reason": reason}
            )
        else:
            packages.append(
                {
                    "name": metadata.get("Name") or name,
                    "version": actual_version,
                    "license": str(license_value).strip(),
                }
            )
    return {
        "format": "PharmShiftMaker Python license audit v1",
        "source": "requirements.lock plus installed distribution metadata",
        "package_count": len(packages),
        "unresolved_count": len(unresolved),
        "packages": sorted(packages, key=lambda item: normalized(str(item["name"]))),
        "unresolved": unresolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit()
    rendered = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    if report["unresolved_count"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
