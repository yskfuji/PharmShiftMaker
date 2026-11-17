import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from shift_scheduler.application.copy_graph import database_inventory
from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject, ManagedCopy
from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox


def test_actor_is_a_subject_without_inferring_prose_or_display_names(pg):
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="history",
                issuer="oidc",
                subject="stable-subject",
                person_id="p1",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=False,
            )
        )
        s.flush()
        s.add(
            PlanningOutbox(
                event_id="shared",
                scope_id="hospital/pharmacy",
                actor="stable-subject",
                kind="privacy.review",
                payload={
                    "person_id": "p0",
                    "reason": "p2 is prose, not an identity mapping",
                },
            )
        )
    with pg() as s:
        row = next(
            r
            for r in s.scalars(select(ManagedCopy))
            if r.locator.get("pk") == {"event_id": "shared"}
        )
        assert set(
            s.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == row.copy_id)
            )
        ) == {"p0", "p1"}
        graph = database_inventory(s, "hospital/pharmacy", "p1")
        assert any(
            r["table"] == "planning_outbox" and r["account_references"][0]["resolved"]
            for r in graph["records"]
        )
    with pg.begin() as s:
        s.add(
            ErasedSubject(
                facility_id="hospital", person_id="p1", plan_id="test", evidence={}
            )
        )
    with pytest.raises(IntegrityError), pg.begin() as s:
        s.add(
            PlanningOutbox(
                event_id="reappears",
                scope_id="hospital/pharmacy",
                actor="stable-subject",
                kind="privacy.review",
                payload={"person_id": "p0"},
            )
        )


def test_backfill_invalidates_old_review_without_changing_source_or_retention(pg):
    from shift_scheduler.application.account_copy_backfill import apply, preview
    from shift_scheduler.application.planning import Conflict

    with pg.begin() as s:
        s.add(
            PlanningOutbox(
                event_id="old",
                scope_id="hospital/pharmacy",
                actor="old-actor",
                kind="privacy.review",
                payload={"person_id": "p0"},
            )
        )
    with pg() as s:
        row = next(
            r
            for r in s.scalars(select(ManagedCopy))
            if r.locator.get("pk") == {"event_id": "old"}
        )
        identity, digest, anchor = row.copy_id, row.content_hash, row.anchor_at
        before = preview(s, "hospital/pharmacy")
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="late",
                issuer="oidc",
                subject="old-actor",
                person_id="p1",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=False,
            )
        )
    with pytest.raises(Conflict), pg.begin() as s:
        apply(s, "hospital/pharmacy", before["preview_hash"])
    with pg.begin() as s:
        review = preview(s, "hospital/pharmacy")
        assert (
            apply(s, "hospital/pharmacy", review["preview_hash"])["updated_copies"] == 1
        )
        row = s.get(ManagedCopy, identity)
        assert (row.content_hash, row.anchor_at, row.subject_status) == (
            digest,
            anchor,
            "UNVERIFIED",
        )
        assert set(
            s.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == identity)
            )
        ) == {"p0", "p1"}
