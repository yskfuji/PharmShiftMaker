"""Copy the license texts of the bundled runtimes into the assembled runtime.

Usage: python -I copy_licenses.py REPO_ROOT macos|windows RUNTIME_DIR

Every text listed in desktop/licenses/manifest.json for the platform is checked
against its recorded SHA-256 and copied to RUNTIME_DIR/licenses/. The texts of
the Python and npm dependencies (docs/release/THIRD_PARTY_LICENSES) and the
Node.js license are copied next to them. Any mismatch or missing file stops the
build, so a bundle is never shipped without its notices.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("macos", "windows"):
        print(__doc__, file=sys.stderr)
        return 64
    root, platform, runtime = Path(argv[0]), argv[1], Path(argv[2])
    source = root / "desktop" / "licenses"
    target = runtime / "licenses"
    if target.exists():
        shutil.rmtree(target)
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    listed = {entry["path"] for entry in manifest["files"]}
    on_disk = {
        path.relative_to(source).as_posix()
        for path in source.rglob("*.txt")
        if path.is_file()
    }
    if listed != on_disk:
        raise SystemExit(f"manifest and texts differ: {sorted(listed ^ on_disk)}")
    copied = []
    for entry in manifest["files"]:
        if platform not in entry["platforms"]:
            continue
        text = source / entry["path"]
        if hashlib.sha256(text.read_bytes()).hexdigest() != entry["sha256"]:
            raise SystemExit(f"checksum mismatch: {entry['path']}")
        destination = target / entry["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(text, destination)
        copied.append(entry)
    shutil.copyfile(source / "manifest.json", target / "manifest.json")
    shutil.copyfile(source / "README.md", target / "README.md")
    shutil.copytree(
        root / "docs" / "release" / "THIRD_PARTY_LICENSES", target / "dependencies"
    )
    node_license = runtime / "node" / "LICENSE"
    if not node_license.is_file():
        raise SystemExit("node/LICENSE is missing")
    (target / "node").mkdir()
    shutil.copyfile(node_license, target / "node" / "LICENSE")
    print(f"licenses: {len(copied)} runtime texts for {platform}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
