"""Replay counterexamples through real HTTP authorization and transactions."""

from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_v2 import v2


def prepare(factory):
    with factory.begin() as session:
        for subject, person, role in [
            ("admin", "p0", "ADMIN"),
            ("pharmacist", "outsider", "PHARMACIST"),
        ]:
            session.add(
                AccountMembership(
                    membership_id=subject,
                    issuer="mock",
                    subject=subject,
                    person_id=person,
                    scope_id="hospital/pharmacy",
                    role=role,
                    active=True,
                )
            )
        register_input(session, v2(), "fixture", 0)


def token(client, who="admin"):
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        json={
            "username": who,
            "password": "pass-admin" if who == "admin" else "pass-ph",
        },
    )
    return {"Authorization": "Bearer " + response.json()["access_token"]}


BASE = "/planning/compliance"
QUERY = "?scope_id=hospital%2Fpharmacy"


def test_scoped_self_service_and_idempotency_conflict(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                ComplianceEntity(
                    key="former-person-record",
                    scope_id="hospital/pharmacy",
                    kind="contract",
                    entity_id="former-contract",
                    person_id="former-person",
                    revision=1,
                    payload={"status": "ended"},
                ),
                ComplianceEntity(
                    key="foreign-person-record",
                    scope_id="hospital/other-department",
                    kind="contract",
                    entity_id="foreign-contract",
                    person_id="foreign-person",
                    revision=1,
                    payload={"status": "ended"},
                ),
            ]
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        payload = {
            "expected_revision": 0,
            "idempotency_key": "create-test-record",
            "payload": {"person_id": "new", "name": "Synthetic"},
        }
        first = client.post(
            BASE + "/records/person" + QUERY, json=payload, headers=admin
        )
        assert first.status_code == 200, first.text
        repeat = client.post(
            BASE + "/records/person" + QUERY, json=payload, headers=admin
        )
        assert repeat.json() == first.json()
        altered = {**payload, "payload": {"person_id": "new", "name": "Changed"}}
        assert (
            client.post(
                BASE + "/records/person" + QUERY, json=altered, headers=admin
            ).status_code
            == 409
        )
        staff = token(client, "pharmacist")
        assert (
            client.post(
                BASE + "/records/person" + QUERY, json=payload, headers=staff
            ).status_code
            == 403
        )
        assert client.get(BASE + "/schemas" + QUERY, headers=staff).status_code == 403
        records = client.get(BASE + "/records" + QUERY, headers=staff)
        assert records.status_code == 200 and records.json() == []
        foreign = {
            "expected_revision": 0,
            "idempotency_key": "request-other-person",
            "payload": {
                "person_id": "p0",
                "kind": "access",
                "reason": "counterexample",
            },
        }
        assert (
            client.post(
                BASE + "/privacy/requests" + QUERY, json=foreign, headers=staff
            ).status_code
            == 403
        )
        unknown = {
            "expected_revision": 0,
            "idempotency_key": "request-unknown-person",
            "payload": {
                "person_id": "outside-this-scope",
                "kind": "access",
                "reason": "scope counterexample",
            },
        }
        response = client.post(
            BASE + "/privacy/requests" + QUERY, json=unknown, headers=admin
        )
        assert response.status_code == 404
        assert (
            response.json()["detail"]
            == "対象となる職員が、この施設・部署に見つかりません。"
        )
        former = {
            "expected_revision": 0,
            "idempotency_key": "request-former-person",
            "payload": {
                "person_id": "former-person",
                "kind": "access",
                "reason": "former staff counterexample",
            },
        }
        response = client.post(
            BASE + "/privacy/requests" + QUERY, json=former, headers=admin
        )
        assert response.status_code == 200, response.text
        foreign = {
            **former,
            "idempotency_key": "request-foreign-person",
            "payload": {**former["payload"], "person_id": "foreign-person"},
        }
        response = client.post(
            BASE + "/privacy/requests" + QUERY, json=foreign, headers=admin
        )
        assert response.status_code == 404


def test_privacy_transitions_stale_decision_and_use_restriction(
    sqlite_session_factory, monkeypatch
):
    monkeypatch.setenv("SHIFT_SCHEDULER_DATA_BACKEND", "db")
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        request = {
            "expected_revision": 0,
            "idempotency_key": "request-restrict",
            "payload": {
                "person_id": "p0",
                "kind": "restrict",
                "reason": "purpose dispute",
            },
        }
        result = client.post(
            BASE + "/privacy/requests" + QUERY, json=request, headers=admin
        ).json()
        path = BASE + "/privacy/cases/" + result["case_id"] + QUERY
        decision = {
            "expected_revision": 1,
            "idempotency_key": "direct-completion",
            "payload": {
                "status": "COMPLETED",
                "reason": "wrong order",
                "identity_evidence": v2().policy_evidence.model_dump(mode="json"),
                "result_reference": "not-performed",
            },
        }
        assert client.post(path, json=decision, headers=admin).status_code == 422
        for revision, state in [(1, "VERIFIED"), (2, "APPROVED")]:
            decision.update(
                expected_revision=revision,
                idempotency_key="transition-" + state,
                payload={**decision["payload"], "status": state},
            )
            response = client.post(path, json=decision, headers=admin)
            assert response.status_code == 200, response.text
        # The accepted request is operationally enforced, not just a displayed status.
        assert (
            client.get("/planning/inputs/latest" + QUERY, headers=admin).status_code
            == 423
        )
        assert client.get(BASE + "/privacy" + QUERY, headers=admin).status_code == 200
        assert client.get("/staff", headers=admin).status_code == 423
        assert (
            client.post(
                BASE + "/actual-events" + QUERY,
                headers=admin,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "blocked-actual",
                    "payload": {},
                },
            ).status_code
            == 423
        )
        stale = {
            **decision,
            "idempotency_key": "stale-review",
            "expected_revision": 1,
            "payload": {**decision["payload"], "status": "COMPLETED"},
        }
        assert client.post(path, json=stale, headers=admin).status_code == 409


def test_erasure_preview_receipt_does_not_invalidate_its_own_fingerprint(
    sqlite_session_factory,
):
    from shift_scheduler.application.privacy import save_rule
    from shift_scheduler.domain.privacy import RetentionPolicy

    prepare(sqlite_session_factory)
    data = v2()
    with sqlite_session_factory.begin() as session:
        register_input(
            session, data.model_copy(update={"source_revision": 1}), "admin", 1
        )
        save_rule(
            session,
            "hospital/pharmacy",
            RetentionPolicy(
                category="planning_history",
                purpose="synthetic expired data only",
                anchor="period_end",
                retention_days=1,
                legal_minimum_days=1,
                effective_from="2026-01-01",
                effective_until="2030-01-01",
                evidence=data.policy_evidence,
                owner="test",
                next_review="2029-01-01",
            ),
            0,
            "admin",
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        headers = token(client)
        request = {
            "expected_revision": 0,
            "idempotency_key": "erase-preview-once",
            "payload": {"input_hash": data.input_hash},
        }
        preview = client.post(
            BASE + "/erasure-preview" + QUERY, json=request, headers=headers
        )
        assert preview.status_code == 200, preview.text
        result = preview.json()
        assert not result["blockers"]
        request.update(
            idempotency_key="erase-execute-once",
            payload={
                "plan_id": result["plan_id"],
                "fingerprint": result["fingerprint"],
            },
        )
        executed = client.post(
            BASE + "/erasure-execute" + QUERY, json=request, headers=headers
        )
        assert executed.status_code == 200, executed.text
        assert executed.json()["status"] == "EXECUTED"
        assert (
            client.post(
                BASE + "/erasure-execute" + QUERY, json=request, headers=headers
            ).json()
            == executed.json()
        )


def test_typed_hourly_leave_request_requires_review_and_does_not_reserve_early(
    sqlite_session_factory,
):
    from shift_scheduler.application import planning as service
    from shift_scheduler.db.planning_models import PlanningScope
    from shift_scheduler.domain.compliance import parse_snapshot
    from tests.test_compliance_v2 import leave_fixture

    with sqlite_session_factory.begin() as session:
        for subject, role in [("admin", "ADMIN"), ("pharmacist", "PHARMACIST")]:
            session.add(
                AccountMembership(
                    membership_id=subject,
                    issuer="mock",
                    subject=subject,
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role=role,
                    active=True,
                )
            )
        register_input(session, leave_fixture(), "admin", 0)
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = token(client, "pharmacist")
        request = {
            "expected_revision": 0,
            "idempotency_key": "hourly-leave-request",
            "payload": {
                "account_id": "g",
                "policy_id": "lp",
                "unit": "hour",
                "quantity": 1,
                "interval": {
                    "start": "2026-01-06T09:00:00+09:00",
                    "end": "2026-01-06T10:00:00+09:00",
                },
                "reference": "synthetic request",
            },
        }
        response = client.post(
            BASE + "/leave-requests" + QUERY, json=request, headers=staff
        )
        assert response.status_code == 200, response.text
        identity = response.json()["request_id"]
        admin = token(client)
        assert (
            client.post(
                "/planning/requests/" + identity + "/decision" + QUERY,
                json={
                    "version": 1,
                    "approved": True,
                    "reference": "verified request",
                    "idempotency_key": "verified-request-1",
                },
                headers=admin,
            ).status_code
            == 200
        )
        with sqlite_session_factory.begin() as session:
            revision = session.get(PlanningScope, "hospital/pharmacy").input_revision
            refreshed = service.refresh_input(
                session, "hospital/pharmacy", "admin", revision
            )
            data = parse_snapshot(
                service.require_input(
                    session, refreshed["input_hash"], "hospital/pharmacy"
                ).payload
            )
            assert data.leave_records[-1].unit == "hour"
            assert not data.unresolved_requests
        balance = client.get(BASE + "/leave-report" + QUERY, headers=admin)
        assert balance.status_code == 200, balance.text
        assert balance.json()["balances"][0]["reserved_days"] == {
            "numerator": 0,
            "denominator": 1,
        }
