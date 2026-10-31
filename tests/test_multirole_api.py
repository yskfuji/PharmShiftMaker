"""Real HTTP routing on isolated databases; bootstrap only the administrator."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shift_scheduler.api.main import app
from shift_scheduler.api.routers import planning as router
from shift_scheduler.application.worker import run_once
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import AccountMembership
from shift_scheduler.domain.planning import SolverSnapshot
from tests.test_multirole_boundaries import clerical_snapshot

SCOPE = "?scope_id=hospital%2Fpharmacy"


@pytest.fixture(params=["sqlite", "postgres"])
def clients(request, tmp_path, monkeypatch):
    engine = None
    if request.param == "postgres":
        factory = request.getfixturevalue("pg")
    else:
        engine = create_engine(f'sqlite:///{tmp_path / "multirole.db"}')
        Base.metadata.create_all(engine)
        factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(router, "get_session_factory", lambda: factory)
    with factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="admin-bootstrap",
                issuer="mock",
                subject="admin",
                person_id="manager",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
    result = {}
    for name, password in [
        ("admin", "pass-admin"),
        ("staff", "pass-staff"),
        ("pharmacist", "pass-ph"),
    ]:
        client = TestClient(app, headers={"Origin": "https://localhost:3000"})
        assert (
            client.post(
                "/auth/login", json={"username": name, "password": password}
            ).status_code
            == 200
        )
        result[name] = client
    result["factory"] = factory
    yield result
    for name in ("admin", "staff", "pharmacist"):
        result[name].close()
    if engine:
        engine.dispose()


def test_clerk_permission_and_publication_roundtrip(clients):
    admin, staff = clients["admin"], clients["staff"]
    data = clerical_snapshot()
    for person in data.people:
        created = admin.post(
            "/planning/compliance/records/person" + SCOPE,
            json={
                "payload": person.model_dump(mode="json"),
                "expected_revision": 0,
                "idempotency_key": "create-person-" + person.person_id,
            },
        )
        assert created.status_code == 200, created.text
    linked = admin.post(
        "/planning/memberships" + SCOPE,
        json={
            "issuer": "mock",
            "subject": "staff",
            "person_id": "p0",
            "role": "STAFF",
            "expected_version": 0,
            "evidence": {
                "reason": "Synthetic clerical employee",
                "reference": "multirole-test",
            },
            "idempotency_key": "link-clerical-staff",
        },
    )
    assert linked.status_code == 200, linked.text
    assert staff.get("/auth/me").json()["global_role"] == "STAFF"
    context = staff.get("/planning/staff-context" + SCOPE)
    assert context.status_code == 200, context.text
    assert context.json() == {
        "person_id": "p0",
        "permission": "STAFF",
        "occupation": "CLERK",
        "occupation_status": "recorded",
    }
    assert (
        staff.get("/planning/staff-context?scope_id=other/pharmacy").status_code == 403
    )
    revision = admin.get("/planning/scopes").json()[0]["input_revision"]
    saved = admin.post(
        "/planning/inputs",
        json={"snapshot": data.model_dump(mode="json"), "expected_revision": revision},
    )
    assert saved.status_code == 200, saved.text
    assert (
        staff.post(
            "/planning/inputs",
            json={"snapshot": data.model_dump(mode="json"), "expected_revision": 1},
        ).status_code
        == 403
    )
    request = staff.post(
        "/planning/requests" + SCOPE,
        json={
            "start": "2026-01-05T14:00:00+09:00",
            "end": "2026-01-05T15:00:00+09:00",
            "kind": "PUBLIC_HOLIDAY_REQUEST",
            "idempotency_key": "clerical-holiday-test",
        },
    )
    assert request.status_code == 201, request.text
    revision = admin.get("/planning/inputs/latest" + SCOPE).json()["input_revision"]
    refreshed = admin.post(
        "/planning/inputs/refresh" + SCOPE,
        json={"expected_revision": revision, "input_hash": data.input_hash},
    )
    assert refreshed.status_code == 200, refreshed.text
    latest = admin.get("/planning/inputs/latest" + SCOPE).json()
    data = SolverSnapshot.model_validate(latest["snapshot"])
    assert any(
        p.request_id == request.json()["request_id"] and p.person_id == "p0"
        for p in data.preferences
    )
    job = admin.post(
        "/planning/jobs" + SCOPE,
        json={
            "input_hash": data.input_hash,
            "budget_seconds": 5,
            "idempotency_key": "clerical-generate-test",
        },
    )
    assert job.status_code == 202, job.text
    assert run_once(clients["factory"])
    completed = admin.get("/planning/jobs/" + job.json()["job_id"] + SCOPE).json()
    assert completed["status"] == "OPTIMAL", completed
    draft_id = completed["result"]["draft_id"]
    assert (
        staff.post(
            f"/planning/drafts/{draft_id}/review" + SCOPE,
            json={"version": 1, "idempotency_key": "staff-review-denied"},
        ).status_code
        == 403
    )
    review = admin.post(
        f"/planning/drafts/{draft_id}/review" + SCOPE,
        json={"version": 1, "idempotency_key": "clerical-review-test"},
    )
    assert review.status_code == 200, review.text
    published = admin.post(
        f"/planning/drafts/{draft_id}/publish" + SCOPE,
        json={
            "version": 1,
            "expected_publication_version": 0,
            "input_hash": data.input_hash,
            "review_hash": review.json()["review_hash"],
            "idempotency_key": "clerical-publish-test",
        },
    )
    assert published.status_code == 200, published.text
    personal = staff.get("/planning/publications" + SCOPE)
    assert personal.status_code == 200, personal.text
    assignments = personal.json()[0]["assignments"]
    department = {
        d["person_id"]
        for d in admin.get("/planning/publications" + SCOPE).json()[0]["assignments"]
    }
    assert {"p0", "p2"} <= department and department & {"p1", "p3"}
    assert (
        len(assignments) == 1
        and assignments[0]["person_id"] == "p0"
        and assignments[0]["task"] == "reception"
    )
    assert all(
        row["person_id"] == "p0"
        for row in staff.get("/planning/requests" + SCOPE).json()
    )
    # Department permission, not occupation or the global login-role label, governs management.
    elevated = admin.post(
        "/planning/memberships" + SCOPE,
        json={
            "issuer": "mock",
            "subject": "staff",
            "person_id": "p0",
            "role": "LEADER",
            "expected_version": 1,
            "evidence": {
                "reason": "Synthetic scoped responsibility",
                "reference": "multirole-test",
            },
            "idempotency_key": "clerical-leader-permission",
        },
    )
    assert elevated.status_code == 200, elevated.text
    assert staff.get("/planning/staff-context" + SCOPE).json()["occupation"] == "CLERK"
    assert staff.get("/planning/inputs/latest" + SCOPE).status_code == 200
    pharmacist = clients["pharmacist"]
    linked_pharmacist = admin.post(
        "/planning/memberships" + SCOPE,
        json={
            "issuer": "mock",
            "subject": "pharmacist",
            "person_id": "p1",
            "role": "STAFF",
            "expected_version": 0,
            "evidence": {
                "reason": "Synthetic self-service pharmacist",
                "reference": "multirole-test",
            },
            "idempotency_key": "pharmacist-staff-permission",
        },
    )
    assert linked_pharmacist.status_code == 200, linked_pharmacist.text
    assert (
        pharmacist.get("/planning/staff-context" + SCOPE).json()["occupation"]
        == "PHARMACIST"
    )
    assert pharmacist.get("/planning/inputs/latest" + SCOPE).status_code == 403
    current = admin.get("/planning/inputs/latest" + SCOPE).json()
    refreshed = admin.post(
        "/planning/inputs/refresh" + SCOPE,
        json={
            "expected_revision": current["input_revision"],
            "input_hash": current["input_hash"],
        },
    )
    assert refreshed.status_code == 200, refreshed.text
    data = SolverSnapshot.model_validate(
        admin.get("/planning/inputs/latest" + SCOPE).json()["snapshot"]
    )
    second = admin.post(
        "/planning/drafts" + SCOPE,
        json={
            "input_hash": data.input_hash,
            "proposal": {"duty_ids": [d.duty_id for d in data.candidates]},
            "idempotency_key": "second-draft-before-occupation-change",
        },
    )
    assert second.status_code == 201, second.text
    second_id = second.json()["draft_id"]
    assert second_id != draft_id
    second_review = admin.post(
        f"/planning/drafts/{second_id}/review" + SCOPE,
        json={"version": 1, "idempotency_key": "clerical-second-review"},
    )
    assert second_review.status_code == 200, second_review.text
    changed = admin.post(
        "/planning/compliance/records/person" + SCOPE,
        json={
            "payload": {
                "person_id": "p0",
                "name": "Person 0",
                "occupation": "ASSISTANT",
            },
            "expected_revision": 1,
            "idempotency_key": "change-clerk-occupation",
        },
    )
    assert changed.status_code == 200, changed.text
    stale = admin.post(
        f"/planning/drafts/{second_id}/publish" + SCOPE,
        json={
            "version": 1,
            "expected_publication_version": 1,
            "input_hash": data.input_hash,
            "review_hash": second_review.json()["review_hash"],
            "idempotency_key": "reject-old-clerk-review",
        },
    )
    assert stale.status_code == 409, stale.text
    assert (
        stale.json()["detail"]
        == "Input, version or ledger conflict; refresh and review again"
    )
