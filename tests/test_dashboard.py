"""Summary counts are observational, scoped and never fabricated on missing data."""

from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.application.dashboard import monthly_summary
from tests.test_compliance_api import prepare, token
from tests.test_planning_postgres import pg  # noqa: F401


def test_summary_month_boundaries_and_unknown():
    publication = {
        "publication_id": "pub",
        "version": 2,
        "input_hash": "hash",
        "period": "2026-01-01T00:00:00+09:00|2026-02-01T00:00:00+09:00",
        "validation_status": "revalidation_required",
        "assignments": [
            {
                "duty_id": "night",
                "start": "2026-01-31T23:00:00+09:00",
                "end": "2026-02-01T08:00:00+09:00",
            }
        ],
    }
    result = monthly_summary("hospital/pharmacy", "2026-01", "ADMIN", [publication], [])
    assert {k: m["value"] for k, m in result["metrics"].items()} == {
        "published_periods": 1,
        "assigned_duties": 1,
        "revalidation_required": 1,
        "pending_requests": 0,
    }
    assert result["sources"][0]["version"] == 2
    feb = monthly_summary("hospital/pharmacy", "2026-02", "ADMIN", [publication], [])
    assert feb["metrics"]["assigned_duties"]["value"] == 1
    assert feb["metrics"]["published_periods"]["value"] == 0
    bad = monthly_summary(
        "hospital/pharmacy",
        "2026-01",
        "ADMIN",
        [{**publication, "period": "unknown"}],
        [],
    )
    assert bad["metrics"]["assigned_duties"]["value"] is None
    assert bad["metrics"]["assigned_duties"]["state"] == "unknown"
    assert (
        monthly_summary("hospital/pharmacy", "2026-03", "ADMIN", [publication], [])[
            "metrics"
        ]["assigned_duties"]["value"]
        == 0
    )


def test_dashboard_public_api_authorization_and_input(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        headers = token(client)
        query = "?scope_id=hospital/pharmacy&period=2026-01"
        response = client.get("/planning/dashboard" + query, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["metrics"]["published_periods"]["value"] == 0
        assert "99.9" not in response.text
        assert (
            client.get(
                "/planning/dashboard?scope_id=other/department&period=2026-01",
                headers=headers,
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/planning/dashboard?scope_id=hospital/pharmacy&period=2026-13",
                headers=headers,
            ).status_code
            == 422
        )
        for invalid in ("0000-01", "9999-12"):
            assert (
                client.get(
                    "/planning/dashboard?scope_id=hospital/pharmacy&period=" + invalid,
                    headers=headers,
                ).status_code
                == 422
            )
        headers = token(client, "pharmacist")
        own = client.get("/planning/dashboard" + query, headers=headers)
        assert own.status_code == 200
        assert own.json()["visibility"] == "self"


def test_pending_requests_exclude_other_month_and_decided():
    request = {
        "request_id": "r",
        "version": 3,
        "status": "PENDING",
        "payload": {"start": "2026-01-31T15:00:00Z", "end": "2026-02-01T15:00:00Z"},
    }
    assert (
        monthly_summary("s", "2026-01", "STAFF", [], [request])["metrics"][
            "pending_requests"
        ]["value"]
        == 0
    )
    assert (
        monthly_summary("s", "2026-02", "STAFF", [], [request])["metrics"][
            "pending_requests"
        ]["value"]
        == 1
    )
    assert (
        monthly_summary(
            "s", "2026-02", "STAFF", [], [{**request, "status": "CANCELLED"}]
        )["metrics"]["pending_requests"]["value"]
        == 0
    )


def test_dashboard_postgres(pg, monkeypatch):  # noqa: F811 - imported pytest fixture
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    test_dashboard_public_api_authorization_and_input(pg)


def test_publication_count_is_scoped_and_dashboard_is_read_only(sqlite_session_factory):
    from sqlalchemy import func, select

    from shift_scheduler.application import planning
    from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox
    from shift_scheduler.optimizer.planning import solve
    from tests.test_reviewed_planning import snapshot

    data = snapshot()
    with sqlite_session_factory.begin() as session:
        for user, person, role in [
            ("admin", "p0", "ADMIN"),
            ("pharmacist", "not-assigned", "PHARMACIST"),
        ]:
            session.add(
                AccountMembership(
                    membership_id=user,
                    issuer="mock",
                    subject=user,
                    person_id=person,
                    scope_id="hospital/pharmacy",
                    role=role,
                    active=True,
                )
            )
        planning.register_input(session, data, "fixture", 0)
        row = planning.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = planning.new_draft(session, row, solve(data, 2).proposal, "admin")
        session.flush()
        checked = planning.review_draft(
            session, draft.draft_id, "hospital/pharmacy", draft.version, "admin"
        )
        planning.publish(
            session,
            draft.draft_id,
            "hospital/pharmacy",
            "admin",
            draft.version,
            0,
            data.input_hash,
            checked["review_hash"],
            "dashboard-fixture-publish",
        )
        session.flush()
        before = session.scalar(select(func.count()).select_from(PlanningOutbox))
    with TestClient(app, base_url="https://localhost:8000") as client:
        path = "/planning/dashboard?scope_id=hospital/pharmacy&period=2026-01"
        admin = client.get(path, headers=token(client)).json()
        own = client.get(path, headers=token(client, "pharmacist")).json()
        assert admin["metrics"]["assigned_duties"]["value"] == 2
        assert own["metrics"]["assigned_duties"]["value"] == 0
        assert own["metrics"]["published_periods"]["value"] == 1
    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(func.count()).select_from(PlanningOutbox)) == before
        )


def test_assignment_identity_is_scoped_to_publication_not_reused_duty_id():
    def publication(key, start, end, person):
        return {
            "publication_id": key,
            "version": 1,
            "input_hash": key,
            "period": start + "|" + end,
            "validation_status": "verified_at_publication",
            "assignments": [
                {"duty_id": "reused", "person_id": person, "start": start, "end": end}
            ],
        }

    january = publication(
        "january", "2026-01-31T23:00:00+09:00", "2026-02-01T08:00:00+09:00", "a"
    )
    february = publication(
        "february", "2026-02-05T09:00:00+09:00", "2026-02-05T17:00:00+09:00", "a"
    )
    other = publication(
        "other", "2026-02-05T09:00:00+09:00", "2026-02-05T17:00:00+09:00", "b"
    )
    boundary = publication(
        "boundary", "2026-01-31T16:00:00+09:00", "2026-02-01T00:00:00+09:00", "a"
    )
    result = monthly_summary(
        "s", "2026-02", "ADMIN", [january, february, other, boundary], []
    )
    assert result["metrics"]["assigned_duties"]["value"] == 3
    assert {source["id"] for source in result["sources"]} == {
        "january",
        "february",
        "other",
    }


def test_observation_clock_is_a_server_dependency_not_a_client_claim(
    sqlite_session_factory,
):
    from datetime import UTC, datetime

    from shift_scheduler.api.routers.planning import dashboard_observation_time

    prepare(sqlite_session_factory)
    app.dependency_overrides[dashboard_observation_time] = lambda: datetime(
        2026, 9, 28, tzinfo=UTC
    )
    try:
        with TestClient(app, base_url="https://localhost:8000") as client:
            response = client.get(
                "/planning/dashboard?scope_id=hospital/pharmacy&period=2026-01&observed_at=1900-01-01",
                headers=token(client),
            )
            assert response.status_code == 200
            assert response.json()["observed_at"] == "2026-09-28T00:00:00+00:00"
    finally:
        app.dependency_overrides.pop(dashboard_observation_time, None)
