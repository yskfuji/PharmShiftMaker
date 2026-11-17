"""The ideal-UI browser acceptance flow (frontend/tests/remediation-e2e/
ideal-workspace.spec.ts), proved at the API on the same synthetic fixture and accounts as
scripts/remediation_test_server.py with PHARMSHIFT_E2E_PUBLICATION=1: consent on, an
absence covered by the pharmacist, consent, approval, a refusal and a withdrawal."""

from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shift_scheduler.api.main import app
from shift_scheduler.api.routers import planning as planning_router
from shift_scheduler.application import planning, rule_impact
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import AccountMembership
from shift_scheduler.optimizer.planning import solve

SCOPE = "?scope_id=hospital%2Fpharmacy"
EVIDENCE = {"reason": "合成の受入", "reference": "E2E-1"}


def initial(db, data):
    """Accounts, input and the first publication, as scripts/remediation_test_server.py."""
    with db.begin() as session:
        for subject, person, role in (
            ("admin", "p0", "ADMIN"),
            ("pharmacist", "p1", "PHARMACIST"),
            ("leader", "p0", "LEADER"),
            ("developer", "p-reviewer", "ADMIN"),
        ):
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
        planning.register_input(session, data, "fixture", 0)
        source = planning.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = planning.new_draft(session, source, solve(data, 10).proposal, "admin")
        session.flush()
        review = planning.review_draft(
            session, draft.draft_id, "hospital/pharmacy", 1, "admin"
        )
        planning.publish(
            session,
            draft.draft_id,
            "hospital/pharmacy",
            "admin",
            1,
            0,
            data.input_hash,
            review["review_hash"],
            "synthetic-export-publication",
        )


@pytest.fixture
def server(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'e2e.db'}")
    Base.metadata.create_all(engine)
    db = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(planning_router, "get_session_factory", lambda: db)
    data = snapshot()
    # As in the server's worker process, "today" is the real date: the approval later in
    # the flow publishes without moving the rule-review clock. Only the initial publication
    # below runs with the parent process's clock, as the server does.
    with monkeypatch.context() as clock:
        clock.setattr(rule_impact, "today", lambda _tz: data.period.start.date())
        initial(db, data)
    clients = {}
    for name, password in (
        ("admin", "pass-admin"),
        ("leader", "pass-lead"),
        ("pharmacist", "pass-ph"),
        ("developer", "pass-dev"),
    ):
        client = TestClient(app, headers={"Origin": "https://localhost:3000"})
        assert (
            client.post(
                "/auth/login", json={"username": name, "password": password}
            ).status_code
            == 200
        )
        clients[name] = client
    return clients


def case_action(client, case, action, key):
    response = client.post(
        f"/planning/change-cases/{case['case_id']}/{action}" + SCOPE,
        json={
            "expected_version": case["version"],
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_browser_flow_holds_at_the_api(server):
    admin, leader, pharmacist, reviewer = (
        server["admin"],
        server["leader"],
        server["pharmacist"],
        server["developer"],
    )
    switched = admin.post(
        "/planning/scope-settings/absence-consent" + SCOPE,
        json={
            "enabled": True,
            "evidence": EVIDENCE,
            "expected_version": 0,
            "idempotency_key": "e2e-switch-01",
        },
    )
    assert switched.status_code == 200, switched.text
    publication = leader.get("/planning/publications" + SCOPE).json()[0]
    first = next(d for d in publication["assignments"] if d["person_id"] == "p0")
    options = leader.get(
        "/planning/change-cases/options"
        + SCOPE
        + f"&publication_id={publication['publication_id']}&duty_id={first['duty_id']}&kind=ABSENCE"
    ).json()
    cover = next(o for o in options["options"] if o["counterpart"]["person_id"] == "p1")
    assert cover["publishable"]
    created = leader.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": publication["publication_id"],
            "kind": "ABSENCE",
            "affected_assignment_ids": cover["affected_assignment_ids"],
            "proposed_assignment_ids": cover["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "e2e-case-0001",
        },
    ).json()
    assert created["status"] == "AWAITING_CONSENT"
    agreed = case_action(pharmacist, created, "consent", "e2e-consent-1")
    assert agreed["status"] == "READY"
    recommended = case_action(leader, agreed, "recommend", "e2e-recommend-1")
    assert recommended["status"] == "AWAITING_INDEPENDENT_APPROVAL"
    approved = reviewer.post(
        f"/planning/change-cases/{created['case_id']}/approve" + SCOPE,
        json={
            "expected_version": recommended["version"],
            "expected_publication_version": publication["version"],
            "evidence": EVIDENCE,
            "idempotency_key": "e2e-approve-1",
        },
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["version"] == publication["version"] + 1
    # the pharmacist now has the duty and asks p0 (the leader's person) to cover it back
    current = pharmacist.get("/planning/publications" + SCOPE).json()[0]
    own = current["assignments"][0]
    assert own["person_id"] == "p1"
    back = pharmacist.get(
        "/planning/change-cases/options"
        + SCOPE
        + f"&publication_id={current['publication_id']}&duty_id={own['duty_id']}&kind=ABSENCE"
    ).json()["options"][0]
    asked = pharmacist.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": current["publication_id"],
            "kind": "ABSENCE",
            "affected_assignment_ids": back["affected_assignment_ids"],
            "proposed_assignment_ids": back["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "e2e-case-0002",
        },
    ).json()
    assert asked["status"] == "AWAITING_CONSENT"
    full = leader.get(f"/planning/change-cases/{asked['case_id']}" + SCOPE).json()
    assert case_action(leader, full, "decline", "e2e-decline-1")["status"] == "DECLINED"
    again = pharmacist.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": current["publication_id"],
            "kind": "ABSENCE",
            "affected_assignment_ids": back["affected_assignment_ids"],
            "proposed_assignment_ids": back["proposed_assignment_ids"],
            "evidence": EVIDENCE,
            "idempotency_key": "e2e-case-0003",
        },
    ).json()
    assert (
        case_action(pharmacist, again, "withdraw", "e2e-withdraw-1")["status"]
        == "WITHDRAWN"
    )
    timeline = admin.get("/planning/audit-timeline" + SCOPE + "&limit=200").json()
    kinds = [e["kind"] for e in timeline["entries"]]
    for kind in (
        "change.absence.created",
        "change.absence.consented",
        "change.recommended",
        "change.approved",
        "change.absence.declined",
        "change.withdrawn",
        "compliance.scope_setting",
    ):
        assert kind in kinds
    assert not re.findall(
        r"(?<![A-Za-z0-9_])p[0-9]+(?![A-Za-z0-9_])", json.dumps(timeline)
    )
