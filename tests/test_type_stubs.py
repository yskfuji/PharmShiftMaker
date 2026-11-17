"""Stubs for modules whose bytes are hashed into restore policy_hash / code_hash.

Those implementations stay byte-identical so deployed trust roots remain valid;
their annotations live in .pyi files next to them. stubtest fails when a stub
drifts from its implementation (mypy alone would not notice).
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
STUBBED = [
    "shift_scheduler.application.storage_reconciliation",
    "shift_scheduler.application.copy_coverage",
    "shift_scheduler.application.copy_graph",
    "shift_scheduler.application.subject_references",
    "shift_scheduler.application.storage_routes",
    "shift_scheduler.control.restore_verification",
]


def test_every_stubbed_module_has_a_stub_next_to_it():
    for module in STUBBED:
        assert (ROOT / "src" / (module.replace(".", "/") + ".pyi")).is_file(), module


def test_stubs_match_their_implementations():
    pytest.importorskip("mypy.stubtest")
    env = {**os.environ, "MYPYPATH": str(ROOT / "src")}
    env.pop("PHARMSHIFT_TEST_PG_URL", None)
    result = subprocess.run(
        [sys.executable, "-m", "mypy.stubtest", *STUBBED],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]
