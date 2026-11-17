"""Version provenance for API replay; a fake backend is never acceptance proof."""

import pytest
from scripts import coupled_acceptance_bfs as runner


class Unsupported:
    def reset(self, _):
        return {"backend": "sqlite"}

    def close(self):
        pass


def test_changed_code_cannot_resume_previous_replay(tmp_path, monkeypatch):
    revision = ["original"]
    monkeypatch.setattr(
        runner,
        "replay_fingerprint",
        lambda _: runner.model.canonical({"code": revision[0]}),
    )
    with runner.ledger(tmp_path / "ledger.sqlite") as db:
        runner.explore(db, max_states=1)
        first = runner.replay_edges(db, Unsupported(), max_edges=1)
        assert first["replay_binding_valid"] and first["edges_with_api_pass"] == 0
        attempts = db.execute("SELECT COUNT(*) FROM replay").fetchone()[0]
        revision[0] = "changed"
        with pytest.raises(ValueError, match="changed"):
            runner.replay_edges(db, Unsupported(), max_edges=1, retry_failed=True)
        assert db.execute("SELECT COUNT(*) FROM replay").fetchone()[0] == attempts


def test_old_unbound_attempts_are_not_silently_adopted(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "replay_fingerprint", lambda _: "{}")
    with runner.ledger(tmp_path / "ledger.sqlite") as db:
        runner.explore(db, max_states=1)
        origin, action = db.execute(
            "SELECT origin,action_id FROM edges LIMIT 1"
        ).fetchone()
        with db:
            db.execute(
                "INSERT INTO replay(origin,action_id,started_at,status,evidence) VALUES(?,?,?,?,?)",
                (origin, action, "prior", "PASSED", "{}"),
            )
        assert runner.report(db)["recorded_edges_with_pass"] == 1
        assert runner.report(db)["edges_with_api_pass"] == 0
        with pytest.raises(ValueError, match="unbound"):
            runner.replay_edges(db, Unsupported(), max_edges=1)


def test_mid_run_drift_is_retained_but_not_accepted(tmp_path, monkeypatch):
    revisions = iter(['{"version":1}', '{"version":2}'])
    monkeypatch.setattr(runner, "replay_fingerprint", lambda _: next(revisions))
    with runner.ledger(tmp_path / "ledger.sqlite") as db:
        runner.explore(db, max_states=1)
        with pytest.raises(ValueError, match="during execution"):
            runner.replay_edges(db, Unsupported(), max_edges=1)
        result = runner.report(db)
        assert not result["replay_binding_valid"]
        assert result["replay_attempt_statuses"] == {"BLOCKED": 1}
        assert result["edges_with_api_pass"] == 0
