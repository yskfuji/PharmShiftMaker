"""Defects surfaced while adding type annotations (SQLite, no Docker)."""

import pytest

from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import ManagedCopy
from shift_scheduler.ops import managed_writer as writer
from tests.test_managed_writer import reservation


def test_present_file_row_without_path_is_reported_not_a_crash(
    sqlite_session_factory, tmp_path, monkeypatch
):
    root = tmp_path / "managed"
    root.mkdir()
    item = reservation(sqlite_session_factory, root, monkeypatch)
    with sqlite_session_factory.begin() as s:
        row = s.get(ManagedCopy, item.copy_id)
        row.state = "PRESENT"
        row.locator = {k: v for k, v in row.locator.items() if k != "relative_path"}
    with sqlite_session_factory() as s:
        report = writer.reconcile_files(s)  # previously TypeError from Path(None)
    assert not report["complete"]
    assert {"copy_id": item.copy_id, "reason": "missing_or_changed"} in report["issues"]


def test_registration_that_disappears_between_transactions_is_a_conflict(
    sqlite_session_factory,
):
    with sqlite_session_factory() as s, pytest.raises(Conflict, match="disappeared"):
        writer.registered_copy(s, "0" * 32)
