from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import ComplianceRevision
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def declaration():
    return {
        "declaration_id": "outside-original",
        "person_id": "p1",
        "employer_id": "other",
        "establishment_id": "other-site",
        "contract_order": 2,
        "activity": "employment",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2027-01-01T00:00:00+09:00",
        "scheduled_work": [],
        "additional_work": [],
        "work_report_complete": False,
        "reference": "synthetic declaration",
        "status": "SUBMITTED",
        "review_evidence": None,
    }


def test_self_withdraw_replay_conflict_and_authorization(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = token(client, "pharmacist")

        def send(payload, revision, key):
            return client.post(
                BASE + "/outside-declarations" + QUERY,
                headers=staff,
                json={
                    "payload": payload,
                    "expected_revision": revision,
                    "idempotency_key": key,
                },
            )

        assert (
            send(
                {**declaration(), "status": "WITHDRAWN"}, 0, "missing-target"
            ).status_code
            == 422
        )
        original = send(declaration(), 0, "create-original")
        assert original.status_code == 200, original.text
        assert (
            send({**declaration(), "person_id": "p0"}, 1, "wrong-person").status_code
            == 403
        )
        invalid = {
            **declaration(),
            "status": "WITHDRAWN",
            "reference": "silently changed",
        }
        assert send(invalid, 1, "changed-withdraw").status_code == 422
        withdrawal = {**declaration(), "status": "WITHDRAWN"}
        result = send(withdrawal, 1, "withdraw-original")
        assert result.status_code == 200, result.text
        assert result.json()["revision"] == 2
        assert send(withdrawal, 1, "withdraw-original").json() == result.json()
        assert send(declaration(), 1, "stale-resubmission").status_code == 409
        assert send(declaration(), 2, "reviewed-resubmission").status_code == 200
        for path in ["/storage-coverage", "/recovery-status"]:
            assert client.get(BASE + path + QUERY, headers=staff).status_code == 403
    with sqlite_session_factory() as session:
        versions = list(
            session.scalars(
                select(ComplianceRevision)
                .where(ComplianceRevision.entity_key == original.json()["key"])
                .order_by(ComplianceRevision.revision)
            )
        )
        assert [r.payload["status"] for r in versions] == [
            "SUBMITTED",
            "WITHDRAWN",
            "SUBMITTED",
        ]
