"""API rejection and missing validation must not enter successful timing groups."""

import pytest
from scripts.benchmark_runner import measure_case, run
from scripts.completion_benchmark import workload as v2_workload
from scripts.remediation_benchmark import workload as v3_workload

from tests.test_reviewed_planning import snapshot


def test_v3_factory_does_not_replace_v2_factory():
    original = v2_workload
    v3 = v3_workload(3, 7, 1000)
    assert v3.schema_version == 3
    assert v2_workload is original
    assert v2_workload(3, 7, 1000).schema_version == 2


def test_public_input_rejection_has_no_success_elapsed_time():
    def reject(path, *args):
        if "/by-key?" in path:
            return {"job": None}
        raise RuntimeError("422: V3 input union omitted")

    row, revision = measure_case(
        reject, snapshot(), revision=4, budget=20, request_key="fixture"
    )
    assert row["phase"] == "input_registration" and row["success"] is False
    assert row["observed_end_to_end_seconds"] is None
    assert "422" in row["error"] and revision == 4


@pytest.mark.parametrize(
    "state,validation,success",
    [
        ("FEASIBLE", None, False),
        ("OPTIMAL", {}, False),
        ("UNKNOWN", "valid", False),
        ("FEASIBLE", "valid", True),
        ("OPTIMAL", "valid", True),
        ("FEASIBLE", "wrong-hash", False),
    ],
)
def test_terminal_status_requires_independent_validation(state, validation, success):
    data = snapshot()
    if isinstance(validation, str):
        validation = {
            "input_hash": data.input_hash if validation == "valid" else "wrong",
            "checked_rules": ["coverage", "contract"],
            "findings": [],
        }
    replies = iter(
        [
            {"job": None},
            {"input_revision": 2},
            {"job_id": "job"},
            {
                "status": state,
                "result": {"draft_id": "draft", "validation": validation},
            },
        ]
    )
    row, _ = measure_case(
        lambda *args: next(replies), data, revision=1, budget=20, request_key="key"
    )
    assert row["success"] is success


def test_existing_evidence_is_never_overwritten(tmp_path):
    path = tmp_path / "evidence.jsonl"
    path.write_text("original\n")
    with pytest.raises(FileExistsError):
        run(lambda *_: None, ["--split", "tuning", "--output", str(path)])
    assert path.read_text() == "original\n"


def test_acceptance_waits_for_separate_commit_acknowledgement(monkeypatch):
    data = snapshot()
    validation = {
        "input_hash": data.input_hash,
        "checked_rules": ["independent"],
        "findings": [],
    }
    terminal = {
        "status": "FEASIBLE",
        "result": {"draft_id": "d", "validation": validation},
    }
    replies = iter(
        [
            {"job": None},
            {"input_revision": 1},
            {"job_id": "j"},
            terminal,
            {**terminal, "persisted_observed_at": "2026-09-23T00:00:01Z"},
        ]
    )
    monkeypatch.setattr("scripts.benchmark_runner.time.sleep", lambda _: None)
    row, _ = measure_case(
        lambda *args: next(replies),
        data,
        revision=0,
        budget=20,
        request_key="key",
        require_commit_telemetry=True,
    )
    assert row["success"] and row["commit_telemetry_complete"]


def test_missing_commit_telemetry_is_not_performance_acceptance(monkeypatch):
    data = snapshot()
    validation = {
        "input_hash": data.input_hash,
        "checked_rules": ["independent"],
        "findings": [],
    }
    replies = iter(
        [
            {"job": None},
            {"input_revision": 1},
            {"job_id": "j"},
            {
                "status": "FEASIBLE",
                "result": {"draft_id": "d", "validation": validation},
            },
        ]
    )
    ticks = iter([0, 0, 0, 0, 0, 100])
    monkeypatch.setattr(
        "scripts.benchmark_runner.time.perf_counter", lambda: next(ticks)
    )
    row, _ = measure_case(
        lambda *args: next(replies),
        data,
        revision=0,
        budget=20,
        request_key="key",
        require_commit_telemetry=True,
    )
    assert not row["success"] and row["error_type"] == "TimeoutError"
    assert row["phase"] == "commit_telemetry"


def test_response_loss_resume_queries_existing_job_before_old_input(tmp_path):
    from scripts.benchmark_journal import Journal

    data = snapshot()
    job = {
        "job_id": "j",
        "input_hash": data.input_hash,
        "budget_seconds": 20,
        "status": "FEASIBLE",
        "persisted_observed_at": "2026-09-23T00:00:00Z",
        "result": {
            "draft_id": "d",
            "validation": {
                "input_hash": data.input_hash,
                "checked_rules": ["independent"],
                "findings": [],
            },
        },
    }
    saved = False

    def first(path, body=None):
        nonlocal saved
        if "by-key" in path:
            return {"job": None}
        if path == "/planning/inputs":
            return {"input_revision": 1}
        saved = True
        raise ConnectionError("Response lost after commit")

    j = Journal(tmp_path / "j.sqlite", {})
    attempt = j.start("c", {"case": 1})
    row, _ = measure_case(
        first,
        data,
        revision=0,
        budget=20,
        request_key="stable",
        journal=j,
        case_key="c",
        require_commit_telemetry=True,
    )
    j.finish(attempt, "c", row)
    assert saved and not row["success"]
    j.close()
    j = Journal(tmp_path / "j.sqlite", {}, resume=True)
    calls = []

    def resume(path, body=None):
        calls.append(path)
        if body is not None:
            raise AssertionError("No old input registration or duplicate job allowed")
        return {"job": job} if "by-key" in path else job

    next_attempt = j.start("c", {"case": 1})
    recovered, revision = measure_case(
        resume,
        data,
        revision=5,
        budget=20,
        request_key="stable",
        journal=j,
        case_key="c",
        require_commit_telemetry=True,
    )
    j.finish(next_attempt, "c", recovered)
    assert recovered["functional_success"] and not recovered["success"]
    assert recovered["observed_end_to_end_seconds"] is None
    assert recovered["timing_complete"] is False and revision == 5
    assert j.case_state("c")["phase"] == "OBSERVED"
    assert len(calls) == 2 and "by-key" in calls[0]
    assert len(j.db.execute("SELECT * FROM events").fetchall()) == 4
    j.close()


@pytest.mark.parametrize(
    "field,value", [("input_hash", "wrong"), ("budget_seconds", 25)]
)
def test_recovery_rejects_different_operation_identity(field, value):
    data = snapshot()
    job = {
        "job_id": "j",
        "input_hash": data.input_hash,
        "budget_seconds": 20,
        field: value,
    }
    row, _ = measure_case(
        lambda *_: {"job": job}, data, revision=3, budget=20, request_key="key"
    )
    assert not row["success"] and row["phase"] == "job_lookup"


@pytest.mark.parametrize(
    "module_name,expected",
    [
        (
            "scripts.completion_benchmark",
            {"generator": "completion_benchmark", "schema_version": 2},
        ),
        (
            "scripts.remediation_benchmark",
            {
                "generator": "remediation_benchmark",
                "schema_version": 3,
                "lookahead": 14,
            },
        ),
    ],
)
def test_legacy_entrypoints_declare_workload_for_durable_journal(
    monkeypatch, module_name, expected
):
    import importlib

    module = importlib.import_module(module_name)
    captured = {}

    def fake_run(factory, argv, **kwargs):
        captured.update(kwargs)
        return 0

    monkeypatch.setattr("scripts.benchmark_runner.run", fake_run)
    if hasattr(module, "run"):
        monkeypatch.setattr(module, "run", fake_run)
    assert module.main(["--split", "tuning", "--output", "unused"]) == 0
    assert captured["workload_configuration"] == expected
