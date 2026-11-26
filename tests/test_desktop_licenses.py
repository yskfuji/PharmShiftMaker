"""License texts of the runtimes bundled with the desktop edition."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LICENSES = ROOT / "desktop" / "licenses"
SCRIPT = ROOT / "desktop" / "scripts" / "copy_licenses.py"

# Components every bundle must carry a text for (see desktop/licenses/README.md).
REQUIRED = {
    "macos": {
        "PostgreSQL",
        "OpenSSL",
        "ICU",
        "libxml2",
        "libxslt",
        "zlib",
        "LZ4",
        "Zstandard",
        "MIT Kerberos",
        "libedit",
        "GNU libiconv",
        "python-build-standalone 20261021 / cpython",
    },
    "windows": {
        "PostgreSQL",
        "OpenSSL",
        "ICU",
        "libxml2",
        "libxslt",
        "zlib",
        "LZ4",
        "Zstandard",
        "GNU libiconv",
        "GNU gettext libintl",
        "winpthreads",
        "python-build-standalone 20261021 / cpython",
    },
}


def _manifest() -> dict:
    return json.loads((LICENSES / "manifest.json").read_text(encoding="utf-8"))


def test_manifest_lists_every_text_with_its_checksum() -> None:
    entries = _manifest()["files"]
    listed = {entry["path"] for entry in entries}
    on_disk = {
        path.relative_to(LICENSES).as_posix() for path in LICENSES.rglob("*.txt")
    }
    assert listed == on_disk
    for entry in entries:
        data = (LICENSES / entry["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
        assert data.strip(), entry["path"]
        assert entry["platforms"] and set(entry["platforms"]) <= {"macos", "windows"}
        assert entry["source"] and entry["license"], entry["path"]


@pytest.mark.parametrize("platform", ["macos", "windows"])
def test_each_platform_carries_the_required_components(platform: str) -> None:
    components = " | ".join(
        entry["component"]
        for entry in _manifest()["files"]
        if platform in entry["platforms"]
    )
    missing = [name for name in REQUIRED[platform] if name not in components]
    assert not missing


@pytest.mark.parametrize("platform", ["macos", "windows"])
def test_copy_into_a_runtime(tmp_path: Path, platform: str) -> None:
    runtime = tmp_path / "runtime"
    (runtime / "node").mkdir(parents=True)
    (runtime / "node" / "LICENSE").write_text("Node.js license")
    subprocess.run(
        [sys.executable, "-I", "-B", str(SCRIPT), str(ROOT), platform, str(runtime)],
        check=True,
        capture_output=True,
    )
    target = runtime / "licenses"
    expected = {
        entry["path"]
        for entry in _manifest()["files"]
        if platform in entry["platforms"]
    }
    copied = {
        path.relative_to(target).as_posix()
        for path in target.rglob("*.txt")
        if not path.relative_to(target).as_posix().startswith("dependencies/")
    }
    assert copied == expected
    assert (target / "node" / "LICENSE").read_text() == "Node.js license"
    assert (target / "dependencies" / "manifest.json").is_file()
    assert (target / "README.md").is_file()


def test_copy_refuses_a_modified_text(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    (root / "desktop").mkdir(parents=True)
    (root / "docs" / "release").mkdir(parents=True)
    shutil.copytree(LICENSES, root / "desktop" / "licenses")
    shutil.copytree(
        ROOT / "docs" / "release" / "THIRD_PARTY_LICENSES",
        root / "docs" / "release" / "THIRD_PARTY_LICENSES",
    )
    text = root / "desktop" / "licenses" / "postgresql" / "zlib-1.3.2-LICENSE.txt"
    text.write_text(text.read_text() + "tampered\n")
    runtime = tmp_path / "runtime"
    (runtime / "node").mkdir(parents=True)
    (runtime / "node" / "LICENSE").write_text("x")
    result = subprocess.run(
        [sys.executable, "-I", "-B", str(SCRIPT), str(root), "macos", str(runtime)],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "checksum mismatch" in result.stderr
