"""Independent counterexamples for orchestration, not full application acceptance."""

import json
import sqlite3
import subprocess
import sys
import time

import pytest
from scripts import acceptance as a


def case(identity="check", command=None, requires=(), kind="acceptance"):
    return {
        "id": identity,
        "kind": kind,
        "requirements": ["EXEC"],
        "criterion": "test contract",
        "command": command or ["{python}", "-c", 'print("verified")'],
        "requires": list(requires),
    }


def spec(*cases):
    return {"version": 1, "cases": list(cases)}


def start(tmp_path, data):
    path = tmp_path / "run"
    a.create_run(
        path, data, [c["id"] for c in data["cases"]], fingerprint={"source": "fixed"}
    )
    return path


def test_dependency_cycle_identifier_and_missing_contract_rejected(tmp_path):
    for data in (
        spec(case("a", requires=["b"]), case("b", requires=["a"])),
        spec(case("../escape")),
        spec(case("a", requires=["missing"])),
    ):
        path = tmp_path / "spec.json"
        path.write_text(json.dumps(data))
        with pytest.raises(ValueError):
            a.read_spec(path)


def test_success_diagnostic_never_closes_missing_acceptance(tmp_path):
    missing = case("missing")
    missing["command"] = None
    path = start(tmp_path, spec(case(kind="diagnostic"), missing))
    result = a.execute(path, fingerprint={"source": "fixed"})
    assert result["counts"] == {"PASSED": 1, "NOT_IMPLEMENTED": 1}
    assert not result["acceptance_complete"]
    with pytest.raises(FileExistsError):
        a.create_run(path, spec(case()), ["check"])
    with pytest.raises(ValueError, match="Code/config"):
        a.execute(path, fingerprint={"source": "changed"})


def test_resume_keeps_first_failure_and_interruption(tmp_path):
    marker = tmp_path / "attempt"
    program = f'from pathlib import Path; import sys; p=Path({str(marker)!r}); seen=p.exists(); p.write_text("done"); sys.exit(0 if seen else 1)'
    path = start(tmp_path, spec(case(command=["{python}", "-c", program])))
    assert a.execute(path, fingerprint={"source": "fixed"})["counts"] == {"FAILED": 1}
    with sqlite3.connect(path / "ledger.sqlite") as db:
        a.append(db, "check", "crashed", "START", {"command": []})
    assert a.report(path)["counts"] == {"INTERRUPTED": 1}
    result = a.execute(path, fingerprint={"source": "fixed"})
    attempts = result["cases"][0]["attempts"]
    assert (
        len(attempts) == 3
        and attempts[0]["result"]["exit_code"] == 1
        and attempts[1]["result"] is None
    )
    assert result["acceptance_complete"]
    # Successful resume does not launch a fourth attempt.
    assert (
        len(a.execute(path, fingerprint={"source": "fixed"})["cases"][0]["attempts"])
        == 3
    )


def test_log_tamper_invalidates_transitive_dependencies(tmp_path):
    path = start(
        tmp_path, spec(case("a"), case("b", requires=["a"]), case("c", requires=["b"]))
    )
    result = a.execute(path, fingerprint={"source": "fixed"})
    assert result["acceptance_complete"]
    first = result["cases"][0]["attempts"][0]["result"]["log"]
    (path / first).write_text("replaced")
    assert [row["state"] for row in a.report(path)["cases"]] == [
        "FAILED",
        "BLOCKED",
        "BLOCKED",
    ]


def test_runtime_target_switch_and_unknown_events_fail_closed(tmp_path, monkeypatch):
    path = start(tmp_path, spec(case()))
    monkeypatch.setenv(
        "PHARMSHIFT_TEST_PG_URL", "postgresql://test@localhost/pharmshift_audit_other"
    )
    with pytest.raises(ValueError, match="target"):
        a.execute(path, fingerprint={"source": "fixed"})
    with sqlite3.connect(path / "ledger.sqlite") as db:
        a.append(db, "unplanned", "x", "START", {})
    with pytest.raises(ValueError, match="Unplanned"):
        a.report(path)


def test_fault_opt_in_is_explicit_and_cannot_change_during_resume(
    tmp_path, monkeypatch
):
    for capability, variable in a.FAULT_OPT_INS.items():
        monkeypatch.delenv(variable, raising=False)
        requirement = case()
        requirement["environment"] = [capability]
        assert a.availability(requirement) == [
            "EXPLICIT_FAULT_OPT_IN_REQUIRED:" + capability
        ]
        monkeypatch.setenv(variable, "1")
        assert not a.availability(requirement)
    path = start(tmp_path, spec(case()))
    monkeypatch.setenv("PHARMSHIFT_TEST_NETWORK_FAULTS", "0")
    with pytest.raises(ValueError, match="target"):
        a.execute(path, fingerprint={"source": "fixed"})


def test_running_child_keeps_ownership_after_parent_dies(tmp_path):
    ready, release = tmp_path / "ready", tmp_path / "release"
    child = f"from pathlib import Path; import time; Path({str(ready)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.02)"
    path = start(tmp_path, spec(case(command=["{python}", "-c", child])))
    parent = subprocess.Popen(
        [
            sys.executable,
            "-c",
            f'from pathlib import Path; from scripts.acceptance import execute; execute(Path({str(path)!r}), fingerprint={{"source":"fixed"}})',
        ]
    )
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.exists()
        assert a.report(path)["counts"] == {"RUNNING": 1}
        assert a.report(path)["owner_active_at_observation"] is True
        parent.kill()
        parent.wait(timeout=5)
        # The inherited kernel lock, not the dead supervisor's PID, decides
        # whether a still executing command may be restarted.
        assert a.report(path)["counts"] == {"RUNNING": 1}
        with pytest.raises(ValueError, match="owns"):
            a.execute(path, fingerprint={"source": "fixed"})
    finally:
        release.touch()
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=5)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            with a.run_lock(path):
                break
        except ValueError:
            time.sleep(0.02)
    else:
        pytest.fail("child did not release ownership")
    assert a.report(path)["counts"] == {"INTERRUPTED": 1}
    assert a.report(path)["owner_active_at_observation"] is False


def test_active_later_attempt_does_not_relabel_abandoned_prior_case(tmp_path):
    path = start(tmp_path, spec(case("a"), case("b")))
    with sqlite3.connect(path / "ledger.sqlite") as db:
        a.append(db, "a", "old", "START", {"command": []})
        a.append(db, "b", "new", "START", {"command": []})
    with a.run_lock(path):
        result = a.report(path)
        assert [row["state"] for row in result["cases"]] == ["INTERRUPTED", "RUNNING"]
        assert not result["selected_complete"] and not result["acceptance_complete"]
    assert a.report(path)["counts"] == {"INTERRUPTED": 2}


def test_skipped_test_cannot_pass_acceptance_entry(tmp_path):
    target = tmp_path / "test_skip.py"
    target.write_text(
        'import pytest\n@pytest.mark.skip(reason="no environment")\ndef test_required(): pass\n'
    )
    command = subprocess.run(
        [sys.executable, "-m", "scripts.acceptance_pytest", str(target)],
        capture_output=True,
        text=True,
    )
    assert command.returncode != 0
    assert "skipped=1" in command.stdout


def test_hidden_or_explicit_deselection_cannot_hide_failure(tmp_path):
    import os

    target = tmp_path / "test_scope.py"
    target.write_text("def test_good(): pass\ndef test_required_bad(): assert False\n")
    for extra, environment in [
        ([], dict(os.environ, PYTEST_ADDOPTS="-k good")),
        (
            ["-k", "good"],
            {k: v for k, v in os.environ.items() if k != "PYTEST_ADDOPTS"},
        ),
    ]:
        result = subprocess.run(
            [sys.executable, "-m", "scripts.acceptance_pytest", str(target), *extra],
            env=environment,
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0


def test_edit_during_successful_command_is_not_accepted(tmp_path, monkeypatch):
    marker = tmp_path / "source"
    marker.write_text("original")
    monkeypatch.setattr(a, "source_fingerprint", lambda: {"source": marker.read_text()})
    change = f'from pathlib import Path; Path({str(marker)!r}).write_text("changed")'
    data = spec(
        case("a", command=["{python}", "-c", change]), case("b", requires=["a"])
    )
    path = tmp_path / "run"
    a.create_run(path, data, ["a", "b"])
    result = a.execute(path)
    assert [r["state"] for r in result["cases"]] == ["FAILED", "NOT_RUN"]
    assert result["cases"][0]["attempts"][0]["result"]["exit_code"] == 0
    assert not result["cases"][0]["attempts"][0]["result"]["execution_context_intact"]
