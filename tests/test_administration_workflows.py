"""Public API recovery, original preservation, and qualification revocation bypasses."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.application import compliance
from shift_scheduler.application.planning import Conflict, register_input
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningRequest,
)
from shift_scheduler.domain.planning import content_hash
from tests.test_compliance_api import BASE, QUERY, token


def exercise(factory):
    data = snapshot()
    scope = "hospital/pharmacy"
    with factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p0",
                scope_id=scope,
                role="ADMIN",
                active=True,
            )
        )
        register_input(s, data, "fixture", 0)
    cap = data.capabilities[0]
    original = cap.model_dump(mode="json")
    identity = content_hash(original)
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)

        def write(kind, payload, key, version=0):
            return client.post(
                BASE + "/records/" + kind + QUERY,
                headers=auth,
                json={
                    "payload": payload,
                    "expected_revision": version,
                    "idempotency_key": key,
                    **({"input_hash": data.input_hash} if kind == "demand" else {}),
                },
            )

        employer = {
            "employer_id": "new-employer",
            "name": "合成病院",
            "evidence": cap.evidence.model_dump(mode="json"),
        }
        assert write("employer", employer, "new-employer-key").status_code == 200
        context = client.get(BASE + "/workflow-context" + QUERY, headers=auth)
        assert context.status_code == 200, context.text
        assert context.json()["employers"] == [employer]
        demand = data.demands[0].model_dump(mode="json")
        demand["target"] += 1
        current = client.get(BASE + "/records" + QUERY, headers=auth).json()
        revision = next(
            r["revision"]
            for r in current
            if r["kind"] == "demand" and r["entity_id"] == demand["demand_id"]
        )
        response = write("demand", demand, "demand-update-key", revision)
        assert response.status_code == 200, response.text
        assert (
            write("demand", demand, "demand-update-key", revision).json()
            == response.json()
        )
        assert write("demand", demand, "demand-stale-key", revision).status_code == 409
        with factory.begin() as session:
            session.add(
                AccountMembership(
                    membership_id="staff",
                    issuer="mock",
                    subject="pharmacist",
                    person_id="p1",
                    scope_id=scope,
                    role="PHARMACIST",
                    active=True,
                )
            )
        staff = token(client, "pharmacist")
        context = client.get(BASE + "/declaration-context" + QUERY, headers=staff)
        assert context.status_code == 200, context.text
        assert context.json()["person_id"] == "p1"
        assert (
            not {"people", "employments", "actuals", "contracts"}
            & context.json().keys()
        )
        assert (
            client.get(BASE + "/workflow-context" + QUERY, headers=staff).status_code
            == 403
        )
        own_ledger = client.get(BASE + "/leave-report" + QUERY, headers=staff)
        assert own_ledger.status_code == 200, own_ledger.text
        assert own_ledger.json()["display_metadata_as_of"] == "current_directory"
        assert all(
            row["person_id"] == "p1"
            for kind in ("balances", "obligations")
            for row in own_ledger.json()[kind]
        )
        assert all(
            row["person_name"]
            == next(p.name for p in data.people if p.person_id == "p1")
            for kind in ("balances", "obligations")
            for row in own_ledger.json()[kind]
        )
        assert "people" not in own_ledger.json()
        assert (
            client.post(
                BASE + "/records/demand" + QUERY,
                headers=staff,
                json={
                    "payload": demand,
                    "expected_revision": revision + 1,
                    "idempotency_key": "staff-demand-forbidden",
                },
            ).status_code
            == 403
        )
        auth = token(client)
        event = {
            "amendment_id": "qualification-end",
            "person_id": cap.person_id,
            "target_hash": identity,
            "effective_at": (cap.end - timedelta(days=1)).isoformat(),
            "reason": "synthetic expiry correction",
            "evidence": employer["evidence"],
        }
        first = write("capability_amendment", event, "qualification-key")
        assert first.status_code == 200, first.text
        assert (
            write("capability_amendment", event, "qualification-key").json()
            == first.json()
        )
        with factory.begin() as s:
            raw = data.model_dump(mode="json")
            projected = compliance.overlay(s, scope, raw)
            assert len(projected["capabilities"]) == len(raw["capabilities"])
            assert compliance.overlay(s, scope, projected) == projected
            assert s.get(PlanningInput, data.input_hash).payload == raw
            with pytest.raises(Conflict, match="qualification"):
                compliance.register_snapshot(s, data, "fixture")
        request = {
            "start": "2026-01-06T09:00:00+09:00",
            "end": "2026-01-06T13:00:00+09:00",
            "kind": "PUBLIC_HOLIDAY_REQUEST",
            "idempotency_key": "staff-request-key",
        }
        first = client.post("/planning/requests" + QUERY, headers=auth, json=request)
        assert first.status_code == 201, first.text
        assert (
            client.post("/planning/requests" + QUERY, headers=auth, json=request).json()
            == first.json()
        )
        path = "/planning/requests/" + first.json()["request_id"]
        decision = {
            "version": 1,
            "approved": True,
            "reference": "synthetic decision",
            "idempotency_key": "decision-key",
        }
        response = client.post(path + "/decision" + QUERY, headers=auth, json=decision)
        assert response.status_code == 200, response.text
        assert (
            client.post(path + "/decision" + QUERY, headers=auth, json=decision).json()
            == response.json()
        )
        assert (
            client.post(
                path + "/decision" + QUERY,
                headers=auth,
                json={**decision, "approved": False},
            ).status_code
            == 409
        )
        withdrawal = {"version": 2, "idempotency_key": "withdrawal-key"}
        response = client.post(
            path + "/withdraw" + QUERY, headers=auth, json=withdrawal
        )
        assert response.status_code == 200, response.text
        assert (
            client.post(
                path + "/withdraw" + QUERY, headers=auth, json=withdrawal
            ).json()
            == response.json()
        )
        with factory() as s:
            rows = list(s.scalars(select(PlanningRequest)))
            assert len(rows) == 1 and rows[0].version == 3


def test_administrative_actions(sqlite_session_factory):
    exercise(sqlite_session_factory)


def test_administrative_actions_postgres(pg, monkeypatch):
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    exercise(pg)


def test_demand_period_identity_and_overlay(sqlite_session_factory):
    from datetime import datetime, timedelta

    data = snapshot()
    scope = "hospital/pharmacy"
    original = data.model_dump(mode="json")
    period = original["period"]
    next_period = {
        k: (datetime.fromisoformat(v) + timedelta(days=31)).isoformat()
        for k, v in period.items()
    }
    demand = original["demands"][0]
    shifted = {
        **demand,
        **{
            k: (datetime.fromisoformat(demand[k]) + timedelta(days=31)).isoformat()
            for k in ("start", "end")
        },
    }
    with sqlite_session_factory.begin() as s:
        register_input(s, data, "fixture", 0)
        row = compliance.save_entity(
            s, scope, "demand", shifted, 0, "admin", demand_period=next_period
        )
        assert row.entity_id == compliance.demand_identity(
            next_period, demand["demand_id"]
        )
        assert compliance.overlay(s, scope, original)["demands"] == original["demands"]
        future = {**original, "period": next_period, "demands": [shifted]}
        assert compliance.overlay(s, scope, future)["demands"] == [shifted]
        with pytest.raises(ValueError, match="period"):
            compliance.save_entity(s, scope, "demand", shifted, 0, "admin")
