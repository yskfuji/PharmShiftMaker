"""Generate the checked-in CycloneDX inventory from the two lockfiles."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import quote
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[2]
PYTHON_LOCK = ROOT / "requirements.lock"
NODE_LOCK = ROOT / "frontend/package-lock.json"
OUTPUT = ROOT / "docs/release/SBOM.cdx.json"


def python_components() -> list[dict[str, str]]:
    components = []
    for line in PYTHON_LOCK.read_text(encoding="utf-8").splitlines():
        match = re.match(r"([A-Za-z0-9_.-]+)==([^\s\\]+)\s*\\?$", line)
        if match:
            name, version = match.groups()
            components.append(
                {
                    "type": "library",
                    "name": name,
                    "version": version,
                    "purl": f"pkg:pypi/{name.lower().replace('_', '-')}@{version}",
                }
            )
    return components


def node_components() -> list[dict[str, str]]:
    lock = json.loads(NODE_LOCK.read_text(encoding="utf-8"))
    found: dict[tuple[str, str], dict[str, str]] = {}
    for location, value in lock.get("packages", {}).items():
        if not location or not isinstance(value, dict) or not value.get("version"):
            continue
        name = value.get("name") or location.rsplit("node_modules/", 1)[-1]
        version = str(value["version"])
        found[(name, version)] = {
            "type": "library",
            "name": name,
            "version": version,
            "purl": f"pkg:npm/{quote(name, safe='/')}@{version}",
        }
    return list(found.values())


def render() -> str:
    lock_hash = hashlib.sha256(
        PYTHON_LOCK.read_bytes() + b"\0" + NODE_LOCK.read_bytes()
    ).hexdigest()
    components = sorted(
        python_components() + node_components(),
        key=lambda item: (item["purl"].lower(), item["version"]),
    )
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid5(NAMESPACE_URL, 'PharmShiftMaker:' + lock_hash)}",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "PharmShiftMaker",
                "version": "0.1.0",
            },
            "properties": [
                {"name": "pharmshiftmaker:lockfiles-sha256", "value": lock_hash},
                {
                    "name": "pharmshiftmaker:vulnerability-attestation",
                    "value": "false",
                },
            ],
        },
        "components": components,
    }
    return json.dumps(document, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.write:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(expected, encoding="utf-8")
        print(f"wrote {OUTPUT.relative_to(ROOT)}")
        return
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit(
                "SBOM is stale; run devtools.release.generate_sbom --write"
            )
        print("SBOM is current")
        return
    print(expected, end="")


if __name__ == "__main__":
    main()
