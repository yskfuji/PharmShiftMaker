"""Public-API reconciliation binds corrected HR values and exact input evidence."""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def assessment(context):
    return {
        "input_hash": context["input_hash"],
        "expected_revision": context["source_revision"],
        "idempotency_key": "assessment-request-1",
        "payload": {
            "assessment_id": "assess-1",
            "account_id": "g0",
            "person_id": "p0",
            "employer_id": "hospital",
            "basis_date": "2026-01-01",
            "completed_service_months": 6,
            "scheduled_week_seconds": 20 * 3600,
            "schedule_basis": "weekly",
            "scheduled_week_days": 3,
            "scheduled_year_days": None,
            "attendance_days": 80,
            "attendance_denominator": 100,
            "evidence": snapshot().policy_evidence.model_dump(mode="json"),
        },
    }


def test_assessment_authorization_replay_and_corrected_grant(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(
            BASE + "/grant-assessments/context" + QUERY, headers=admin
        ).json()
        request = assessment(context)
        result = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "pass"
        assert result.json()["expected_statutory_days"] == 5
        assert result.json()["assessment"] == request["payload"]
        assert (
            client.post(
                BASE + "/grant-assessments" + QUERY, headers=admin, json=request
            ).json()
            == result.json()
        )
        correction = {
            "expected_revision": 0,
            "idempotency_key": "assessment-correction",
            "payload": {
                "amendment_id": "amended-g0",
                "person_id": "p0",
                "account_id": "g0",
                "external_event_id": "hr:g0",
                "external_revision": 2,
                "supersedes_revision": 1,
                "effective_on": "2026-01-01",
                "recorded_at": "2026-02-01T00:00:00+09:00",
                "granted_days": 3,
                "statutory_days": 3,
                "reason": "HR correction",
                "evidence": snapshot().policy_evidence.model_dump(mode="json"),
            },
        }
        assert (
            client.post(
                BASE + "/grant-amendments" + QUERY, headers=admin, json=correction
            ).status_code
            == 200
        )
        request["idempotency_key"] = "stale-assessment"
        assert (
            client.post(
                BASE + "/grant-assessments" + QUERY, headers=admin, json=request
            ).status_code
            == 409
        )
        context = client.get(
            BASE + "/grant-assessments/context" + QUERY, headers=admin
        ).json()
        assert (
            next(a for a in context["accounts"] if a["account_id"] == "g0")[
                "statutory_days"
            ]
            == 3
        )
        request = assessment(context)
        request["idempotency_key"] = "new-assessment"
        result = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert result.status_code == 200, result.text
        assert (
            result.json()["status"] == "mismatch"
            and result.json()["imported_statutory_days"] == 3
        )
        # Missing/guessed fingerprint does not use a permissive old update path.
        del request["input_hash"]
        assert (
            client.post(
                BASE + "/grant-assessments" + QUERY, headers=admin, json=request
            ).status_code
            == 422
        )
        staff = token(client, "pharmacist")
        assert (
            client.get(
                BASE + "/grant-assessments/context" + QUERY, headers=staff
            ).status_code
            == 403
        )
        assert (
            client.post(
                BASE + "/grant-assessments" + QUERY,
                headers=staff,
                json=assessment(context),
            ).status_code
            == 403
        )


def test_split_series_entitlement_is_wired_through_public_api(sqlite_session_factory):
    prepare(sqlite_session_factory, snapshot(with_grant_series=True))
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(
            BASE + "/grant-assessments/context" + QUERY, headers=admin
        ).json()
        request = assessment(context)
        request["payload"].update(
            account_id="split-first",
            scheduled_week_days=4,
            basis_date="2026-01-02",
            cycle_account_ids=["split-first", "split-second"],
            cycle_evidence=request["payload"]["evidence"],
        )
        response = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "pass"
        assert response.json()["imported_statutory_days"] == 7
        assert response.json()["expected_statutory_days"] == 7
        request["idempotency_key"] = "missing-cycle-member"
        request["payload"]["cycle_account_ids"] = ["split-first"]
        response = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        )
        assert response.status_code == 200
        assert response.json()["status"] == "unverified"
