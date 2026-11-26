"""The Windows lock of the desktop bundle must not drift from requirements.lock."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = re.compile(
    r"^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?==(\S+)((?:\s*\\\n\s*--hash=sha256:[0-9a-f]{64})+)",
    re.M,
)

# Packages whose presence legitimately differs between Windows and POSIX.
WINDOWS_ONLY = {"colorama"}
POSIX_ONLY = {"uvloop"}


def _name(raw: str) -> str:
    return re.sub(r"[-_.]+", "-", raw).lower()


def _lock(path: Path) -> dict[str, tuple[str, set[str]]]:
    text = path.read_text(encoding="utf-8")
    entries = {
        _name(name): (version, set(re.findall(r"[0-9a-f]{64}", hashes)))
        for name, version, hashes in ENTRY.findall(text)
    }
    # Every requirement line is hashed (pip --require-hashes needs all of them).
    requirements = re.findall(r"^[A-Za-z0-9_.-]+(?:\[[^\]]*\])?==", text, re.M)
    assert len(requirements) == len(entries), path
    return entries


def test_windows_lock_matches_the_verified_versions_and_hashes() -> None:
    posix = _lock(ROOT / "requirements.lock")
    windows = _lock(ROOT / "desktop" / "requirements-windows.lock")
    assert set(windows) - set(posix) == WINDOWS_ONLY
    assert set(posix) - set(windows) == POSIX_ONLY
    for name in set(posix) & set(windows):
        version, hashes = windows[name]
        assert version == posix[name][0], name
        # requirements.lock lists every published file of the version, so each
        # Windows hash must be one of them.
        assert hashes and hashes <= posix[name][1], name
    for name in WINDOWS_ONLY:
        assert windows[name][1], name
