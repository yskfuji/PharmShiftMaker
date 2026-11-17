"""Historical input recovery through the public API, never input reactivation."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from shift_scheduler.api.main import app
from shift_scheduler.db.planning_models import AccountMembership, PlanningJob
from tests.test_compliance_api import QUERY, token
from tests.test_reviewed_planning import snapshot


def exercise(factory):
    with factory.begin() as session:
        session.add_all(
            [
                AccountMembership(
                    membership_id=name,
                    issuer="mock",
                    subject=name,
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role="ADMIN" if name == "admin" else "LEADER",
                    active=True,
                )
                for name in ("admin", "pharmacist")
            ]
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        a = snapshot()
        response = client.post(
            "/planning/inputs",
            headers=auth,
            json={"snapshot": a.model_dump(mode="json"), "expected_revision": 0},
        )
        assert response.status_code == 200, response.text
        key = "interrupted-request"
        accepted = client.post(
            "/planning/jobs" + QUERY,
            headers=auth,
            json={
                "input_hash": a.input_hash,
                "budget_seconds": 20,
                "idempotency_key": key,
            },
        )
        assert accepted.status_code == 202, accepted.text
        identity = accepted.json()["job_id"]
        b = a.model_copy(update={"source_revision": a.source_revision + 1})
        moved = client.post(
            "/planning/inputs",
            headers=auth,
            json={"snapshot": b.model_dump(mode="json"), "expected_revision": 1},
        )
        assert moved.status_code == 200, moved.text
        stale = client.post(
            "/planning/inputs",
            headers=auth,
            json={"snapshot": a.model_dump(mode="json"), "expected_revision": 2},
        )
        assert stale.status_code == 409
        path = "/planning/jobs/by-key" + QUERY + "&idempotency_key=" + key
        found = client.get(path, headers=auth)
        assert found.status_code == 200, found.text
        assert found.json()["job"]["job_id"] == identity
        assert found.json()["job"]["input_hash"] == a.input_hash
        assert found.json()["job"]["budget_seconds"] == 20
        assert client.get(path, headers=auth).json() == found.json()
        assert client.get(
            path.replace(key, "missing-request"), headers=auth
        ).json() == {"job": None}
        assert (
            client.get(path.replace("pharmacy", "other"), headers=auth).status_code
            == 403
        )
        assert client.get(path, headers=token(client, "pharmacist")).json() == {
            "job": None
        }
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(PlanningJob)) == 1


def test_historical_job_lookup_is_actor_scoped_and_does_not_enqueue(
    sqlite_session_factory,
):
    exercise(sqlite_session_factory)


def test_historical_job_lookup_on_postgres(pg, monkeypatch):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    exercise(pg)
