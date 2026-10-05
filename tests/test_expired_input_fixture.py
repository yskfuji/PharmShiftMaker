"""The fixture of the erasure journey (use case U29; SQLite).

The journey erases a superseded planning input whose retention has passed and is
refused one whose retention has not. These tests pin what it relies on: that the
superseded inputs exist only behind the journey's own flag, what the server
answers for each of them, and what the deep-only receipt observes afterwards.
"""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import (
    retention_trial_inputs,
    seed_retention_trial,
    snapshot,
)
from scripts.remediation_test_server import capture_input_erasure, seed_expired_input

from shift_scheduler.api.main import app
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.compliance_models import RetentionRule
from shift_scheduler.db.planning_models import AccountMembership, PlanningInput
from tests.test_compliance_api import BASE, QUERY, token

RETENTION = "保存期限未満または起算条件が未対応です"
CURRENT = "現行入力として参照されています"


def prepare(factory, *, trial):
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
        earlier = seed_retention_trial(session) if trial else 0
        register_input(session, snapshot(), "fixture", earlier)
    return earlier


def post(client, headers, path, key, payload):
    return client.post(
        BASE + path + QUERY,
        headers=headers,
        json={"expected_revision": 0, "idempotency_key": key, "payload": payload},
    )


def test_the_superseded_inputs_exist_only_for_the_erasure_journey(monkeypatch):
    assert seed_expired_input({}) is False
    assert seed_expired_input({"PHARMSHIFT_E2E_DEEP": "1"}) is False
    # Like every deep-only seed, the flag alone changes nothing outside the deep matrix.
    assert seed_expired_input({"PHARMSHIFT_E2E_EXPIRED_INPUT": "1"}) is False
    assert (
        seed_expired_input(
            {"PHARMSHIFT_E2E_EXPIRED_INPUT": "0", "PHARMSHIFT_E2E_DEEP": "1"}
        )
        is False
    )
    assert (
        seed_expired_input(
            {"PHARMSHIFT_E2E_EXPIRED_INPUT": "1", "PHARMSHIFT_E2E_DEEP": "1"}
        )
        is True
    )
    # The fixture's own input does not depend on the flag.
    before = snapshot()
    monkeypatch.setenv("PHARMSHIFT_E2E_EXPIRED_INPUT", "1")
    monkeypatch.setenv("PHARMSHIFT_E2E_DEEP", "1")
    assert snapshot() == before
    assert snapshot().input_hash == before.input_hash


def test_the_default_fixture_holds_one_input_and_no_rule(sqlite_session_factory):
    assert prepare(sqlite_session_factory, trial=False) == 0
    with sqlite_session_factory() as session:
        assert [row.input_hash for row in session.query(PlanningInput)] == [
            snapshot().input_hash
        ]
        assert session.query(RetentionRule).count() == 0
    with TestClient(app, base_url="https://localhost:8000") as client:
        listed = client.get(
            BASE + "/erasure-candidates" + QUERY, headers=token(client)
        ).json()["inputs"]
    assert [(row["input_hash"], row["erasable"]) for row in listed] == [
        (snapshot().input_hash, False)
    ]
    assert CURRENT in listed[0]["blockers"]


def test_the_flagged_fixture_has_one_erasable_input_and_one_within_retention(
    sqlite_session_factory, tmp_path
):
    expired, expired_newer, kept, kept_newer = retention_trial_inputs()
    assert prepare(sqlite_session_factory, trial=True) == 4
    database = f"sqlite+pysqlite:///{tmp_path / 'pharmshift.db'}"
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        listed = client.get(BASE + "/erasure-candidates" + QUERY, headers=admin).json()[
            "inputs"
        ]
        rows = {row["input_hash"]: row for row in listed}
        # The fixture's own input is still the newest of the scope.
        assert listed[0]["input_hash"] == snapshot().input_hash
        assert (
            client.get("/planning/inputs/latest" + QUERY, headers=admin).json()[
                "input_hash"
            ]
            == snapshot().input_hash
        )
        assert [row["input_hash"] for row in listed if row["erasable"]] == [
            expired.input_hash
        ]
        assert rows[expired.input_hash]["period"]["end"].startswith("2016-")
        assert rows[kept.input_hash]["blockers"] == [RETENTION]
        assert rows[kept.input_hash]["period"]["end"].startswith("2035-")
        for current in (expired_newer, kept_newer, snapshot()):
            assert CURRENT in rows[current.input_hash]["blockers"]
        # The input within retention: previewed with the server's reason, never erased.
        refused = post(
            client,
            admin,
            "/erasure-preview",
            "preview-kept",
            {"input_hash": kept.input_hash},
        ).json()
        assert (refused["erasable"], refused["blockers"]) == (False, [RETENTION])
        assert (
            post(
                client,
                admin,
                "/erasure-execute",
                "execute-kept",
                {"plan_id": refused["plan_id"], "fingerprint": refused["fingerprint"]},
            ).status_code
            == 409
        )
        # The expired input was planned with once: it has a finished job and the draft
        # that job produced, so the erasure has dependent rows to erase.
        before = capture_input_erasure(database, expired.input_hash)
        assert before == {
            "input_hash": expired.input_hash,
            "remaining_inputs": 1,
            "remaining_drafts": 1,
            "remaining_jobs": 1,
            "unfinished_jobs": 0,
            "input_tombstones": 0,
            "executed_plans": 0,
            "plan_tombstones": 0,
            "other_inputs": 4,
            "database": "disposable schema",
        }
        plan = post(
            client,
            admin,
            "/erasure-preview",
            "preview-expired",
            {"input_hash": expired.input_hash},
        ).json()
        assert plan["erasable"] is True
        tables = [target["table"] for target in plan["targets"]]
        assert tables.count("planning_inputs") == 1
        assert tables.count("planning_drafts") == 1
        assert tables.count("planning_jobs") == 1
        # The events of the registration, the job and the draft go with them.
        assert tables.count("planning_outbox") >= 3
        assert rows[expired.input_hash]["target_count"] == len(plan["targets"])
        # Nothing was published from it: a publication would be the current one of its
        # period and would keep the input.
        assert "planning_publications" not in tables
        executed = post(
            client,
            admin,
            "/erasure-execute",
            "execute-expired",
            {"plan_id": plan["plan_id"], "fingerprint": plan["fingerprint"]},
        )
        assert executed.status_code == 200, executed.text
        deleted = executed.json()["deleted"]
        assert deleted == len(plan["targets"]) >= 1
        gone = client.get(
            "/planning/inputs/latest" + QUERY + "&input_hash=" + expired.input_hash,
            headers=admin,
        )
        assert gone.status_code == 404
        # A pharmacist can neither list nor erase.
        staff = token(client, "pharmacist")
        assert (
            client.get(BASE + "/erasure-candidates" + QUERY, headers=staff).status_code
            == 403
        )
    assert capture_input_erasure(database, expired.input_hash) == {
        **before,
        "remaining_inputs": 0,
        "remaining_drafts": 0,
        "remaining_jobs": 0,
        "input_tombstones": 1,
        "executed_plans": 1,
        "plan_tombstones": deleted,
    }
    untouched = capture_input_erasure(database, kept.input_hash)
    assert untouched["remaining_inputs"] == 1
    # Only the expired input was planned with; the others have no job and no draft.
    assert (untouched["remaining_drafts"], untouched["remaining_jobs"]) == (0, 0)
