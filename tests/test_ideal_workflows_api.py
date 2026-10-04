"""HTTP-level authorization, concurrency and export checks of the ideal-UI workflows.

Builds a real publication through the reviewed flow (input -> draft -> review -> publish),
then exercises change cases and personal export as each role would.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot as remediation_snapshot
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from shift_scheduler.api.main import app
from shift_scheduler.api.routers import planning as planning_router
from shift_scheduler.application import ideal_workflows
from shift_scheduler.application.planning import register_input
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningPublication,
)
from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.v3_inputs import input_findings
from tests.test_planning_postgres import pg  # noqa: F401  (fixture)
from tests.test_reviewed_planning import snapshot

SCOPE = "?scope_id=hospital%2Fpharmacy"
OTHER = "?scope_id=other%2Fpharmacy"
EVIDENCE = {"reason": "合成の試験", "reference": "TEST-1"}
USERS = {
    "admin": "pass-admin",
    "leader": "pass-lead",
    "pharmacist": "pass-ph",
    "developer": "pass-dev",
}


def test_candidate_derivation_rebuilds_v3_catalogue_and_keeps_source_immutable(
    sqlite_session_factory,
):
    original = remediation_snapshot()
    altered = original.candidates[0].model_copy(
        update={"task": original.candidates[0].task + "-unapproved-import"}
    )
    bad = original.model_copy(
        update={"candidates": (altered, *original.candidates[1:])}
    )
    assert any(f.rule_id == "catalogue.v3" for f in input_findings(bad))
    with sqlite_session_factory.begin() as session:
        registered = register_input(session, bad, "synthetic-admin", 0)
        result = ideal_workflows.derive_candidates(
            session,
            scope_id="hospital/pharmacy",
            actor="synthetic-admin",
            expected_version=1,
            evidence=EVIDENCE,
            idempotency_key="derive-v3-catalogue",
        )
        old = session.get(PlanningInput, registered["input_hash"])
        current = session.get(PlanningInput, result["input_hash"])
        assert old is not None and current is not None
        assert old.payload["candidates"][0]["task"].endswith("-unapproved-import")
        derived = parse_snapshot(current.payload)
        expected = generate_catalogue(derived)
        assert current.payload["candidates"] == [
            duty
            for duty in expected["candidates"]
            if duty["duty_id"] not in {history.duty_id for history in derived.history}
        ]
        assert len(current.payload["work_terms"]) == len(expected["work_terms"])
        assert all(
            all(actual[key] == value for key, value in generated.items())
            for actual, generated in zip(
                current.payload["work_terms"], expected["work_terms"], strict=True
            )
        )
        assert not [f for f in input_findings(derived) if f.rule_id == "catalogue.v3"]


@pytest.fixture(params=["sqlite", "postgres"])
def world(request, tmp_path, monkeypatch):
    if request.param == "postgres":
        # Migrated schema (alembic upgrade head) on an isolated test database; skipped without one.
        db = request.getfixturevalue("pg")
    else:
        engine = create_engine(f"sqlite:///{tmp_path / 'ideal.db'}")
        Base.metadata.create_all(engine)
        db = sessionmaker(engine, expire_on_commit=False)
    # The real transaction dependency (and its 409/422/404 mapping) on an isolated database.
    monkeypatch.setattr(planning_router, "get_session_factory", lambda: db)
    with db.begin() as session:
        for subject, person, role in (
            ("admin", "p0", "ADMIN"),
            ("leader", "p1", "LEADER"),
            # A distinct synthetic reviewer keeps approval independent even when the
            # scheduled administrator or leader is affected by the change.
            ("developer", "p-reviewer", "ADMIN"),
        ):
            session.add(
                AccountMembership(
                    membership_id=f"m-{subject}",
                    issuer="mock",
                    subject=subject,
                    person_id=person,
                    scope_id="hospital/pharmacy",
                    role=role,
                    active=True,
                )
            )
    clients = {}
    for name, password in USERS.items():
        client = TestClient(app, headers={"Origin": "https://localhost:3000"})
        assert (
            client.post(
                "/auth/login", json={"username": name, "password": password}
            ).status_code
            == 200
        )
        clients[name] = client
    data = snapshot(n=3, days=2)
    admin = clients["admin"]
    assert (
        admin.post(
            "/planning/inputs",
            json={"snapshot": data.model_dump(mode="json"), "expected_revision": 0},
        ).status_code
        == 200
    )
    draft = admin.post(
        "/planning/drafts" + SCOPE,
        json={
            "idempotency_key": "ideal-api-draft",
            "input_hash": data.input_hash,
            "proposal": solve(data, 5).proposal.model_dump(mode="json"),
        },
    ).json()
    review = admin.post(
        f"/planning/drafts/{draft['draft_id']}/review" + SCOPE,
        json={"version": 1, "idempotency_key": "ideal-api-review"},
    ).json()
    published = admin.post(
        f"/planning/drafts/{draft['draft_id']}/publish" + SCOPE,
        json={
            "version": 1,
            "expected_publication_version": 0,
            "input_hash": data.input_hash,
            "review_hash": review["review_hash"],
            "idempotency_key": "ideal-api-publish",
        },
    )
    assert published.status_code == 200, published.text
    with db.begin() as session:
        publication = session.scalars(select(PlanningPublication)).one()
        assignments = publication.payload["assignments"]
        # The pharmacist is p2, a person with a published duty and no planning role.
        assert any(d["person_id"] == "p2" for d in assignments)
        session.add(
            AccountMembership(
                membership_id="m-pharmacist",
                issuer="mock",
                subject="pharmacist",
                person_id="p2",
                scope_id="hospital/pharmacy",
                role="PHARMACIST",
                active=True,
            )
        )
    yield {
        "db": db,
        "clients": clients,
        "publication": publication,
        "assignments": assignments,
        "snapshot": data,
    }


def replacement_for(world, duty):
    """A candidate duty of another, unassigned person at the same time as ``duty``."""
    busy = {d["person_id"] for d in world["assignments"] if d["start"] == duty["start"]}
    for candidate in world["snapshot"].candidates:
        if (
            candidate.start.isoformat() == duty["start"]
            and candidate.person_id not in busy
        ):
            return candidate
    raise AssertionError("no replacement candidate")


def open_absence(world, client, duty, key, replacement=None, replace=True):
    replacement = replacement or replacement_for(world, duty)
    return client.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "ABSENCE",
            "affected_assignment_ids": [duty["duty_id"]],
            "proposed_assignment_ids": [replacement.duty_id] if replace else [],
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )


def approve(client, case, key, publication_version=1):
    return client.post(
        f"/planning/change-cases/{case['case_id']}/approve" + SCOPE,
        json={
            "expected_version": case["version"],
            "expected_publication_version": publication_version,
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )


def recommend(client, case, key):
    return client.post(
        f"/planning/change-cases/{case['case_id']}/recommend" + SCOPE,
        json={
            "expected_version": case["version"],
            "evidence": EVIDENCE,
            "idempotency_key": key,
        },
    )


def test_approval_publishes_a_new_version_and_a_stale_case_is_rejected(world):
    leader = world["clients"]["leader"]
    first, second = world["assignments"][0], world["assignments"][-1]
    assert first["start"] != second["start"]
    case_a = open_absence(world, leader, first, "case-a-0001").json()
    case_b = open_absence(world, leader, second, "case-b-0001").json()
    assert case_a["status"] == case_b["status"] == "READY"
    recommended = recommend(leader, case_a, "recommend-a-001")
    assert recommended.status_code == 200, recommended.text
    assert recommended.json()["status"] == "AWAITING_INDEPENDENT_APPROVAL"
    approved = approve(
        world["clients"]["developer"], recommended.json(), "approve-a-0001"
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["version"] == 2
    with world["db"].begin() as session:
        versions = {p.version: p for p in session.scalars(select(PlanningPublication))}
    assert set(versions) == {1, 2}
    assert (
        versions[1].payload["assignments"] == world["assignments"]
    )  # never overwritten
    new_ids = {d["duty_id"] for d in versions[2].payload["assignments"]}
    assert first["duty_id"] not in new_ids
    assert replacement_for(world, first).duty_id in new_ids
    assert second["duty_id"] in new_ids  # every unaffected duty is kept
    # Case B was opened against version 1; approving it would drop case A's change.
    recommended_b = recommend(leader, case_b, "recommend-b-001").json()
    stale = approve(
        world["clients"]["developer"],
        recommended_b,
        "approve-b-0001",
        publication_version=2,
    )
    assert stale.status_code == 409, stale.text


def test_stale_case_version_and_reused_key_are_conflicts(world):
    leader = world["clients"]["leader"]
    case = open_absence(world, leader, world["assignments"][0], "case-v-0001").json()
    assert (
        approve(
            leader, {**case, "version": case["version"] + 1}, "approve-v-0001"
        ).status_code
        == 409
    )
    duty = world["assignments"][-1]
    reused = leader.post(
        "/planning/change-cases" + SCOPE,
        json={
            "publication_id": world["publication"].publication_id,
            "kind": "ABSENCE",
            "affected_assignment_ids": [duty["duty_id"]],
            "proposed_assignment_ids": [replacement_for(world, duty).duty_id],
            "evidence": EVIDENCE,
            "idempotency_key": "case-v-0001",
        },
    )
    assert reused.status_code == 409


def own_and_foreign(world):
    own = next(d for d in world["assignments"] if d["person_id"] == "p2")
    foreign = next(
        d
        for d in world["assignments"]
        if d["person_id"] != "p2"
        and d["start"] != own["start"]
        and replacement_for(world, d).person_id != "p2"
    )
    return own, foreign


def covered_by_p2(world, own):
    """A duty of another person that p2 (free at that time) can take over."""
    busy = {d["start"] for d in world["assignments"] if d["person_id"] == "p2"}
    for duty in world["assignments"]:
        if duty["person_id"] == "p2" or duty["start"] in busy or duty == own:
            continue
        for candidate in world["snapshot"].candidates:
            if (
                candidate.person_id == "p2"
                and candidate.start.isoformat() == duty["start"]
            ):
                return duty, candidate
    raise AssertionError("no duty p2 can cover")


def test_pharmacist_sees_only_cases_about_their_own_duties(world):
    leader, pharmacist = world["clients"]["leader"], world["clients"]["pharmacist"]
    own, foreign = own_and_foreign(world)
    mine = open_absence(world, leader, own, "case-own-0001").json()
    open_absence(world, leader, foreign, "case-other-001")
    covered, candidate = covered_by_p2(world, own)
    cover = open_absence(
        world, leader, covered, "case-cover-001", replacement=candidate
    ).json()
    assert len(leader.get("/planning/change-cases" + SCOPE).json()) == 3
    full = {
        c["case_id"]: c for c in leader.get("/planning/change-cases" + SCOPE).json()
    }
    assert len(full[mine["case_id"]]["proposed_assignments"]) == 3
    assert full[mine["case_id"]]["evidence"] == EVIDENCE
    seen = {
        c["case_id"]: c for c in pharmacist.get("/planning/change-cases" + SCOPE).json()
    }
    assert set(seen) == {mine["case_id"], cover["case_id"]}
    # An allow-list: only p2's own duties, findings and consent; no one else's duty,
    # no evidence written by someone else, no creator.
    absent = seen[mine["case_id"]]
    assert [d["duty_id"] for d in absent["affected_assignments"]] == [own["duty_id"]]
    assert absent["proposed_assignments"] == []
    covering = seen[cover["case_id"]]
    assert covering["affected_assignments"] == []
    assert [d["duty_id"] for d in covering["proposed_assignments"]] == [
        candidate.duty_id
    ]
    for case in seen.values():
        assert case["evidence"] == {} and case["created_by"] == ""
        assert set(case["validation"]) == {
            "findings",
            "publishable",
            "required_consent_person_ids",
            "consented_person_ids",
        }
        people = {
            d["person_id"]
            for d in case["affected_assignments"] + case["proposed_assignments"]
        }
        assert people <= {"p2"}
        for finding in case["validation"]["findings"]:
            assert "p2" in finding["subjects"] or set(finding["subjects"]) & {
                d["duty_id"]
                for d in case["affected_assignments"] + case["proposed_assignments"]
            }


def test_role_scope_and_subject_boundaries(world):
    clients = world["clients"]
    pharmacist, leader = clients["pharmacist"], clients["leader"]
    own, foreign = own_and_foreign(world)
    assert (
        open_absence(world, pharmacist, foreign, "case-foreign-01").status_code == 403
    )
    # An absence needs no consent, so a pharmacist may not put someone else on duty.
    assert open_absence(world, pharmacist, own, "case-self-00001").status_code == 403
    assert (
        open_absence(
            world, pharmacist, own, "case-self-00002", replace=False
        ).status_code
        == 200
    )
    assert pharmacist.get("/planning/change-cases" + OTHER).status_code == 403
    assert leader.get("/planning/change-cases" + OTHER).status_code == 403
    case = open_absence(world, leader, world["assignments"][0], "case-role-0001").json()
    assert approve(pharmacist, case, "approve-ph-0001").status_code == 403
    derive = {
        "expected_version": 1,
        "evidence": EVIDENCE,
        "idempotency_key": "derive-0001",
    }
    assert (
        leader.post("/planning/candidates/derive" + SCOPE, json=derive).status_code
        == 403
    )
    link = {
        "issuer": "https://id.example",
        "subject": "new-user",
        "person_id": "p2",
        "role": "ADMIN",
        "evidence": EVIDENCE,
        "expected_version": 0,
        "idempotency_key": "link-0000001",
    }
    assert leader.post("/planning/memberships" + SCOPE, json=link).status_code == 403
    blank = {
        **link,
        "evidence": {"reason": "   ", "reference": "TEST-1"},
        "idempotency_key": "link-0000002",
    }
    assert (
        clients["admin"].post("/planning/memberships" + SCOPE, json=blank).status_code
        == 422
    )


def test_personal_export_is_own_current_and_rfc5545_shaped(world):
    pharmacist, leader = world["clients"]["pharmacist"], world["clients"]["leader"]
    person = "p2"
    publication_id = world["publication"].publication_id
    response = pharmacist.get(
        f"/planning/personal-schedule/{publication_id}/content" + SCOPE + "&format=ical"
    )
    assert response.status_code == 200
    body = response.content
    assert body.endswith(b"\r\n") and b"\n" not in body.replace(b"\r\n", b"")
    assert all(len(line) <= 75 for line in body.split(b"\r\n"))
    own = {d["duty_id"] for d in world["assignments"] if d["person_id"] == person}
    unfolded = body.replace(b"\r\n ", b"").decode()
    uids = {
        line[4:].split("@")[0]
        for line in unfolded.split("\r\n")
        if line.startswith("UID:")
    }
    assert uids == own
    assert unfolded.count("DTSTAMP:") == len(own)
    # The period is the publication's own "<start>|<end>", not a mangled string.
    start, end = world["publication"].period_key.split("|")
    meta = pharmacist.get(f"/planning/personal-schedule/{publication_id}" + SCOPE)
    assert meta.status_code == 200
    assert (meta.json()["period_start"], meta.json()["period_end"]) == (start, end)
    disposition = response.headers["content-disposition"]
    assert disposition == f'attachment; filename="schedule-{start[:10]}.ics"'
    printed = pharmacist.get(
        f"/planning/personal-schedule/{publication_id}/content" + SCOPE
    ).text
    assert f"期間 {start[:10]}–{end[:10]}" in printed and "|" not in printed
    # After a replacement the old version is no longer exportable.
    case = open_absence(
        world, leader, world["assignments"][-1], "case-export-01"
    ).json()
    recommended = recommend(leader, case, "recommend-export-1")
    assert recommended.status_code == 200, recommended.text
    assert (
        approve(
            world["clients"]["developer"],
            recommended.json(),
            "approve-export-1",
        ).status_code
        == 200
    )
    stale = pharmacist.get(f"/planning/personal-schedule/{publication_id}" + SCOPE)
    assert stale.status_code == 409
