"""Public mutation receipts survive response loss without changing business versions."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningDraft,
    PlanningOutbox,
)
from shift_scheduler.optimizer.planning import solve
from tests.test_compliance_api import QUERY, token
from tests.test_reviewed_planning import snapshot


def exercise(factory):
    data = snapshot()
    proposal = solve(data, 2).proposal.model_dump(mode="json")
    with factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p0",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        register_input(s, data, "fixture", 0)
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        body = {
            "input_hash": data.input_hash,
            "proposal": proposal,
            "idempotency_key": "draft-create-response-lost",
        }
        response = client.post("/planning/drafts" + QUERY, headers=auth, json=body)
        assert response.status_code == 201, response.text
        assert (
            client.post("/planning/drafts" + QUERY, headers=auth, json=body).json()
            == response.json()
        )
        draft = response.json()
        path = "/planning/drafts/" + draft["draft_id"]
        edit = {
            "proposal": proposal,
            "version": 1,
            "idempotency_key": "draft-edit-response-lost",
        }
        updated = client.put(path + QUERY, headers=auth, json=edit)
        assert updated.status_code == 200, updated.text
        assert (
            client.put(path + QUERY, headers=auth, json=edit).json() == updated.json()
        )
        assert updated.json()["version"] == 2
        assert (
            client.put(
                path + QUERY,
                headers=auth,
                json={**edit, "idempotency_key": "stale-version-other-key"},
            ).status_code
            == 409
        )
        review = {"version": 2, "idempotency_key": "draft-review-response-lost"}
        checked = client.post(path + "/review" + QUERY, headers=auth, json=review)
        assert checked.status_code == 200, checked.text
        assert (
            client.post(path + "/review" + QUERY, headers=auth, json=review).json()
            == checked.json()
        )
        publish = {
            **review,
            "idempotency_key": "publication-response-lost",
            "expected_publication_version": 0,
            "input_hash": data.input_hash,
            "review_hash": checked.json()["review_hash"],
        }
        published = client.post(path + "/publish" + QUERY, headers=auth, json=publish)
        assert published.status_code == 200, published.text
        assert (
            client.post(path + "/publish" + QUERY, headers=auth, json=publish).json()
            == published.json()
        )
        cancellation = {
            "expected_version": 1,
            "reason": "synthetic withdrawal",
            "idempotency_key": "publication-cancel-lost",
        }
        cancel_path = (
            "/planning/publications/"
            + published.json()["publication_id"]
            + "/cancel"
            + QUERY
        )
        cancelled = client.post(cancel_path, headers=auth, json=cancellation)
        assert cancelled.status_code == 200, cancelled.text
        assert (
            client.post(cancel_path, headers=auth, json=cancellation).json()
            == cancelled.json()
        )
        assert (
            client.post(
                cancel_path,
                headers=auth,
                json={**cancellation, "reason": "different body"},
            ).status_code
            == 409
        )
        with factory() as s:
            assert s.scalar(select(func.count()).select_from(PlanningDraft)) == 1
            for kind in ("draft.edit", "draft.review", "schedule.cancelled"):
                assert (
                    s.scalar(
                        select(func.count())
                        .select_from(PlanningOutbox)
                        .where(PlanningOutbox.kind == kind)
                    )
                    == 1
                ), kind


def test_retry_sqlite(sqlite_session_factory):
    exercise(sqlite_session_factory)


def test_retry_postgres(pg, monkeypatch):
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    exercise(pg)
