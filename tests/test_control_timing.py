"""Control timing must observe both failure and success without relaxing checks."""

import pytest

from shift_scheduler.control.witness import WitnessedFactory
from shift_scheduler.db.restore_lock import RestoreUnavailable


def test_stage_timings_preserve_outage_rejection_and_do_not_log_personal_data(
    witnessed, monkeypatch
):
    _, factory, checkpoint, _ = witnessed
    records = []
    wrapper = WitnessedFactory(factory, checkpoint, observer=records.append)
    with wrapper.begin():
        pass
    assert records[0]["outcome"] == "SUCCEEDED"
    assert records[0]["stages"].keys() == {
        "head_query_and_lock_seconds",
        "before_digest_seconds",
        "witness_network_seconds",
        "caller_work_seconds",
        "after_digest_seconds",
        "transaction_exit_seconds",
    }
    assert all(t >= 0 for t in records[0]["stages"].values())
    assert records[0]["total_seconds"] >= sum(records[0]["stages"].values())

    def fail(*args, **kwargs):
        raise RestoreUnavailable("injected transport failure")

    monkeypatch.setattr(checkpoint, "request", fail)
    with pytest.raises(RestoreUnavailable), wrapper.begin():
        pytest.fail("Access yielded while witness unavailable")
    assert records[-1]["outcome"] == "FAILED"
    assert "witness_network_seconds" in records[-1]["stages"]
    assert "caller_work_seconds" not in records[-1]["stages"]
    assert set(records[-1]) == {"event", "outcome", "total_seconds", "stages"}


def test_broken_observer_does_not_authorize_failure(witnessed, monkeypatch):
    _, factory, checkpoint, _ = witnessed

    def fail(*args, **kwargs):
        raise RestoreUnavailable("outage")

    def broken(record):
        raise RuntimeError("telemetry broken")

    monkeypatch.setattr(checkpoint, "request", fail)
    with pytest.raises(RestoreUnavailable):
        with WitnessedFactory(factory, checkpoint, observer=broken).begin():
            pytest.fail("authorization bypassed")
