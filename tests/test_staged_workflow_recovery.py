"""A cross-record inconsistency must block calculation, not the repair controls."""

from copy import deepcopy

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_api import BASE, QUERY, token


def exercise(factory):
    data = snapshot()
    with factory.begin() as session:
        session.add(
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
        register_input(session, data, "fixture", 0)
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        from shift_scheduler.domain.compliance_v3 import AgreementV3

        site = data.establishments[0]
        source = AgreementV3(
            agreement_id="repair-agreement",
            employer_id=site.employer_id,
            establishment_id=site.establishment_id,
            start=site.start,
            end=site.end,
            year_start=data.period.start.date(),
            month_anchor=data.period.start.date(),
            daily_limit_seconds=28800,
            monthly_limit_seconds=162000,
            annual_limit_seconds=1296000,
            evidence=site.evidence,
        ).model_dump(mode="json")
        broken = deepcopy(source)
        broken["start"] = "2034-09-01T00:00:00+09:00"
        broken["end"] = "2034-10-01T00:00:00+09:00"
        saved = client.post(
            BASE + "/records/agreement" + QUERY,
            headers=auth,
            json={
                "expected_revision": 0,
                "idempotency_key": "staging-invalid-agreement",
                "payload": broken,
            },
        )
        assert saved.status_code == 200, saved.text
        read = client.get(BASE + "/records" + QUERY, headers=auth)
        assert read.status_code == 200 and any(
            r["payload"] == broken for r in read.json()
        )
        context = client.get(BASE + "/workflow-context" + QUERY, headers=auth)
        assert context.status_code == 200, context.text
        assert context.json()["staging_valid"] is False
        assert context.json()["validation_issues"]
        assert "input" not in context.json()["validation_issues"][0]
        # A readable edit projection must never relax the validated input boundary.
        refused = client.post(
            "/planning/inputs/refresh" + QUERY,
            headers=auth,
            json={"expected_revision": 1, "input_hash": data.input_hash},
        )
        assert refused.status_code == 422, refused.text
        fixed = client.post(
            BASE + "/records/agreement" + QUERY,
            headers=auth,
            json={
                "expected_revision": 1,
                "idempotency_key": "staging-repaired-agreement",
                "payload": source,
            },
        )
        assert fixed.status_code == 200, fixed.text
        context = client.get(BASE + "/workflow-context" + QUERY, headers=auth)
        assert context.status_code == 200 and context.json()["staging_valid"] is True
        refreshed = client.post(
            "/planning/inputs/refresh" + QUERY,
            headers=auth,
            json={"expected_revision": 1, "input_hash": data.input_hash},
        )
        assert refreshed.status_code == 200, refreshed.text


def test_inconsistent_staged_records_remain_editable(sqlite_session_factory):
    exercise(sqlite_session_factory)


def test_staged_repair_on_postgres(pg, monkeypatch):
    import shift_scheduler.db.session as db

    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    exercise(pg)
