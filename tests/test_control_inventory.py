from shift_scheduler.application.copy_graph import control_inventory
from shift_scheduler.db.compliance_models import (
    CopyErasure,
    ErasedSubject,
    ErasureMarker,
    LegalHold,
)


def test_control_subjects_and_references_remain_visible(sqlite_session_factory):
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                ErasedSubject(
                    facility_id="hospital",
                    person_id="p0",
                    plan_id="plan-a",
                    evidence={"reference": "synthetic"},
                ),
                ErasedSubject(
                    facility_id="hospital",
                    person_id="p1",
                    plan_id="plan-b",
                    evidence={"reference": "synthetic"},
                ),
                LegalHold(
                    hold_id="common",
                    scope_id="hospital/pharmacy",
                    person_id=None,
                    active=True,
                    revision=1,
                    payload={},
                ),
                LegalHold(
                    hold_id="other-facility",
                    scope_id="elsewhere/pharmacy",
                    person_id="p0",
                    active=True,
                    revision=1,
                    payload={},
                ),
                CopyErasure(
                    plan_id="plan-a",
                    scope_id="hospital/pharmacy",
                    person_id="p0",
                    fingerprint="a" * 64,
                    payload={},
                    state="PARTIAL",
                    revision=1,
                ),
                ErasureMarker(
                    marker_id="marker",
                    plan_id="plan-a",
                    scope_id="hospital/pharmacy",
                    table_name="example",
                    object_key="key",
                    prior_hash="a" * 64,
                ),
            ]
        )
    with sqlite_session_factory() as session:
        rows = control_inventory(session, "hospital/pharmacy", "p0")
        assert sum(r["table"] == "erased_subjects" for r in rows) == 1
        assert sum(r["table"] == "legal_holds" for r in rows) == 1
        assert (
            next(r for r in rows if r["table"] == "erasure_markers")["subject_relation"]
            == "plan_reference"
        )
        assert all(
            r["state"] == "RETAINED_CONTROL" and r["retention_status"] == "RULE_MISSING"
            for r in rows
        )


def test_control_retention_is_registerable_but_never_automatically_erases_barriers(
    sqlite_session_factory,
):
    from fastapi.testclient import TestClient

    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(
            ErasedSubject(
                facility_id="hospital",
                person_id="p0",
                plan_id="plan-control",
                evidence={},
            )
        )
    rule = {
        "category": "control",
        "purpose": "再作成防止と復元照合",
        "anchor": "last_activity",
        "retention_days": 30,
        "legal_minimum_days": 0,
        "effective_from": "2020-01-01",
        "effective_until": "2040-01-01",
        "owner": "synthetic custodian",
        "next_review": "2030-01-01",
        "evidence": {
            "reference": "synthetic reviewed policy",
            "status": "verified",
            "verified_by": "reviewer",
        },
    }
    body = {
        "payload": rule,
        "expected_revision": 0,
        "idempotency_key": "control-policy",
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        result = client.post(
            BASE + "/retention-rules" + QUERY, headers=admin, json=body
        )
        assert result.status_code == 200, result.text
        assert (
            client.post(
                BASE + "/retention-rules" + QUERY, headers=admin, json=body
            ).json()
            == result.json()
        )
        stale = {**body, "idempotency_key": "control-stale"}
        assert (
            client.post(
                BASE + "/retention-rules" + QUERY, headers=admin, json=stale
            ).status_code
            == 409
        )
        staff = token(client, "pharmacist")
        assert (
            client.post(
                BASE + "/retention-rules" + QUERY, headers=staff, json=body
            ).status_code
            == 403
        )
    with sqlite_session_factory() as session:
        rows = control_inventory(session, "hospital/pharmacy", "p0")
        barrier = next(r for r in rows if r["table"] == "erased_subjects")
        assert barrier["state"] == "RETAINED_CONTROL"
        assert barrier["retention_status"] == "RULE_REQUIRES_APPLICABILITY_REVIEW"
        assert barrier["rule_references"][0]["revision"] == 1
        assert session.get(ErasedSubject, ("hospital", "p0")) is not None


def test_control_actor_uses_the_record_scope_not_the_inventory_view_scope(
    sqlite_session_factory,
):
    from shift_scheduler.db.planning_models import AccountMembership

    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                AccountMembership(
                    membership_id="a",
                    issuer="mock",
                    subject="reviewer",
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                ),
                AccountMembership(
                    membership_id="b",
                    issuer="mock",
                    subject="reviewer",
                    person_id="p1",
                    scope_id="hospital/other",
                    role="ADMIN",
                    active=True,
                ),
                LegalHold(
                    hold_id="scoped",
                    scope_id="hospital/other",
                    person_id="p2",
                    active=True,
                    revision=1,
                    payload={"reviewed_by": "reviewer"},
                ),
            ]
        )
    with sqlite_session_factory() as session:
        assert not control_inventory(session, "hospital/pharmacy", "p0")
        rows = control_inventory(session, "hospital/pharmacy", "p1")
        assert len(rows) == 1 and rows[0]["table"] == "legal_holds"
