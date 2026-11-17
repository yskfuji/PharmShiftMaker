"""Owned real PostgreSQL application + separate authority/witness databases and HTTP."""

import os
from unittest.mock import patch

import pytest
from scripts.owned_control_services import owned_control_services
from sqlalchemy import select

from shift_scheduler.db.compliance_models import ControlCommit, ErasedSubject
from tests.test_subject_controls_postgres import call, setup


@pytest.mark.skipif(
    os.getenv("PHARMSHIFT_TEST_NETWORK_FAULTS") != "1",
    reason="Owned HTTP/database services require explicit opt in",
)
def test_subject_control_commits_to_real_independent_services(pg, tmp_path):
    setup(pg)
    with owned_control_services(tmp_path / "services") as services:
        with patch.dict(os.environ, services["environment"]):
            with pg.begin() as s:
                result = call(s)
                assert result["all_copies_erased"] is False
            status = services["clients"]["source"].require_access()
            assert status["generation"] == 1
            with pg.begin() as s:
                assert call(s) == result
            assert services["clients"]["source"].require_access()["generation"] == 1
            with pg() as s:
                assert len(list(s.scalars(select(ControlCommit)))) == 1
                assert s.get(ErasedSubject, ("hospital", "p1")) is not None

            from cryptography.hazmat.primitives.asymmetric.ed25519 import (
                Ed25519PrivateKey,
            )

            from shift_scheduler.db.restore_lock import RestoreUnavailable

            key = Ed25519PrivateKey.generate()
            trust = {
                "public_key": key.public_key().public_bytes_raw().hex(),
                "target_hash": "a" * 64,
                "policy_hash": "b" * 64,
                "domains": ["application_database", "managed_files"],
            }
            clients = services["clients"]
            clients["operator"].request("POST", "/nodes/restore/quarantine", {})
            status = services["configure_restore_verifiers"]({"restore": trust})
            assert status["generation"] == 1
            challenge = clients["operator"].request(
                "POST", "/nodes/restore/verification", {}
            )
            assert challenge["target_hash"] == trust["target_hash"]
            assert challenge["generation"] == 1
            with pytest.raises(RestoreUnavailable):
                clients["restore"].require_access()
            assert clients["source"].require_access()["generation"] == 1
