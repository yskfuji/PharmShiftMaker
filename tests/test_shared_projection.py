from copy import deepcopy

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, planning, privacy
from shift_scheduler.application.shared_projection import project, proposal
from shift_scheduler.db.compliance_models import (
    ManagedCopy,
    PreservedArchive,
    RestoreGate,
)
from shift_scheduler.db.planning_models import PlanningInput
from shift_scheduler.domain.copies import DatabaseCopyReview, SharedProjectionReview
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_planning_postgres import pg as _pg
from tests.test_reviewed_planning import snapshot

pg = _pg


def test_projection_preserves_other_records_without_making_a_solver_input():
    from scripts.remediation_fixture import snapshot as v3

    from shift_scheduler.domain.compliance import parse_snapshot

    for data in (snapshot(2, 1), v3()):
        payload = data.model_dump(mode="json")
        original = deepcopy(payload)
        replacement = project(payload, "p0")
        assert payload == original
        assert not replacement["replayable"] and not replacement["publishable"]
        retained = replacement["retained"]
        assert retained["people"] == [
            p for p in original["people"] if p["person_id"] != "p0"
        ]
        for field in ("contracts", "capabilities", "candidates"):
            assert retained[field] == [
                r for r in payload[field] if r["person_id"] != "p0"
            ]
        with pytest.raises(ValueError):
            parse_snapshot(replacement)
        account_ids = {a["account_id"] for a in retained.get("leave_accounts", [])}
        assert all(
            e["account_id"] in account_ids for e in retained.get("leave_records", [])
        )


def prepare(factory, people=2):
    data = snapshot(people, 1)
    with factory.begin() as s:
        from shift_scheduler.db.planning_models import AccountMembership

        s.add(
            AccountMembership(
                membership_id="fixture-actor",
                issuer="mock",
                subject="fixture",
                person_id="p0",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        s.flush()
        planning.register_input(s, data, "fixture", 0)
        planning.register_input(
            s, data.model_copy(update={"source_revision": 1}), "fixture", 1
        )
        privacy.save_rule(
            s,
            SCOPE,
            RetentionPolicy(
                category="planning_history",
                purpose="closed history",
                anchor="period_end",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=EVIDENCE,
                owner="officer",
                next_review="2036-01-01",
            ),
            0,
            "admin",
        )
        privacy.save_rule(
            s,
            SCOPE,
            RetentionPolicy(
                category="audit",
                purpose="expired event",
                anchor="last_activity",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=EVIDENCE,
                owner="officer",
                next_review="2036-01-01",
            ),
            0,
            "admin",
        )
    with factory.begin() as s:
        from shift_scheduler.db.planning_models import PlanningOutbox

        events = {
            r.event_id
            for r in s.scalars(select(PlanningOutbox))
            if r.kind == "input.register" and r.payload["input_hash"] == data.input_hash
        }
        for event in list(s.scalars(select(ManagedCopy))):
            if (
                event.locator.get("table") != "planning_outbox"
                or event.locator["pk"].get("event_id") not in events
            ):
                continue
            copies.review_database_copy(
                s,
                SCOPE,
                DatabaseCopyReview(
                    copy_id=event.copy_id,
                    content_hash=event.content_hash,
                    person_ids=tuple(p.person_id for p in data.people),
                    evidence=EVIDENCE,
                ),
                event.revision,
                "admin",
                AT,
            )
            p = proposal(s, event, "p0")
            copies.review_shared_projection(
                s,
                SCOPE,
                SharedProjectionReview(
                    copy_id=event.copy_id,
                    person_id="p0",
                    content_hash=event.content_hash,
                    projection_hash=p["payload_hash"],
                    shared_text_reviewed=True,
                    evidence=EVIDENCE,
                ),
                event.revision,
                "admin",
                AT,
            )
        row = next(
            r
            for r in s.scalars(select(ManagedCopy))
            if r.locator.get("table") == "planning_inputs"
            and r.locator["pk"]["input_hash"] == data.input_hash
        )
        copies.review_database_copy(
            s,
            SCOPE,
            DatabaseCopyReview(
                copy_id=row.copy_id,
                content_hash=row.content_hash,
                person_ids=tuple(p.person_id for p in data.people),
                evidence=EVIDENCE,
            ),
            row.revision,
            "admin",
            AT,
        )
        projected = proposal(s, row, "p0")
        copies.review_shared_projection(
            s,
            SCOPE,
            SharedProjectionReview(
                copy_id=row.copy_id,
                person_id="p0",
                content_hash=row.content_hash,
                projection_hash=projected["payload_hash"],
                shared_text_reviewed=True,
                evidence=EVIDENCE,
            ),
            row.revision,
            "admin",
            AT,
        )
        source = {
            c.name: getattr(s.get(PlanningInput, data.input_hash), c.name)
            for c in PlanningInput.__table__.columns
        }
        return data, row.copy_id, source


def test_shared_source_atomic_preservation_and_restore_gate(pg):
    data, copy_id, source = prepare(pg)
    with pg.begin() as s:
        preview = copies.preview(s, SCOPE, "p0", "admin", AT)
        target = next(t for t in preview["targets"] if t["copy_id"] == copy_id)
        assert not target["blockers"], target
        assert (
            "payload" not in target["preservation"]
        )  # control ledger is not another data copy
        result = copies.execute(
            s, SCOPE, preview["plan_id"], preview["fingerprint"], 1, "admin", AT
        )
        assert len(result["preserved_archive_ids"]) == 2
        archive = next(
            a
            for a in s.scalars(select(PreservedArchive))
            if "contracts" in a.payload["retained"]
        )
        assert [p["person_id"] for p in archive.payload["retained"]["people"]] == ["p1"]
        assert s.get(PlanningInput, data.input_hash) is None
        artifacts = [
            {
                k: getattr(a, k)
                for k in (
                    "archive_id",
                    "scope_id",
                    "source_digest",
                    "payload_hash",
                    "payload",
                )
            }
            for a in s.scalars(select(PreservedArchive))
        ]
        artifact = next(a for a in artifacts if "contracts" in a["payload"]["retained"])
        manifest = export_manifest(s, b"x" * 32)
        assert manifest["payload"]["version"] == 6
        assert "payload" not in manifest["payload"]["preserved_archives"][0]
        retained_controls = {
            r["archive_id"]: r["retention"]
            for r in manifest["payload"]["preserved_archives"]
        }
        original_copy = s.get(ManagedCopy, copy_id)
        assert (
            retained_controls[archive.archive_id]["anchor_at"]
            == original_copy.anchor_at.isoformat()
        )
    with pg.begin() as s:
        quarantine(s)
        for a in artifacts:
            s.delete(s.get(PreservedArchive, a["archive_id"]))
        copy = s.get(ManagedCopy, copy_id)
        copy.state = "PRESENT"
        s.flush()
        s.add(PlanningInput(**source))
    with pytest.raises(ValueError, match="preserved history"), pg.begin() as s:
        replay(s, manifest, content_hash(manifest), b"x" * 32)
    with pg() as s:
        assert s.get(RestoreGate, "restore").state == "QUARANTINED"
        assert s.get(PlanningInput, data.input_hash) is not None
    with pg.begin() as s:
        replay(s, manifest, content_hash(manifest), b"x" * 32, artifacts)
        assert s.get(PlanningInput, data.input_hash) is None
        assert (
            s.get(PreservedArchive, artifact["archive_id"]).payload
            == artifact["payload"]
        )
        for c in s.scalars(select(ManagedCopy)):
            if c.locator.get("table") == "preserved_archives" and c.state == "PRESENT":
                original = retained_controls[c.locator["pk"]["archive_id"]]
                assert (
                    c.category,
                    c.anchor,
                    c.anchor_at.isoformat(),
                    c.subject_status,
                    c.evidence,
                ) == (
                    original["category"],
                    original["anchor"],
                    original["anchor_at"],
                    original["subject_status"],
                    original["evidence"],
                )


def test_projection_rollback_preserves_original_and_no_replacement(pg):
    data, _, _ = prepare(pg)
    with pg() as s:
        p = copies.preview(s, SCOPE, "p0", "admin", AT)
        copies.execute(s, SCOPE, p["plan_id"], p["fingerprint"], 1, "admin", AT)
        s.rollback()
    with pg() as s:
        assert s.get(PlanningInput, data.input_hash)
        assert not list(s.scalars(select(PreservedArchive)))


def _crash_worker(url, plan, connection):
    """Child process pauses after replacement INSERT, before original DELETE."""
    import time

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.application import database_erasure

    original = database_erasure.erase

    def wait_after_preservation(session, copy):
        connection.send("replacement-flushed-before-delete")
        while True:
            time.sleep(0.1)
        original(session, copy)

    database_erasure.erase = wait_after_preservation
    factory = sessionmaker(create_engine(url), expire_on_commit=False)
    with factory.begin() as session:
        copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "fault-worker", AT
        )


def test_sigkill_between_shared_preservation_and_delete_is_recoverable(pg):
    import multiprocessing

    data, _, _ = prepare(pg)
    with pg.begin() as s:
        plan = copies.preview(s, SCOPE, "p0", "admin", AT)
    ctx = multiprocessing.get_context("spawn")
    parent, child = ctx.Pipe()
    process = ctx.Process(
        target=_crash_worker,
        args=(pg.kw["bind"].url.render_as_string(hide_password=False), plan, child),
    )
    process.start()
    try:
        assert parent.poll(15), "Fault checkpoint not reached"
        assert parent.recv() == "replacement-flushed-before-delete"
        process.kill()
        process.join(10)
        assert process.exitcode == -9
        with pg() as s:
            assert s.get(PlanningInput, data.input_hash)
            assert not list(s.scalars(select(PreservedArchive)))
        with pg.begin() as s:
            result = copies.execute(
                s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "retry", AT
            )
            assert len(result["preserved_archive_ids"]) == 2
            assert len(result["erased_database_copy_ids"]) == 2
    finally:
        if process.is_alive():
            process.kill()
            process.join(5)
        parent.close()
        child.close()


def test_shared_erasure_public_api_replay_and_old_confirmation(pg, monkeypatch):
    from datetime import datetime

    from fastapi.testclient import TestClient

    from shift_scheduler.api.main import app
    from shift_scheduler.api.routers import planning as routes
    from shift_scheduler.db import session as database
    from shift_scheduler.db.planning_models import AccountMembership
    from tests.test_compliance_api import BASE, QUERY, token

    _, identity, _ = prepare(pg)
    monkeypatch.setattr(routes, "get_session_factory", lambda: pg)
    monkeypatch.setattr(database, "get_session_factory", lambda: pg)

    class FixedTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return AT

    monkeypatch.setattr(copies, "datetime", FixedTime)
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p1",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        headers = token(client)
        preview_request = {
            "expected_revision": 0,
            "idempotency_key": "shared-preview-http",
            "payload": {"person_id": "p0"},
        }
        response = client.post(
            BASE + "/copies/preview" + QUERY, headers=headers, json=preview_request
        )
        assert response.status_code == 200, response.text
        preview = response.json()
        projected = client.get(
            BASE + "/copies/" + identity + "/projection" + QUERY + "&person_id=p0",
            headers=headers,
        )
        assert projected.status_code == 200, projected.text
        assert projected.json()["payload"]["replayable"] is False
        request = {
            "expected_revision": 1,
            "idempotency_key": "shared-execute-http",
            "payload": {
                "plan_id": preview["plan_id"],
                "fingerprint": preview["fingerprint"],
            },
        }
        first = client.post(
            BASE + "/copies/execute" + QUERY, headers=headers, json=request
        )
        assert first.status_code == 200, first.text
        assert len(first.json()["preserved_archive_ids"]) == 2
        # Simulate response loss: repeat exactly the public request after commit.
        retry = client.post(
            BASE + "/copies/execute" + QUERY, headers=headers, json=request
        )
        assert retry.status_code == 200 and retry.json() == first.json()
        changed = {**request, "idempotency_key": "shared-stale-http"}
        stale = client.post(
            BASE + "/copies/execute" + QUERY, headers=headers, json=changed
        )
        assert stale.status_code == 409, stale.text
        for archive in first.json()["preserved_archive_ids"]:
            r = client.get(
                BASE + "/preserved-archives/" + archive + QUERY, headers=headers
            )
            assert r.status_code == 200 and r.json()["payload"]["publishable"] is False
    with pg() as s:
        assert len(list(s.scalars(select(PreservedArchive)))) == 2
