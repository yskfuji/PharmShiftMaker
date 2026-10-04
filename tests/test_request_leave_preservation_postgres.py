"""Projection is driven by HTTP requests and publication/settlement producers."""

from copy import deepcopy
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from shift_scheduler.api.main import app
from shift_scheduler.application import planning
from shift_scheduler.application.shared_projection import proposal
from shift_scheduler.application.subject_references import account_references
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningOutbox,
    PlanningRequest,
)
from shift_scheduler.domain.planning import LeaveAllocation, LeaveGrant
from tests.test_compliance_api import QUERY, token
from tests.test_planning_postgres import prepare
from tests.test_reviewed_planning import snapshot

SCOPE = "hospital/pharmacy"


def test_http_decision_actor_registered_and_partitioned_without_treating_all_evidence_names_as_accounts(
    pg, monkeypatch
):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    with pg.begin() as session:
        session.add_all(
            [
                AccountMembership(
                    membership_id=who,
                    issuer="mock",
                    subject=who,
                    person_id=person,
                    scope_id=SCOPE,
                    role=role,
                    active=True,
                )
                for who, person, role in [
                    ("admin", "p0", "ADMIN"),
                    ("pharmacist", "p1", "PHARMACIST"),
                ]
            ]
        )
        planning.register_input(session, snapshot(), "admin", 0)
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = token(client, "pharmacist")
        submitted = client.post(
            "/planning/requests" + QUERY,
            headers=staff,
            json={
                "idempotency_key": "storage-request-http",
                "start": "2026-01-05T00:00:00+09:00",
                "end": "2026-01-06T00:00:00+09:00",
                "kind": "PUBLIC_HOLIDAY_REQUEST",
            },
        )
        assert submitted.status_code == 201, submitted.text
        identity = submitted.json()["request_id"]
        admin = token(client)
        decided = client.post(
            "/planning/requests/" + identity + "/decision" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "storage-decision-http",
                "version": 1,
                "approved": True,
                "reference": "synthetic reviewed request",
            },
        )
        assert decided.status_code == 200, decided.text
    with pg() as session:
        row = session.get(PlanningRequest, identity)
        original = deepcopy(row.payload)
        registered = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_requests"
        )
        assert set(
            session.scalars(
                select(CopySubject.person_id).where(
                    CopySubject.copy_id == registered.copy_id
                )
            )
        ) == {"p0", "p1"}
        no_admin = proposal(session, registered, "p0")["payload"]
        assert "admin" not in str(no_admin)
        body = no_admin["retained"]["subject_records"][0]["data"]
        assert (
            body["request"] == original
            and body["decision"]["reference"] == "synthetic reviewed request"
        )
        assert body["status"] == "APPROVED"
        no_staff = proposal(session, registered, "p1")["payload"]
        assert no_staff["retained"]["subject_records"][0]["data"] == {}
        assert (
            no_staff["retained"]["subject_records"][0]["accounts"][0]["subject"]
            == "admin"
        )
        assert row.payload == original
        decision_event = session.scalar(
            select(PlanningOutbox).where(PlanningOutbox.kind == "request.decision")
        )
        event_copy = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_outbox"
            and c.locator["pk"]["event_id"] == decision_event.event_id
        )
        assert set(
            session.scalars(
                select(CopySubject.person_id).where(
                    CopySubject.copy_id == event_copy.copy_id
                )
            )
        ) == {"p0", "p1"}
        decision_history = proposal(session, event_copy, "p0")["payload"]
        assert "admin" not in str(decision_history)
        assert decision_history["retained"]["subject_records"][0]["data"][
            "event_fields"
        ] == {"approved": True}
        assert not no_admin["replayable"] and not no_staff["publishable"]
        ordinary = {"evidence": {"verified_by": "admin"}}
        assert account_references(session, SCOPE, ordinary) == []
        assert (
            session.scalar(
                text("SELECT pharmshift_actor_people(CAST(:document AS jsonb),:scope)"),
                {"document": '{"evidence":{"verified_by":"admin"}}', "scope": SCOPE},
            )
            == []
        )


def test_real_publication_leave_event_preserves_grant_owner_and_actor_separately(pg):
    data = snapshot(2, 1)
    grant = LeaveGrant(
        grant_id="grant",
        person_id="p1",
        employer_id="hospital",
        granted_on=date(2025, 1, 1),
        expires_on=date(2027, 1, 1),
        amount=1,
        evidence=data.policy_evidence,
    )
    leave = LeaveAllocation(
        allocation_id="leave",
        grant_id="grant",
        person_id="p1",
        start=data.period.start,
        end=data.period.end,
        amount=1,
        decision=data.policy_evidence,
    )
    data = data.model_copy(update={"grants": (grant,), "leaves": (leave,)})
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="leader",
                issuer="mock",
                subject="leader",
                person_id="operator",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    draft, review = prepare(pg, data)
    with pg.begin() as session:
        published = planning.publish(
            session,
            draft,
            SCOPE,
            "leader",
            1,
            0,
            data.input_hash,
            review,
            "storage-leave-publish",
        )
        planning.settle_leave(
            session,
            SCOPE,
            "leader",
            "grant",
            "actual-consume",
            "consume",
            1,
            1,
            published["publication_id"],
        )
    with pg() as session:
        events = [
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_leave_events"
        ]
        assert len(events) == 2
        for event in events:
            owner_history = proposal(session, event, "operator")["payload"]
            actor_history = proposal(session, event, "p1")["payload"]
            assert "leader" not in str(owner_history)
            assert (
                owner_history["retained"]["subject_records"][0]["data"]["person_id"]
                == "p1"
            )
            assert (
                owner_history["retained"]["subject_records"][0]["data"]["amount"] == 1
            )
            assert actor_history["retained"]["subject_records"][0]["data"] == {}
            assert not owner_history["publishable"]


def test_older_decision_actor_backfill_changes_registry_only_and_invalidates_review(pg):
    from shift_scheduler.application import account_copy_backfill

    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p0",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        session.flush()
        request = PlanningRequest(
            request_id="legacy",
            scope_id=SCOPE,
            person_id="p1",
            version=2,
            kind="PUBLIC_HOLIDAY_REQUEST",
            status="APPROVED",
            payload={
                "start": "2026-01-01T00:00:00Z",
                "end": "2026-01-02T00:00:00Z",
                "kind": "PUBLIC_HOLIDAY_REQUEST",
            },
            decision={
                "reference": "old exact decision",
                "status": "verified",
                "verified_by": "admin",
            },
        )
        session.add(request)
        session.flush()
        registered = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_requests"
        )
        for link in session.scalars(
            select(CopySubject).where(
                CopySubject.copy_id == registered.copy_id, CopySubject.person_id == "p0"
            )
        ):
            session.delete(link)
        registered.subject_status = "VERIFIED"
        old_hash, old_anchor = registered.content_hash, registered.anchor_at
        identity = registered.copy_id
    with pg.begin() as session:
        preview = account_copy_backfill.preview(session, SCOPE)
        assert preview["changes"][0]["additional_person_ids"] == ["p0"]
        result = account_copy_backfill.apply(session, SCOPE, preview["preview_hash"])
        assert result["updated_copies"] == 1 and result["subject_reviews_required"]
        row = session.get(ManagedCopy, identity)
        assert (
            row.content_hash == old_hash
            and row.anchor_at == old_anchor
            and row.subject_status == "UNVERIFIED"
        )
        assert (
            session.get(PlanningRequest, "legacy").decision["reference"]
            == "old exact decision"
        )


def test_actual_republication_release_preserves_owner_using_only_linked_predecessor(pg):
    from shift_scheduler.db.planning_models import (
        LeaveEvent,
        PlanningInput,
        PlanningPublication,
    )
    from shift_scheduler.domain.compliance import parse_snapshot
    from shift_scheduler.optimizer.planning import solve

    data = snapshot(2, 1)
    grant = LeaveGrant(
        grant_id="replacement-grant",
        person_id="p1",
        employer_id="hospital",
        granted_on=date(2025, 1, 1),
        expires_on=date(2027, 1, 1),
        amount=1,
        evidence=data.policy_evidence,
    )
    leave = LeaveAllocation(
        allocation_id="old-leave",
        grant_id=grant.grant_id,
        person_id="p1",
        start=data.period.start,
        end=data.period.end,
        amount=1,
        decision=data.policy_evidence,
    )
    data = data.model_copy(update={"grants": (grant,), "leaves": (leave,)})
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="leader",
                issuer="mock",
                subject="leader",
                person_id="operator",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    draft, review = prepare(pg, data)
    with pg.begin() as session:
        first = planning.publish(
            session,
            draft,
            SCOPE,
            "leader",
            1,
            0,
            data.input_hash,
            review,
            "shared-release-first",
        )
        # Refresh records the exact previous publication and reservation credit.
        # A separately registered revision withdraws the old allocation; neither
        # operation mutates the earlier input or publication.
        refreshed = planning.refresh_input(session, SCOPE, "leader", 1, data.input_hash)
        row = session.get(PlanningInput, refreshed["input_hash"])
        snapshot2 = parse_snapshot(row.payload)
        snapshot2 = snapshot2.model_copy(update={"leaves": (), "source_revision": 3})
        planning.register_input(session, snapshot2, "leader", 2)
        row = session.get(PlanningInput, snapshot2.input_hash)
        assert (
            not snapshot2.leaves
            and snapshot2.replaces_publication_id == first["publication_id"]
        )
        second_draft = planning.new_draft(
            session, row, solve(snapshot2, 2).proposal, "leader"
        )
        session.flush()
        reviewed = planning.review_draft(
            session, second_draft.draft_id, SCOPE, 1, "leader"
        )
        assert reviewed["publishable"], reviewed
        second = planning.publish(
            session,
            second_draft.draft_id,
            SCOPE,
            "leader",
            1,
            1,
            row.input_hash,
            reviewed["review_hash"],
            "shared-release-second",
        )
    with pg() as session:
        event = session.scalar(select(LeaveEvent).where(LeaveEvent.kind == "release"))
        assert event.publication_id == second["publication_id"]
        copy = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_leave_events"
            and c.locator["pk"]["event_id"] == event.event_id
        )
        retained = proposal(session, copy, "operator")["payload"]
        assert retained["retained"]["subject_records"][0]["data"]["person_id"] == "p1"
        assert retained["retained"]["subject_records"][0]["data"]["amount"] == 1
        publication = session.get(PlanningPublication, second["publication_id"])
        original = publication.payload
        # Corrupt predecessor is refused; another record's grant is no proof.
        publication.payload = {**original, "replaces": second["publication_id"]}
        with pytest.raises(ValueError, match="predecessor"):
            proposal(session, copy, "operator")
