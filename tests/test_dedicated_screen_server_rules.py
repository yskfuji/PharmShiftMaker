"""Server rules behind the dedicated screens (no database server; SQLite).

- An input file for another department than the one shown is refused.
- The reviewer of an outside declaration is the signed-in administrator.
- A grant assessment records the signed-in account next to the HR verifier.
"""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def test_input_file_for_another_department_is_refused(sqlite_session_factory):
    prepare(sqlite_session_factory)
    data = snapshot()
    body = {
        "snapshot": data.model_copy(
            update={"source_revision": data.source_revision + 1}
        ).model_dump(mode="json"),
        "expected_revision": 1,
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        other = client.post(
            "/planning/inputs?scope_id=hospital%2Fother", headers=admin, json=body
        )
        assert other.status_code == 422 and "選択中の部署と異なります" in other.text
        same = client.post("/planning/inputs" + QUERY, headers=admin, json=body)
        assert same.status_code == 200, same.text


def test_declaration_reviewer_is_the_signed_in_administrator(sqlite_session_factory):
    from shift_scheduler.db.compliance_models import ComplianceEntity

    prepare(sqlite_session_factory)
    evidence = snapshot().policy_evidence.model_dump(mode="json") | {
        "verified_by": "typed name"
    }
    payload = {
        "declaration_id": "outside-1",
        "person_id": "p1",
        "employer_id": "outside",
        "establishment_id": "outside-site",
        "contract_order": 1,
        "reference": "synthetic statement",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2027-01-01T00:00:00+09:00",
        "status": "REVIEWED",
        "work_report_complete": True,
        "review_evidence": evidence,
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        saved = client.post(
            BASE + "/outside-declarations" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "review-outside-1",
                "payload": payload,
            },
        )
        assert saved.status_code == 200, saved.text
    with sqlite_session_factory() as session:
        row = (
            session.query(ComplianceEntity)
            .filter_by(kind="outside_declaration", entity_id="outside-1")
            .one()
        )
        assert row.payload["review_evidence"]["verified_by"] == "admin"
        assert row.payload["review_evidence"]["reference"] == evidence["reference"]


def test_grant_assessment_records_the_signed_in_account(sqlite_session_factory):
    from tests.test_grant_assessment_api import assessment

    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(
            BASE + "/grant-assessments/context" + QUERY, headers=admin
        ).json()
        request = assessment(context)
        result = client.post(
            BASE + "/grant-assessments" + QUERY, headers=admin, json=request
        ).json()
    assert result["recorded_by"] == "admin"
    assert result["scope_id"] == "hospital/pharmacy"
    assert (
        result["assessment"]["evidence"] == request["payload"]["evidence"]
    )  # the HR verifier is kept


def test_any_review_evidence_from_an_administrator_names_the_signed_in_account(
    sqlite_session_factory,
):
    from shift_scheduler.db.compliance_models import ComplianceEntity

    prepare(sqlite_session_factory)
    payload = {
        "declaration_id": "outside-2",
        "person_id": "p1",
        "employer_id": "outside",
        "establishment_id": "outside-site",
        "reference": "synthetic statement",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2027-01-01T00:00:00+09:00",
        "status": "RETURNED",
        "review_evidence": {
            "reference": "mismatch",
            "status": "rejected",
            "verified_by": "typed name",
            "valid_until": None,
        },
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        saved = client.post(
            BASE + "/outside-declarations" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "return-outside-2",
                "payload": payload,
            },
        )
        assert saved.status_code == 200, saved.text
    with sqlite_session_factory() as session:
        row = (
            session.query(ComplianceEntity)
            .filter_by(kind="outside_declaration", entity_id="outside-2")
            .one()
        )
        assert row.payload["review_evidence"]["verified_by"] == "admin"
