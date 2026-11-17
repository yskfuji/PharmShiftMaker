"""V3 HTTP boundaries use independent identity, replay and malformed-input probes."""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningInputHead,
)
from shift_scheduler.domain.compliance import parse_snapshot
from tests.test_compliance_api import BASE, QUERY, token


def prepare(factory, data=None):
    with factory.begin() as session:
        for subject, person, role in [
            ("admin", "p0", "ADMIN"),
            ("pharmacist", "p1", "PHARMACIST"),
        ]:
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
        register_input(session, data or snapshot(), "fixture", 0)


def test_privacy_roster_is_exact_scope_and_self_limited(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        other = snapshot().model_dump(mode="json")
        other["department_id"] = "ward"
        for contract in other["contracts"]:
            contract["department_id"] = "ward"
        other["people"].append({"person_id": "p-ward-only", "name": "別部署の合成職員"})
        register_input(session, parse_snapshot(other), "fixture-other-scope", 0)

    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        admin_response = client.get(BASE + "/privacy" + QUERY, headers=admin)
        assert admin_response.status_code == 200, admin_response.text
        admin_people = admin_response.json()["people"]
        assert {row["person_id"] for row in admin_people} == {"p0", "p1"}
        assert "別部署の合成職員" not in {row["name"] for row in admin_people}

        staff = token(client, "pharmacist")
        staff_response = client.get(BASE + "/privacy" + QUERY, headers=staff)
        assert staff_response.status_code == 200, staff_response.text
        assert staff_response.json()["people"] == [
            {"person_id": "p1", "name": "合成職員・長い氏名・薬剤部の画面評価"}
        ]


def test_privacy_roster_uses_newest_input_name_deterministically(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        for revision, marker, name in [
            (2, "a", "過去期間の合成氏名"),
            (3, "b", "最新期間の合成氏名"),
        ]:
            input_hash = marker * 64
            session.add(
                PlanningInput(
                    input_hash=input_hash,
                    scope_id="hospital/pharmacy",
                    input_revision=revision,
                    payload={"people": [{"person_id": "p-history", "name": name}]},
                    created_by="fixture-name-order",
                )
            )
            session.add(
                PlanningInputHead(
                    key=f"fixture-name-{marker}",
                    scope_id="hospital/pharmacy",
                    input_hash=input_hash,
                )
            )

    with TestClient(app, base_url="https://localhost:8000") as client:
        response = client.get(BASE + "/privacy" + QUERY, headers=token(client))
        assert response.status_code == 200, response.text
        names = {row["person_id"]: row["name"] for row in response.json()["people"]}
        assert names["p-history"] == "最新期間の合成氏名"


def test_copy_malformed_requests_are_rejected_without_server_error(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        for operation in ["register", "preview", "execute"]:
            response = client.post(
                BASE + "/copies/" + operation + QUERY,
                headers=admin,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "malformed-" + operation,
                    "payload": {},
                },
            )
            assert response.status_code == 422, response.text
        staff = token(client, "pharmacist")
        assert (
            client.get(
                BASE + "/copies" + QUERY + "&person_id=p0", headers=staff
            ).status_code
            == 403
        )


def test_v3_input_can_be_imported_via_public_api(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        data = snapshot().model_copy(update={"source_revision": 2})
        response = client.post(
            "/planning/inputs",
            headers=admin,
            json={"expected_revision": 1, "snapshot": data.model_dump(mode="json")},
        )
        assert response.status_code == 200, response.text[:2000]
        latest = client.get("/planning/inputs/latest" + QUERY, headers=admin)
        assert latest.status_code == 200, latest.text[:2000]
        assert latest.json()["snapshot"]["schema_version"] == 3


def test_grant_amendment_is_immutable_replayable_and_time_scoped(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    data = snapshot()
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        payload = {
            "amendment_id": "correction-1",
            "person_id": "p0",
            "account_id": "g0",
            "external_event_id": "hr:g0",
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": "2026-01-01",
            "recorded_at": "2026-02-01T00:00:00+09:00",
            "granted_days": 3,
            "statutory_days": 3,
            "reason": "synthetic HR reconciliation",
            "evidence": data.policy_evidence.model_dump(mode="json"),
        }
        request = {
            "expected_revision": 0,
            "idempotency_key": "grant-correction-1",
            "payload": payload,
        }
        response = client.post(
            BASE + "/grant-amendments" + QUERY, headers=admin, json=request
        )
        assert response.status_code == 200, response.text
        assert (
            client.post(
                BASE + "/grant-amendments" + QUERY, headers=admin, json=request
            ).json()
            == response.json()
        )
        for known, expected in [
            ("2026-01-31T00:00:00Z", 5),
            ("2026-02-02T00:00:00Z", 3),
        ]:
            report = client.get(
                BASE + "/leave-report",
                headers=admin,
                params={
                    "scope_id": "hospital/pharmacy",
                    "effective_at": "2026-01-31",
                    "known_at": known,
                },
            )
            assert report.status_code == 200, report.text
            assert (
                next(b for b in report.json()["balances"] if b["account_id"] == "g0")[
                    "remaining_days"
                ]["numerator"]
                == expected
            )
        changed = {**request, "payload": {**payload, "granted_days": 4}}
        assert (
            client.post(
                BASE + "/grant-amendments" + QUERY, headers=admin, json=changed
            ).status_code
            == 409
        )
        staff = token(client, "pharmacist")
        assert (
            client.post(
                BASE + "/grant-amendments" + QUERY, headers=staff, json=request
            ).status_code
            == 403
        )
        own = client.get(
            BASE + "/leave-report",
            headers=staff,
            params={
                "scope_id": "hospital/pharmacy",
                "effective_at": "2026-01-31",
                "known_at": "2026-02-02T00:00:00Z",
            },
        ).json()
        assert {b["account_id"] for b in own["balances"]} == {"g1"}
        assert own["amendment_trace"] == []


def test_person_cannot_declare_for_other_or_self_approve(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = token(client, "pharmacist")
        payload = {
            "declaration_id": "outside-1",
            "person_id": "p1",
            "employer_id": "outside",
            "establishment_id": "outside-site",
            "reference": "synthetic unchecked statement",
            "start": "2026-01-01T00:00:00+09:00",
            "end": "2027-01-01T00:00:00+09:00",
        }
        request = {
            "expected_revision": 0,
            "idempotency_key": "own-declaration",
            "payload": payload,
        }
        first = client.post(
            BASE + "/outside-declarations" + QUERY, headers=staff, json=request
        )
        assert first.status_code == 200, first.text
        assert (
            client.post(
                BASE + "/outside-declarations" + QUERY, headers=staff, json=request
            ).json()
            == first.json()
        )
        for change in [
            {"person_id": "p0"},
            {"status": "RETURNED"},
            {"review_evidence": snapshot().policy_evidence.model_dump(mode="json")},
        ]:
            request.update(
                idempotency_key="unauthorized-" + next(iter(change)),
                payload={**payload, **change},
            )
            assert (
                client.post(
                    BASE + "/outside-declarations" + QUERY, headers=staff, json=request
                ).status_code
                == 403
            )


def test_actual_leave_correction_via_api_preserves_original_and_scopes(
    sqlite_session_factory,
):
    from shift_scheduler.application import compliance as service

    prepare(sqlite_session_factory)
    evidence = snapshot().policy_evidence.model_dump(mode="json")
    original = {
        "event_id": "actual",
        "account_id": "g0",
        "kind": "take",
        "unit": "day",
        "quantity": 1,
        "effective_on": "2026-01-06",
        "policy_id": "lp0",
        "interval": {
            "start": "2026-01-06T09:00:00+09:00",
            "end": "2026-01-06T13:00:00+09:00",
        },
        "evidence": evidence,
    }
    with sqlite_session_factory.begin() as session:
        service.save_entity(
            session, "hospital/pharmacy", "leave_record", original, 0, "admin"
        )
        service.save_entity(
            session,
            "hospital/pharmacy",
            "ledger_recording",
            {
                "recording_id": "record-actual",
                "object_kind": "leave_record",
                "object_id": "actual",
                "external_event_id": "hr:actual",
                "external_revision": 1,
                "recorded_at": "2026-01-07T00:00:00+09:00",
                "evidence": evidence,
            },
            0,
            "admin",
        )
    payload = {
        "amendment_id": "cancel-actual",
        "event_id": "actual",
        "person_id": "p0",
        "external_event_id": "hr:actual",
        "external_revision": 2,
        "supersedes_revision": 1,
        "recorded_at": "2026-02-01T00:00:00+09:00",
        "replacement": None,
        "reason": "HR reconciliation: source event was erroneous",
        "evidence": evidence,
    }
    request = {
        "payload": payload,
        "expected_revision": 0,
        "idempotency_key": "cancel-actual",
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        reply = client.post(
            BASE + "/leave-amendments" + QUERY, headers=admin, json=request
        )
        assert reply.status_code == 200, reply.text
        assert (
            reply.json()
            == client.post(
                BASE + "/leave-amendments" + QUERY, headers=admin, json=request
            ).json()
        )
        for cutoff, days in [("2026-01-31T00:00:00Z", 4), ("2026-02-02T00:00:00Z", 5)]:
            report = client.get(
                BASE + "/leave-report",
                headers=admin,
                params={
                    "scope_id": "hospital/pharmacy",
                    "effective_at": "2026-01-31",
                    "known_at": cutoff,
                },
            )
            assert report.status_code == 200, report.text
            assert (
                next(b for b in report.json()["balances"] if b["account_id"] == "g0")[
                    "remaining_days"
                ]["numerator"]
                == days
            )
        staff = token(client, "pharmacist")
        assert (
            client.post(
                BASE + "/leave-amendments" + QUERY, headers=staff, json=request
            ).status_code
            == 403
        )
        own = client.get(BASE + "/leave-report" + QUERY, headers=staff).json()
        assert own["amendment_trace"] == []
        forbidden = {**request, "idempotency_key": "generic-bypass"}
        assert (
            client.post(
                BASE + "/records/leave_amendment" + QUERY, headers=admin, json=forbidden
            ).status_code
            == 422
        )
        records = client.get(BASE + "/records" + QUERY, headers=admin).json()
        assert (
            next(r["payload"] for r in records if r["entity_id"] == "actual")["kind"]
            == "take"
        )


def test_snapshot_import_cannot_omit_authoritative_grant_correction(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    evidence = snapshot().policy_evidence.model_dump(mode="json")
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        payload = {
            "amendment_id": "reduce-grant",
            "person_id": "p0",
            "account_id": "g0",
            "external_event_id": "hr:g0",
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": "2026-01-01",
            "recorded_at": "2026-02-01T00:00:00+09:00",
            "granted_days": 3,
            "statutory_days": 3,
            "reason": "External HR correction",
            "evidence": evidence,
        }
        assert (
            client.post(
                BASE + "/grant-amendments" + QUERY,
                headers=admin,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "reduce-grant",
                    "payload": payload,
                },
            ).status_code
            == 200
        )
        old = snapshot().model_copy(update={"source_revision": 2})
        rejected = client.post(
            "/planning/inputs",
            headers=admin,
            json={"expected_revision": 1, "snapshot": old.model_dump(mode="json")},
        )
        assert rejected.status_code == 409, rejected.text
        corrected = {**old.model_dump(mode="json"), "grant_amendments": [payload]}
        accepted = client.post(
            "/planning/inputs",
            headers=admin,
            json={"expected_revision": 1, "snapshot": corrected},
        )
        assert accepted.status_code == 200, accepted.text


def test_transition_and_cross_midnight_segments_survive_public_api(
    sqlite_session_factory,
):
    from scripts.acceptance_workload import workload

    data = workload(30, 28, 930012)
    prepare(sqlite_session_factory, data.model_copy(update={"source_revision": 0}))
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        response = client.post(
            "/planning/inputs",
            headers=admin,
            json={"expected_revision": 1, "snapshot": data.model_dump(mode="json")},
        )
        assert response.status_code == 200, response.text[:2000]
        saved = client.get("/planning/inputs/latest" + QUERY, headers=admin).json()[
            "snapshot"
        ]
        assert (
            saved["accounting_transitions"]
            == data.model_dump(mode="json")["accounting_transitions"]
        )
        assert (
            len([t for t in saved["work_terms"] if t.get("employment_revision_ids")])
            == 30
        )
        staff = token(client, "pharmacist")
        assert (
            client.get(BASE + "/copies/context" + QUERY, headers=staff).status_code
            == 403
        )
        assert (
            client.post(
                BASE + "/copies/review-preservation" + QUERY,
                headers=staff,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "forbidden-preservation",
                    "payload": {},
                },
            ).status_code
            == 403
        )
