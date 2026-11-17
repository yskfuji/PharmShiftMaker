"""Bounded real API adapter test, explicitly not the 25-month acceptance."""

from types import SimpleNamespace

from scripts.long_integrated_workflows import LongWorkflowDiagnostics
from scripts.long_subject_events import apply_subject_event

from shift_scheduler.application import subject_controls
from shift_scheduler.control import transaction


def test_existing_canonical_subject_not_replaced_by_a_new_fixture(
    pg, monkeypatch, tmp_path
):
    fake = SimpleNamespace(
        client_id="synthetic",
        require_access=lambda: {"generation": 1},
        request=lambda *args: {},
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(subject_controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)
    adapter = LongWorkflowDiagnostics(pg, person_prefix="long-")
    try:
        adapter.setup()
        event = {
            "event_id": "erase-p0",
            "kind": "erasure",
            "person_id": "p0",
            "revision": 1,
            "recorded_at": "2028-02-15T13:00:00+09:00",
            "effective_at": "2028-02-15T13:00:00+09:00",
            "payload": {},
        }
        result = apply_subject_event(adapter, event, tmp_path)
        assert result["person_id"] == "long-p0"
        assert result["completed_api_sequence"] is True
        assert result["actual_database_erased_count"] == 0
        assert result["actual_file_erased_count"] == 0
        assert result["full_erasure_passed"] is False
        assert result["remaining"]["targets"]
        assert result["synthetic_recorded_at"] != result["wall_started_at"]
    finally:
        adapter.stack.close()
        adapter.api.close()
