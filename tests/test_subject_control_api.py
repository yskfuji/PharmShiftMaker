"""Public HTTP scope and retry checks against an isolated PostgreSQL schema."""

from types import SimpleNamespace

from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.application import subject_controls as controls
from shift_scheduler.control import transaction
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_api import QUERY, token
from tests.test_subject_controls_postgres import SCOPE, setup


def test_subject_control_public_api(pg, monkeypatch):
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    setup(pg)
    with pg.begin() as s:
        s.get(AccountMembership, "admin").issuer = "mock"
        s.add(
            AccountMembership(
                membership_id="staff",
                issuer="mock",
                subject="pharmacist",
                person_id="p1",
                scope_id=SCOPE,
                role="PHARMACIST",
                active=True,
            )
        )
    fake = SimpleNamespace(
        client_id="api-test-source",
        require_access=lambda: {"generation": 1},
        request=lambda *args: {},
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)
    path = "/planning/compliance/subject-controls/p1"
    body = {
        "expected_revision": 0,
        "idempotency_key": "subject-public-api",
        "case_id": "case",
        "case_revision": 3,
        "reason": "reviewed request",
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        foreign = client.post(
            path + "?scope_id=other%2Fpharmacy", headers=admin, json=body
        )
        assert foreign.status_code == 403, foreign.text
        first = client.post(path + QUERY, headers=admin, json=body)
        assert first.status_code == 200, first.text
        assert first.json()["all_copies_erased"] is False
        assert (
            client.post(path + QUERY, headers=admin, json=body).json() == first.json()
        )
        assert (
            client.post(
                path + QUERY, headers=admin, json={**body, "reason": "changed"}
            ).status_code
            == 409
        )
        planned = client.post(
            path + "/plans" + QUERY,
            headers=admin,
            json={"expected_revision": 1, "idempotency_key": "subject-api-plan"},
        )
        assert planned.status_code == 200, planned.text
        plan = planned.json()
        execution = {
            "expected_revision": 1,
            "idempotency_key": "subject-api-execution",
            "plan_id": plan["plan_id"],
            "plan_revision": plan["revision"],
            "fingerprint": plan["fingerprint"],
        }
        executed = client.post(path + "/execute" + QUERY, headers=admin, json=execution)
        assert executed.status_code == 200, executed.text
        assert executed.json()["all_copies_erased"] is False
        assert (
            client.post(path + "/execute" + QUERY, headers=admin, json=execution).json()
            == executed.json()
        )
        monkeypatch.setattr(controls, "configured_client", lambda: None)
        assert client.post(path + QUERY, headers=admin, json=body).status_code == 503
        assert client.get(path + QUERY, headers=admin).status_code == 503
        staff = token(client, "pharmacist")
        assert client.post(path + QUERY, headers=staff, json=body).status_code == 403
