from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.planning_models import ActualWorkEvent
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def test_current_actual_revision_is_checked_and_legacy_write_closed(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    duty = (
        snapshot()
        .candidates[0]
        .model_copy(update={"source": "actual"})
        .model_dump(mode="json")
    )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)

        def send(version, expected, key):
            return client.post(
                BASE + "/actual-events" + QUERY,
                headers=admin,
                json={
                    "expected_revision": expected,
                    "idempotency_key": key,
                    "payload": {
                        "external_id": "clock-original",
                        "revision": version,
                        "duty": duty,
                    },
                },
            )

        assert send(5, 4, "unobserved-start").status_code == 409
        original = send(1, 0, "original-actual")
        assert original.status_code == 200, original.text
        assert send(3, 2, "invented-current").status_code == 409
        assert send(2, 1, "reviewed-correction").status_code == 200
        assert send(1, 0, "original-actual").json() == original.json()
        legacy = client.post(
            "/planning/actuals" + QUERY,
            headers=admin,
            json={"external_id": "clock-original", "revision": 3, "duty": duty},
        )
        assert legacy.status_code == 410
    with sqlite_session_factory() as session:
        assert [
            r.revision
            for r in session.scalars(
                select(ActualWorkEvent).order_by(ActualWorkEvent.revision)
            )
        ] == [1, 2]


def test_actual_terms_and_review_use_observed_versions(sqlite_session_factory):
    from shift_scheduler.db.planning_models import AccountMembership

    prepare(sqlite_session_factory)
    data = snapshot()
    duty = (
        data.candidates[0]
        .model_copy(update={"source": "actual"})
        .model_dump(mode="json")
    )
    with sqlite_session_factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="leader",
                issuer="mock",
                subject="leader",
                person_id="p0",
                scope_id="hospital/pharmacy",
                role="LEADER",
                active=True,
            )
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(BASE + "/workflow-context" + QUERY, headers=admin)
        assert context.status_code == 200
        terms = next(
            t for t in data.work_terms if t.duty_id == duty["duty_id"]
        ).model_dump(mode="json")
        terms["scheduled_work"] = []  # changed classification, not an identical no-op
        rows = context.json()["records"]
        current = next(
            (
                r["revision"]
                for r in rows
                if r["kind"] == "work_terms" and r["entity_id"] == duty["duty_id"]
            ),
            0,
        )
        request = {
            "expected_revision": 0,
            "idempotency_key": "terms-cas",
            "payload": {
                "external_id": "terms-original",
                "revision": 1,
                "duty": duty,
                "work_terms": terms,
                "expected_work_terms_revision": current,
            },
        }
        for invalid in (
            {**terms, "employment_revision_ids": [terms["employment_revision_id"]]},
            {**terms, "employment_revision_id": "unregistered-employment"},
            {
                **terms,
                "scheduled_work": [
                    {
                        "start": "2020-01-01T00:00:00+09:00",
                        "end": "2020-01-01T01:00:00+09:00",
                    }
                ],
            },
        ):
            bad = {**request, "payload": {**request["payload"], "work_terms": invalid}}
            assert (
                client.post(
                    BASE + "/actual-events" + QUERY, headers=admin, json=bad
                ).status_code
                == 422
            )
        saved = client.post(
            BASE + "/actual-events" + QUERY, headers=admin, json=request
        )
        assert saved.status_code == 200, saved.text
        stale = {
            **request,
            "expected_revision": 1,
            "idempotency_key": "terms-stale",
            "payload": {**request["payload"], "revision": 2},
        }
        assert (
            client.post(
                BASE + "/actual-events" + QUERY, headers=admin, json=stale
            ).status_code
            == 409
        )
        ctx = client.get(BASE + "/workflow-context" + QUERY, headers=admin).json()
        assert (
            ctx["actuals"][0]["revision"] == 1
        )  # failed terms update rolls back the whole correction
        review = {
            "expected_revision": 1,
            "idempotency_key": "actual-review",
            "payload": {
                "external_id": "terms-original",
                "reason": "独立した勤怠原本と照合",
            },
        }
        client.cookies.clear()
        login = client.post(
            "/auth/login", json={"username": "leader", "password": "pass-lead"}
        )
        leader = {"Authorization": "Bearer " + login.json()["access_token"]}
        response = client.post(
            BASE + "/actual-reviews" + QUERY, headers=leader, json=review
        )
        assert response.status_code == 200, response.text
        assert (
            client.post(
                BASE + "/actual-reviews" + QUERY, headers=leader, json=review
            ).json()
            == response.json()
        )
        assert (
            client.post(
                BASE + "/actual-events" + QUERY, headers=leader, json=request
            ).status_code
            == 403
        )
        staff = token(client, "pharmacist")
        assert (
            client.get(BASE + "/workflow-context" + QUERY, headers=staff).status_code
            == 403
        )
        assert (
            client.post(
                BASE + "/actual-reviews" + QUERY, headers=staff, json=review
            ).status_code
            == 403
        )
