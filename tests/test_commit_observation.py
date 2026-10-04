"""A commit observation cannot precede business commit or survive its rollback."""

import pytest

from shift_scheduler.application import planning
from shift_scheduler.application.worker import finish_and_measure
from shift_scheduler.db.planning_models import PlanningJob
from shift_scheduler.domain.planning import SolveResult
from tests.test_reviewed_planning import db as _db
from tests.test_reviewed_planning import snapshot

db = _db


def claimed(db):
    data = snapshot(1, 1)
    with db.begin() as session:
        planning.register_input(session, data, "admin", 0)
        planning.enqueue(
            session,
            data.input_hash,
            "hospital/pharmacy",
            "admin",
            "measurement-key",
            20,
        )
    with db.begin() as session:
        job_id, token, _, _ = planning.claim_job(session)
    result = SolveResult(
        status="UNKNOWN",
        input_hash=data.input_hash,
        rule_revision=data.rule_revision,
        solver_version="independent fixture",
    )
    return job_id, token, result


def test_observation_is_after_commit_and_stale_worker_cannot_replace_it(db):
    identity, token, result = claimed(db)
    assert finish_and_measure(db, identity, token, result)
    with db() as session:
        row = session.get(PlanningJob, identity)
        observed = row.persisted_observed_at
        assert observed >= row.completed_at
        assert row.stage_seconds["finalization_to_commit_ack"] >= 0
    assert not finish_and_measure(db, identity, token, result)
    with db() as session:
        assert session.get(PlanningJob, identity).persisted_observed_at == observed


def test_crash_after_result_commit_leaves_missing_observation_explicit(db):
    identity, token, result = claimed(db)

    class InterruptAfterCommit:
        calls = 0

        def begin(self):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("simulated failure before telemetry commit")
            return db.begin()

    with pytest.raises(RuntimeError, match="telemetry"):
        finish_and_measure(InterruptAfterCommit(), identity, token, result)
    with db() as session:
        row = session.get(PlanningJob, identity)
        assert row.status == "UNKNOWN"
        assert row.completed_at is not None
        assert row.persisted_observed_at is None
