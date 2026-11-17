from scripts.coupled_acceptance_bfs import explore, ledger, replay_edges
from scripts.coupled_acceptance_model import State, actions, observation, transition


def act(state, op, **values):
    return transition(state, {"op": op, **values})


def test_hold_and_erasure_both_orders_preserve_other_subject_and_stop_recreation():
    results = []
    for order in ((0, 1), (1, 0)):
        s = State()
        s, _ = act(s, "hold", person=order[0], active=True)
        unchanged, result = act(s, "erase", person=order[0])
        assert unchanged == s and not result["accepted"]
        s, _ = act(s, "hold", person=order[0], active=False)
        s, result = act(s, "erase", person=order[0])
        assert all(
            c["subjects"] == (1 << (1 - order[0]))
            for c in result["observation"]["operational_copies"]
            if c["owner"] == "shared"
        )
        s, _ = act(s, "erase", person=order[1])
        results.append(observation(s)["operational_copies"])
        _, denied = act(
            s, "publish", person=order[0], month=0, version=1, variant="normal"
        )
        assert denied["reason"] == "erased_subject_recreation"
    assert results[0] == results[1]


def test_two_months_share_lot_and_settlement_cannot_double_consume():
    s = State()
    for m in (0, 1):
        s, _ = act(s, "publish", person=0, month=m, version=1, variant="normal")
    assert observation(s)["lots"][0] == {
        "lot": "lot-p0",
        "available": 0,
        "reserved": 2,
        "consumed": 0,
    }
    s, _ = act(s, "consume", person=0, month=0)
    again, result = act(s, "duplicate_consume", person=0, month=0)
    assert again == s and result["accepted"]
    _, result = act(s, "publish", person=0, month=0, version=2, variant="normal")
    assert not result["accepted"]


def test_restore_blocks_access_and_rejects_old_generation():
    s, _ = act(State(), "erase", person=0)
    s, _ = act(s, "restore_begin", version=1)
    assert not observation(s)["access_open"]
    _, bad = act(s, "restore_apply", variant="stale")
    assert not bad["accepted"]
    s, _ = act(s, "restore_apply", variant="latest")
    _, bad = act(s, "restore_open", variant="stale")
    assert not bad["accepted"]
    s, _ = act(s, "restore_open", variant="latest")
    assert observation(s)["access_open"] and s.erased == 1


def test_exploration_resumes_and_never_calls_partial_enumeration_complete(tmp_path):
    path = tmp_path / "bfs.sqlite"
    with ledger(path) as db:
        first = explore(db, max_states=2)
        assert first["states_expanded"] == 2 and not first["model_enumeration_complete"]
        assert first["edges_enumerated"] == 2 * len(actions())
        assert not first["coupled_model_api_complete"]
    with ledger(path, resume=True) as db:
        second = explore(db, max_states=3)
        assert second["states_expanded"] == 5
        assert second["edges_enumerated"] == 5 * len(actions())
        assert second["edges_without_api_pass"] == second["edges_enumerated"]


def test_model_or_unsupported_backend_is_not_pg_api_proof(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "scripts.coupled_acceptance_bfs.replay_fingerprint", lambda _: "{}"
    )

    class NotPG:
        def reset(self, *_):
            return {"backend": "sqlite"}

        def close(self):
            pass

        def apply(self, *_):
            raise AssertionError("Must not be called")

    with ledger(tmp_path / "bfs.sqlite") as db:
        explore(db, max_states=1)
        result = replay_edges(db, NotPG(), max_edges=1)
        assert result["replay_attempt_statuses"] == {"BLOCKED": 1}
        assert not result["coupled_model_api_complete"]
