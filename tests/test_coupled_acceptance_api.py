"""Public HTTP + PostgreSQL projection, distinct from full coupled acceptance."""

from scripts.coupled_acceptance_api import PublicApiProjection
from scripts.coupled_acceptance_model import State, transition


def test_two_scopes_two_months_publication_leave_and_hold_real_api(pg):
    adapter = PublicApiProjection(pg)
    try:
        fixture = adapter.reset("real-api-projection")
        assert fixture["backend"] == "postgresql"
        state = State()
        operations = [
            {
                "op": "publish",
                "person": 0,
                "month": 0,
                "version": 1,
                "variant": "wrong_department",
            },
            {
                "op": "publish",
                "person": 0,
                "month": 0,
                "version": 1,
                "variant": "stale_approval",
            },
            {
                "op": "publish",
                "person": 0,
                "month": 0,
                "version": 2,
                "variant": "normal",
            },
            {
                "op": "publish",
                "person": 0,
                "month": 0,
                "version": 1,
                "variant": "normal",
            },
            {
                "op": "publish",
                "person": 0,
                "month": 1,
                "version": 1,
                "variant": "normal",
            },
            {
                "op": "publish",
                "person": 1,
                "month": 0,
                "version": 1,
                "variant": "normal",
            },
            {
                "op": "publish",
                "person": 1,
                "month": 1,
                "version": 1,
                "variant": "normal",
            },
            {"op": "consume", "person": 0, "month": 0},
            {"op": "duplicate_consume", "person": 0, "month": 0},
            {"op": "consume", "person": 0, "month": 0},
            {"op": "hold", "person": 0, "active": False},
            {"op": "hold", "person": 0, "active": True},
            {"op": "hold", "person": 0, "active": True},
            {"op": "hold", "person": 0, "active": False},
        ]
        for action in operations:
            state, expected = transition(state, action)
            observed = adapter.apply(action)
            assert observed["accepted"] == expected["accepted"], (action, observed)
            for field in ("publication_versions", "lots"):
                assert (
                    observed["observation"][field] == expected["observation"][field]
                ), (action, observed)
        assert adapter.observe()["holds"] == [2, 0]
        assert observed["projection_complete"] is False
    finally:
        adapter.close()
