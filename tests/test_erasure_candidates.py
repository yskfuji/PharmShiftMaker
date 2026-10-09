"""The listing of planning inputs says what the erasure routes really do with each one.

`erasable` (GET /erasure-candidates and POST /erasure-preview) is compared with the
outcome of POST /erasure-execute for every input, not with a rule written here.
Synthetic data only.
"""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.application.privacy import save_rule
from shift_scheduler.db.compliance_models import (
    ErasureMarker,
    LegalHold,
    PrivacyCase,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningInput
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_compliance_api import BASE, QUERY, prepare
from tests.test_compliance_v2 import v2

SCOPE = "hospital/pharmacy"
PASSWORDS = {"admin": "pass-admin", "leader": "pass-lead", "pharmacist": "pass-ph"}
PREVIEW_KEYS = {
    "plan_id",
    "fingerprint",
    "input_hash",
    "scope_id",
    "rule_key",
    "targets",
    "blockers",
    "irreversible",
    "limitations",
}


def login(client, who):
    client.cookies.clear()
    response = client.post(
        "/auth/login", json={"username": who, "password": PASSWORDS[who]}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def seed(factory, *, rule=True, hold=False):
    """The registered input, a newer version that supersedes it, and a leader."""
    prepare(factory)
    data = v2()
    with factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="leader",
                issuer="mock",
                subject="leader",
                person_id="p1",
                scope_id=SCOPE,
                role="LEADER",
                active=True,
            )
        )
        register_input(
            session, data.model_copy(update={"source_revision": 1}), "admin", 1
        )
        if rule:
            save_rule(
                session,
                SCOPE,
                RetentionPolicy(
                    category="planning_history",
                    purpose="synthetic expired data only",
                    anchor="period_end",
                    retention_days=1,
                    legal_minimum_days=1,
                    effective_from="2026-01-01",
                    effective_until="2099-01-01",
                    evidence=data.policy_evidence,
                    owner="test",
                    next_review="2098-12-31",
                ),
                0,
                "admin",
            )
        if hold:
            session.add(
                LegalHold(
                    hold_id="hold",
                    scope_id=SCOPE,
                    person_id=None,
                    active=True,
                    revision=1,
                    payload={"reason": "synthetic"},
                )
            )
    return data


def candidates(client, headers):
    response = client.get(BASE + "/erasure-candidates" + QUERY, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def post(client, headers, path, key, payload):
    return client.post(
        BASE + path + QUERY,
        headers=headers,
        json={"expected_revision": 0, "idempotency_key": key, "payload": payload},
    )


@pytest.mark.parametrize(
    ("rule", "hold", "erased"),
    [(True, False, 1), (False, False, 0), (True, True, 0)],
)
def test_erasable_is_what_execute_does_for_every_input(
    sqlite_session_factory, rule, hold, erased
):
    data = seed(sqlite_session_factory, rule=rule, hold=hold)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        listed = candidates(client, admin)["inputs"]
        # Both versions are listed, the newer first; the listing records nothing.
        assert [row["input_revision"] for row in listed] == [2, 1]
        assert listed[1]["input_hash"] == data.input_hash
        assert candidates(client, admin)["inputs"] == listed
        done = []
        for row in listed:
            assert set(row) == {
                "input_hash",
                "input_revision",
                "period",
                "registered_at",
                "erasable",
                "blockers",
                "target_count",
            }
            previewed = post(
                client,
                admin,
                "/erasure-preview",
                "preview-" + row["input_hash"][:16],
                {"input_hash": row["input_hash"]},
            )
            assert previewed.status_code == 200, previewed.text
            plan = previewed.json()
            assert set(plan) == PREVIEW_KEYS | {"erasable"}
            assert plan["erasable"] is row["erasable"]
            assert plan["blockers"] == row["blockers"]
            assert len(plan["targets"]) == row["target_count"]
            executed = post(
                client,
                admin,
                "/erasure-execute",
                "execute-" + row["input_hash"][:16],
                {"plan_id": plan["plan_id"], "fingerprint": plan["fingerprint"]},
            )
            assert executed.status_code in (200, 409), executed.text
            assert (executed.status_code == 200) is row["erasable"], row
            if executed.status_code == 200:
                assert executed.json()["deleted"] == row["target_count"]
                done.append(row["input_hash"])
        # The current version is never erasable; the superseded one only when the
        # rule is verified, its retention has passed and no hold applies.
        assert listed[0]["erasable"] is False
        assert len(done) == erased
        remaining = [row["input_hash"] for row in candidates(client, admin)["inputs"]]
        assert remaining == [
            row["input_hash"] for row in listed if row["input_hash"] not in done
        ]
        for input_hash in done:
            gone = client.get(
                "/planning/inputs/latest" + QUERY + "&input_hash=" + input_hash,
                headers=admin,
            )
            assert gone.status_code == 404, gone.text
    with sqlite_session_factory() as session:
        for input_hash in done:
            assert session.get(PlanningInput, input_hash) is None
        # One tombstone per erased row: the input itself and what referred to it.
        markers = session.query(ErasureMarker).all()
        assert len(markers) == sum(
            row["target_count"] for row in listed if row["input_hash"] in done
        )
        assert {
            m.object_key for m in markers if m.table_name == "planning_inputs"
        } == set(done)


def test_only_an_administrator_reads_and_erases(sqlite_session_factory):
    data = seed(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        plan = post(
            client,
            admin,
            "/erasure-preview",
            "preview-admin",
            {"input_hash": data.input_hash},
        ).json()
        assert plan["erasable"] is True
        for who in ("leader", "pharmacist"):
            headers = login(client, who)
            path = BASE + "/erasure-candidates" + QUERY
            assert client.get(path, headers=headers).status_code == 403
            assert (
                post(
                    client,
                    headers,
                    "/erasure-preview",
                    "preview-" + who,
                    {"input_hash": data.input_hash},
                ).status_code
                == 403
            )
            assert (
                post(
                    client,
                    headers,
                    "/erasure-execute",
                    "execute-" + who,
                    {"plan_id": plan["plan_id"], "fingerprint": plan["fingerprint"]},
                ).status_code
                == 403
            )
    with sqlite_session_factory() as session:
        assert session.get(PlanningInput, data.input_hash) is not None


def test_the_listing_stays_readable_under_an_approved_use_restriction(
    sqlite_session_factory,
):
    seed(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(
            PrivacyCase(
                case_id="restriction",
                scope_id=SCOPE,
                person_id="p0",
                kind="restrict",
                status="APPROVED",
                revision=3,
                payload={"person_id": "p0", "kind": "restrict", "reason": "合成"},
            )
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        assert client.get("/planning/inputs" + QUERY, headers=admin).status_code == 423
        assert len(candidates(client, admin)["inputs"]) == 2
