"""Real public API path with independent PostgreSQL-backed control services."""

import json
import os
import time
from unittest.mock import patch

import pytest
from scripts.coupled_acceptance_api import PublicApiProjection
from scripts.owned_control_services import owned_control_services


@pytest.mark.skipif(
    os.getenv("PHARMSHIFT_TEST_NETWORK_FAULTS") != "1",
    reason="owned network services opt in",
)
def test_coupled_subject_barrier_hold_retry_and_reintroduction(pg, tmp_path):
    started = time.monotonic()
    with owned_control_services(tmp_path / "services") as services:
        with patch.dict(os.environ, services["environment"]):
            adapter = PublicApiProjection(pg)
            try:
                adapter.reset("subject-control-public-path")
                assert adapter.apply({"op": "hold", "person": 0, "active": True})[
                    "accepted"
                ]
                held = adapter.apply({"op": "erase", "person": 0})
                assert held["http_status"] == 409
                assert held["observation"]["subject_controls"] == []
                held_generation = services["clients"]["source"].require_access()[
                    "generation"
                ]
                assert adapter.apply({"op": "erase", "person": 0})["http_status"] == 409
                assert (
                    services["clients"]["source"].require_access()["generation"]
                    == held_generation
                )
                assert adapter.apply({"op": "hold", "person": 0, "active": False})[
                    "accepted"
                ]
                first = adapter.apply({"op": "erase", "person": 0})
                assert first["accepted"], first
                assert first["body"]["all_copies_erased"] is False
                assert first["projection_complete"] is False
                assert first["observation"]["subject_controls"] == [0]
                committed_generation = services["clients"]["source"].require_access()[
                    "generation"
                ]
                repeated = adapter.apply({"op": "erase", "person": 0})
                assert repeated["body"] == first["body"]
                assert (
                    services["clients"]["source"].require_access()["generation"]
                    == committed_generation
                )
                recreated, _ = adapter._register(0, 1)
                assert recreated.status_code == 409, recreated.text
                # Another person/scope remains writable.
                unaffected, _ = adapter._register(1, 1)
                assert unaffected.status_code == 200, unaffected.text
                (tmp_path / "projection.json").write_text(
                    json.dumps(
                        {
                            "seconds": time.monotonic() - started,
                            "calls": adapter.calls,
                            "projection_complete": False,
                            "last_observation": adapter.observe(),
                        },
                        indent=2,
                    )
                )
            finally:
                adapter.close()
