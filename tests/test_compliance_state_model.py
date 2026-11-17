"""Bounded model replay; this does not prove the entire application."""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import PrivacyCase
from tests.test_compliance_api import BASE, QUERY, prepare, token
from tests.test_compliance_v2 import v2

# Independent acceptance table, deliberately not imported from application code.
ALLOWED = {
    ("REQUESTED", "VERIFIED"),
    ("REQUESTED", "REJECTED"),
    ("VERIFIED", "APPROVED"),
    ("VERIFIED", "REJECTED"),
    ("APPROVED", "COMPLETED"),
    ("APPROVED", "RELEASED"),
    ("COMPLETED", "RELEASED"),
}


@pytest.mark.parametrize(
    "before", ["REQUESTED", "VERIFIED", "APPROVED", "COMPLETED", "RELEASED", "REJECTED"]
)
@pytest.mark.parametrize(
    "after", ["VERIFIED", "APPROVED", "REJECTED", "COMPLETED", "RELEASED"]
)
def test_all_thirty_privacy_transition_edges(sqlite_session_factory, before, after):
    prepare(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(
            PrivacyCase(
                case_id="finite",
                scope_id="hospital/pharmacy",
                person_id="p0",
                kind="access",
                status=before,
                revision=7,
                payload={"reason": "synthetic finite model"},
            )
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        result = client.post(
            BASE + "/privacy/cases/finite" + QUERY,
            headers=token(client),
            json={
                "expected_revision": 7,
                "idempotency_key": "finite-transition",
                "payload": {
                    "status": after,
                    "reason": "reviewed synthetic result",
                    "identity_evidence": v2().policy_evidence.model_dump(mode="json"),
                    "result_reference": "local://synthetic-result",
                },
            },
        )
    allowed = (before, after) in ALLOWED
    assert result.status_code == (200 if allowed else 422), result.text
    with sqlite_session_factory() as session:
        row = session.get(PrivacyCase, "finite")
        assert row.status == (after if allowed else before)
        assert row.revision == (8 if allowed else 7)
