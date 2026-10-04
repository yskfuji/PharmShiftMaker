"""Joint erasure of a shared database row, real PostgreSQL, synthetic data only.

All controlled owners are removed together; uncontrolled owners (an operator
account) are kept as reviewed partial history. The identity barrier stays on.
"""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select, text

from shift_scheduler.application import copies, privacy
from shift_scheduler.application import joint_copy_erasure as joint
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    CopySubject,
    LegalHold,
    ManagedCopy,
    PreservedArchive,
    PrivacyCase,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox
from shift_scheduler.domain.copies import DatabaseCopyReview
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_person_control_sequence import configured, control, execute

OLD = datetime(2020, 1, 1, tzinfo=UTC)


def rule(s, category):
    privacy.save_rule(
        s,
        SCOPE,
        RetentionPolicy(
            category=category,
            purpose="synthetic expiry",
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
        "officer",
    )


def copy_of(s, **pk):
    return next(c for c in s.scalars(select(ManagedCopy)) if c.locator.get("pk") == pk)


def owners(s, identity):
    return sorted(
        s.scalars(select(CopySubject.person_id).where(CopySubject.copy_id == identity))
    )


def verify_subjects(s, identity):
    row = s.get(ManagedCopy, identity)
    copies.review_database_copy(
        s,
        SCOPE,
        DatabaseCopyReview(
            copy_id=identity,
            content_hash=row.content_hash,
            person_ids=tuple(owners(s, identity)),
            evidence=EVIDENCE,
        ),
        row.revision,
        "officer",
        AT,
    )


def shared_rows(pg, monkeypatch, first, second):
    """operator-shared event (keeps operator) and a p0/p1-only entity (whole row)."""
    configured(pg, monkeypatch)
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        rule(s, "audit")
        rule(s, "compliance")
    with pg.begin() as s:
        s.add(
            PlanningOutbox(
                event_id="import-both",
                scope_id=SCOPE,
                kind="actual.import",
                actor="operator-account",
                payload={
                    "person_ids": ["p0", "p1"],
                    "count": 2,
                    "source_hash": "a" * 64,
                },
                created_at=OLD,
            )
        )
        s.add(
            ComplianceEntity(
                key="pair",
                scope_id=SCOPE,
                kind="synthetic",
                entity_id="external-pair",
                revision=1,
                payload={"person_ids": ["p0", "p1"], "value": 1},
                created_at=OLD,
            )
        )
        s.add(
            LegalHold(
                hold_id="second-hold",
                scope_id=SCOPE,
                person_id=second,
                active=True,
                revision=1,
                payload={},
            )
        )
    with pg.begin() as s:
        event, pair = (
            copy_of(s, event_id="import-both").copy_id,
            copy_of(s, key="pair").copy_id,
        )
        assert owners(s, event) == ["operator-person", "p0", "p1"] and owners(
            s, pair
        ) == ["p0", "p1"]
        verify_subjects(s, event)
        verify_subjects(s, pair)
        control(s, first)
    # First person: the other owner's hold keeps every shared row.
    assert execute(pg, first, "first-held")["erased_database_count"] == 0
    with pg.begin() as s:
        s.get(LegalHold, "second-hold").active = False
        control(s, second)
    return event, pair


def review(pg, identity, *, projection_hash="auto"):
    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        current = joint.context(s, row, AT)
        if projection_hash == "auto":
            projection_hash = (
                joint.joint_payload(s, row, current, None)["payload_hash"]
                if current["retained_owners"]
                else None
            )
        return joint.review(
            s,
            SCOPE,
            identity,
            expected_revision=row.revision,
            source_hash=row.content_hash,
            context_hash=content_hash(current),
            reason="All controlled owners reviewed; operator record kept",
            evidence=EVIDENCE,
            issuer="test",
            subject="admin",
            at=AT,
            projection_hash=projection_hash,
        )


@pytest.mark.parametrize("first,second", [("p0", "p1"), ("p1", "p0")])
def test_joint_review_erases_controlled_owners_and_keeps_operator(
    pg, monkeypatch, first, second
):
    event, pair = shared_rows(pg, monkeypatch, first, second)
    with pg() as s:
        blockers = {
            t["copy_id"]: t["blockers"]
            for t in copies.inventory(s, SCOPE, second, AT)["targets"]
        }
    assert (
        "joint_review_required" in blockers[event]
        and "joint_review_required" in blockers[pair]
    )
    review(pg, event)
    review(pg, pair)
    result = execute(pg, second, "joint")
    assert (
        result["erased_database_count"] == 2 and result["preserved_archive_count"] == 1
    )
    with pg() as s:
        assert (
            s.get(PlanningOutbox, "import-both") is None
            and s.get(ComplianceEntity, "pair") is None
        )
        assert (
            s.get(ManagedCopy, event).state == "ERASED"
            and s.get(ManagedCopy, pair).state == "ERASED"
        )
        assert s.get(ManagedCopy, pair).evidence.get("joint_erasure_intent_hash")
        archives = list(s.scalars(select(PreservedArchive)))
        assert len(archives) == 1
        body = json.dumps(archives[0].payload)
        assert "operator-person" in body and '"p0"' not in body and '"p1"' not in body
        assert archives[0].payload["replayable"] is False
        archive_copy = next(
            c
            for c in s.scalars(select(ManagedCopy))
            if c.locator.get("pk") == {"archive_id": archives[0].archive_id}
        )
        assert owners(s, archive_copy.copy_id) == ["operator-person"]
        # The first person's inventory no longer lists either shared row.
        remaining = {
            t["copy_id"] for t in copies.inventory(s, SCOPE, first, AT)["targets"]
        }
        assert not {event, pair} & remaining


def test_wrong_projection_or_missing_projection_is_refused(pg, monkeypatch):
    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    with pytest.raises(Conflict):
        review(pg, event, projection_hash="0" * 64)
    with pytest.raises(Conflict):
        review(pg, event, projection_hash=None)
    with pytest.raises(ValueError, match="no partial history"):
        review(pg, pair, projection_hash="0" * 64)
    with pg() as s:
        assert "joint_erasure_review" not in s.get(ManagedCopy, event).evidence


@pytest.mark.parametrize("change", ["late-hold", "case-revision", "content"])
def test_late_hold_keeps_the_row_and_the_barrier_forbids_rewriting_the_basis(
    pg, monkeypatch, change
):
    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    review(pg, event)
    review(pg, pair)
    if change != "late-hold":
        # The identity barrier refuses any rewrite of a controlled person's case
        # or of a row naming them, so the reviewed basis cannot change underneath.
        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError, match="prevents reintroduction"):
            with pg.begin() as s:
                if change == "case-revision":
                    s.get(PrivacyCase, "erase-p0").revision += 1
                else:
                    s.execute(
                        text(
                            "UPDATE planning_outbox SET payload = CAST(:v AS json) WHERE event_id='import-both'"
                        ),
                        {
                            "v": json.dumps(
                                {
                                    "person_ids": ["p0", "p1"],
                                    "count": 3,
                                    "source_hash": "a" * 64,
                                }
                            )
                        },
                    )
        assert execute(pg, "p1", "after-change")["erased_database_count"] == 2
        return
    with pg.begin() as s:
        s.add(
            LegalHold(
                hold_id="late",
                scope_id=SCOPE,
                person_id="operator-person",
                active=True,
                revision=1,
                payload={},
            )
        )
    result = execute(pg, "p1", "after-change")
    assert result["preserved_archive_count"] == 0
    with pg() as s:
        assert s.get(PlanningOutbox, "import-both") is not None
        assert not list(s.scalars(select(PreservedArchive)))


def test_failure_inside_execution_rolls_back_and_a_new_plan_completes(pg, monkeypatch):
    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    review(pg, event)
    review(pg, pair)
    from shift_scheduler.application import database_erasure

    original = database_erasure.erase
    calls = {"n": 0}

    def crash_once(session, copy):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("synthetic stop inside the erasure transaction")
        return original(session, copy)

    monkeypatch.setattr(database_erasure, "erase", crash_once)
    with pytest.raises(RuntimeError):
        execute(pg, "p1", "crash")
    with pg() as s:
        assert s.get(PlanningOutbox, "import-both") is not None and not list(
            s.scalars(select(PreservedArchive))
        )
    result = execute(pg, "p1", "resume")
    assert (
        result["erased_database_count"] == 2 and result["preserved_archive_count"] == 1
    )


def test_non_participant_and_unclassified_rows_have_no_joint_path(pg, monkeypatch):
    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    review(pg, event)
    with pg() as s:
        row = s.get(ManagedCopy, event)
        # The operator is an uncontrolled owner: it cannot carry out the decision.
        with pytest.raises(Conflict):
            joint.proposal(s, row, "operator-person", AT)
        row.scope_id = "__unclassified__"
        with pytest.raises(ValueError, match="Unclassified"):
            joint.context(s, row, AT)
        s.rollback()


def test_preserve_uses_only_the_review_that_approved_the_payload(pg, monkeypatch):
    from shift_scheduler.application.shared_projection import (
        joint_database_projection,
        preserve,
    )

    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    review(pg, event)
    with pg() as s:
        row = s.get(ManagedCopy, event)
        prepared = joint_database_projection(s, row, ["p0", "p1"])
        # A stale single-person approval of different content must not be used.
        row.evidence = {
            **row.evidence,
            "preservation_review": {
                "projection_hash": "0" * 64,
                "evidence": {
                    "reference": "stale single-person review",
                    "status": "verified",
                    "verified_by": "x",
                },
            },
        }
        tampered = {
            **row.evidence,
            "joint_erasure_review": {
                **row.evidence["joint_erasure_review"],
                "projection_hash": "1" * 64,
            },
        }
        row.evidence = tampered
        with pytest.raises(ValueError, match="does not approve"):
            preserve(s, row, prepared, AT)
        s.rollback()


def test_pointer_rows_have_no_joint_whole_row_erasure(pg, monkeypatch):
    """A current-input head carries owners only through its parent input; the
    joint path must not erase it as a whole row even when all owners are controlled."""

    event, pair = shared_rows(pg, monkeypatch, "p0", "p1")
    with pg() as s:
        row = s.get(ManagedCopy, pair)
        row.locator = {
            **row.locator,
            "table": "planning_input_heads",
            "pk": {"key": "x"},
        }
        with pytest.raises(ValueError, match="reviewed row schema"):
            joint.context(s, row, AT)
        s.rollback()
