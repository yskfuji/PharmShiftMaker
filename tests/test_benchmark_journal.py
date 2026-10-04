import json

import pytest
from scripts.benchmark_journal import Journal


def test_interruption_and_retry_preserve_first_attempt(tmp_path):
    p = tmp_path / "run.sqlite"
    j = Journal(p, {"lookahead": 14})
    with pytest.raises(ValueError, match="owns"):
        Journal(p, {"lookahead": 14}, resume=True)
    first = j.start("case1", {"seed": 1})
    j.close()  # Simulate loss of the client after submission.
    j = Journal(p, {"lookahead": 14}, resume=True)
    assert not j.succeeded("case1")
    second = j.start("case1", {"seed": 1})
    j.finish(second, "case1", {"success": False, "status": "UNKNOWN"})
    third = j.start("case1", {"seed": 1})
    j.finish(third, "case1", {"success": True, "status": "FEASIBLE"})
    assert j.succeeded("case1")
    assert not j.first_attempt_succeeded("case1")
    rows = j.db.execute(
        "SELECT attempt,kind,payload FROM events ORDER BY sequence"
    ).fetchall()
    assert [r[:2] for r in rows] == [
        (first, "START"),
        (second, "START"),
        (second, "RESULT"),
        (third, "START"),
        (third, "RESULT"),
    ]
    assert json.loads(rows[2][2])["status"] == "UNKNOWN"
    with pytest.raises(ValueError):
        j.finish(second, "case1", {"success": True})
    j.close()
    with pytest.raises(ValueError):
        Journal(p, {"lookahead": 28}, resume=True)
    with pytest.raises(ValueError):
        Journal(p, {"lookahead": 14})


def test_checkpoints_reject_skips_regressions_missing_proof_and_changed_identity(
    tmp_path,
):
    j = Journal(tmp_path / "stages.sqlite", {})
    generated = {
        "input_hash": "h",
        "snapshot": {},
        "request_key": "key",
        "budget_seconds": 20,
    }
    j.checkpoint("c", "GENERATED", generated)
    with pytest.raises(ValueError, match="skip"):
        j.checkpoint("c", "OBSERVED", {})
    with pytest.raises(ValueError, match="Missing"):
        j.checkpoint("c", "REGISTERED", {})
    j.checkpoint("c", "REGISTERED", {"registered_input_hash": "h"})
    with pytest.raises(ValueError, match="Immutable"):
        j.checkpoint("c", "ACCEPTED", {"job_id": "j", "budget_seconds": 25})
    j.checkpoint("c", "ACCEPTED", {"job_id": "j"})
    with pytest.raises(ValueError, match="terminal"):
        j.checkpoint(
            "c",
            "COMMITTED",
            {
                "persisted_observed_at": "2026-01-01T00:00:00Z",
                "terminal_status": "RUNNING",
            },
        )
    j.checkpoint(
        "c",
        "COMMITTED",
        {
            "persisted_observed_at": "2026-01-01T00:00:00Z",
            "terminal_status": "FEASIBLE",
        },
    )
    j.checkpoint(
        "c", "OBSERVED", {"observation_hash": "f" * 64, "timing_complete": False}
    )
    with pytest.raises(ValueError, match="reverse"):
        j.checkpoint("c", "REGISTERED", {"registered_input_hash": "h"})
    assert j.case_state("c")["job_id"] == "j"
    j.close()
