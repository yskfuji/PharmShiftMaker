"""Counterexamples spanning corrections, delivery failure and long-lived revisions."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from shift_scheduler.application import planning as service
from shift_scheduler.application.outbox import deliver_batch
from shift_scheduler.db.planning_models import (
    LeaveBalance,
    PlanningOutbox,
    PlanningPublication,
    PlanningScope,
)
from shift_scheduler.domain.planning import (
    Duty,
    LeaveAllocation,
    LeaveGrant,
    Preference,
    Proposal,
    SolverSnapshot,
)
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.test_reviewed_planning import db as _isolated_db
from tests.test_reviewed_planning import snapshot

db = _isolated_db


def publish(session, data, revision=0, key="publication-request"):
    scope = "hospital/pharmacy"
    current_scope = session.get(PlanningScope, scope)
    revision = current_scope.input_revision if current_scope else revision
    service.register_input(session, data, "admin", revision)
    if service.published_context(session, data)[0]:
        refreshed = service.refresh_input(session, scope, "admin", revision + 1)
        data = SolverSnapshot.model_validate(
            service.require_input(session, refreshed["input_hash"], scope).payload
        )
    row = service.require_input(session, data.input_hash, scope)
    result = solve(data, 5)
    assert result.proposal is not None
    draft = service.new_draft(session, row, result.proposal, "leader")
    review = service.review_draft(session, draft.draft_id, scope, 1, "leader")
    assert review["publishable"]
    return service.publish(
        session,
        draft.draft_id,
        scope,
        "leader",
        1,
        0,
        data.input_hash,
        review["review_hash"],
        key,
    )


def test_actual_replaces_same_id_counts_for_coverage_and_volume(db):
    data = snapshot(1, 1)
    preference = Preference(
        person_id="p0", start=data.period.start, end=data.period.end, rank=2
    )
    data = data.model_copy(update={"preferences": (preference,)})
    with db.begin() as session:
        service.register_input(session, data, "admin", 0)
        actual = data.candidates[0].model_copy(update={"source": "actual"})
        service.import_actual(
            session, "hospital/pharmacy", "admin", "clock-1", 1, actual
        )
        refreshed = service.refresh_input(session, "hospital/pharmacy", "admin", 2)
        row = service.require_input(
            session, refreshed["input_hash"], "hospital/pharmacy"
        )
        current = SolverSnapshot.model_validate(row.payload)
        assert not current.candidates
        assert current.preferences == (preference,)
        assert validate(current, Proposal()).publishable
        assert solve(current, 5).status == "OPTIMAL"
        corrected = actual.model_copy(update={"duty_id": "corrected-id"})
        service.import_actual(
            session, "hospital/pharmacy", "admin", "clock-1", 2, corrected
        )
        again = service.refresh_input(session, "hospital/pharmacy", "admin", 4)
        payload = service.require_input(
            session, again["input_hash"], "hospital/pharmacy"
        ).payload
        assert [d["duty_id"] for d in payload["history"]] == ["corrected-id"]


def test_settlement_cannot_consume_or_cancel_other_publication_reservation(db):
    data = snapshot(2, 1)
    grant = LeaveGrant(
        grant_id="g",
        person_id="p0",
        employer_id="hospital",
        amount=3,
        granted_on=date(2026, 1, 1),
        expires_on=date(2028, 1, 1),
        evidence=data.policy_evidence,
    )
    leave = LeaveAllocation(
        allocation_id="a",
        grant_id="g",
        person_id="p0",
        amount=1,
        start=data.period.start,
        end=data.period.end,
        decision=data.policy_evidence,
    )
    data = data.model_copy(update={"grants": (grant,), "leaves": (leave,)})
    with db.begin() as session:
        publication = publish(session, data)
        balance = session.get(LeaveBalance, "g")
        # Simulate another month's reservation. This cannot authorize overconsumption here.
        balance.reserved += 1
        session.flush()
        with pytest.raises(service.Conflict):
            service.settle_leave(
                session,
                "hospital/pharmacy",
                "admin",
                "g",
                "too-many",
                "consume",
                2,
                balance.revision,
                publication["publication_id"],
            )
        service.settle_leave(
            session,
            "hospital/pharmacy",
            "admin",
            "g",
            "actual-1",
            "consume",
            1,
            balance.revision,
            publication["publication_id"],
        )
    with db.begin() as session, pytest.raises(service.Conflict):
        service.cancel_publication(
            session,
            publication["publication_id"],
            "hospital/pharmacy",
            "admin",
            1,
            "counterexample",
        )
    with db.begin() as session:
        balance = session.get(LeaveBalance, "g")
        service.settle_leave(
            session,
            "hospital/pharmacy",
            "admin",
            "g",
            "reverse-1",
            "reverse",
            1,
            balance.revision,
            publication["publication_id"],
        )
        service.cancel_publication(
            session,
            publication["publication_id"],
            "hospital/pharmacy",
            "admin",
            1,
            "reconciled",
        )
        assert session.get(LeaveBalance, "g").reserved == 1


def test_outbox_failure_replays_identical_event_id(db):
    with db.begin() as session:
        service.emit(session, "hospital/pharmacy", "test", "test", {"value": 1})
    received = []

    def fail(event):
        received.append(event["event_id"])
        raise ConnectionError("Lost acknowledgement")

    with pytest.raises(ConnectionError), db.begin() as session:
        deliver_batch(session, fail)
    with db.begin() as session:
        assert (
            deliver_batch(session, lambda event: received.append(event["event_id"]))
            == 1
        )
    assert received[0] == received[1]
    with db.begin() as session:
        assert (
            deliver_batch(
                session, lambda _: pytest.fail("Duplicate acknowledged event")
            )
            == 0
        )


def test_republication_credits_own_reservation_without_double_debit(db):
    data = snapshot(2, 1)
    grant = LeaveGrant(
        grant_id="one-day",
        person_id="p0",
        employer_id="hospital",
        amount=1,
        granted_on=date(2026, 1, 1),
        expires_on=date(2028, 1, 1),
        evidence=data.policy_evidence,
    )
    allocation = LeaveAllocation(
        allocation_id="one-allocation",
        grant_id="one-day",
        person_id="p0",
        amount=1,
        start=data.period.start,
        end=data.period.end,
        decision=data.policy_evidence,
    )
    data = data.model_copy(update={"grants": (grant,), "leaves": (allocation,)})
    with db.begin() as session:
        publish(session, data)
        current = service.refresh_input(session, "hospital/pharmacy", "admin", 1)
        row = service.require_input(session, current["input_hash"], "hospital/pharmacy")
        refreshed = SolverSnapshot.model_validate(row.payload)
        published_duties = session.scalar(select(PlanningPublication)).payload[
            "assignments"
        ]
        assert set(refreshed.previous_duty_ids) == {
            d["duty_id"] for d in published_duties
        }
        result = solve(refreshed, 5)
        assert result.validation.publishable
        draft = service.new_draft(session, row, result.proposal, "leader")
        review = service.review_draft(
            session, draft.draft_id, "hospital/pharmacy", 1, "leader"
        )
        service.publish(
            session,
            draft.draft_id,
            "hospital/pharmacy",
            "leader",
            1,
            1,
            row.input_hash,
            review["review_hash"],
            "republication-request",
        )
        balance = session.get(LeaveBalance, "one-day")
        assert (balance.reserved, balance.consumed) == (1, 0)


def test_published_context_refresh_and_cancellation_invalidate_review(db):
    first = snapshot(2, 1)
    second = snapshot(2, 2)
    second = second.model_copy(
        update={
            "period": second.period.model_copy(
                update={"start": second.period.start + timedelta(days=1)}
            ),
            "candidates": tuple(
                d for d in second.candidates if d.start >= first.period.end
            ),
            "demands": tuple(d for d in second.demands if d.start >= first.period.end),
            "contracts": first.contracts,
            "capabilities": first.capabilities,
        }
    )
    scope = "hospital/pharmacy"
    with db.begin() as session:
        # Preparing a following period before publication is legitimate.
        service.register_input(session, first, "admin", 0)
        service.register_input(session, second, "admin", 1)
        publication = publish(session, first, key="first-day")
        with pytest.raises(service.Conflict, match="Published context changed"):
            service.enqueue(
                session, second.input_hash, scope, "leader", "omitted-history", 5
            )
        current_revision = session.get(PlanningScope, scope).input_revision
        refreshed = service.refresh_input(
            session, scope, "admin", current_revision, second.input_hash
        )
        row = service.require_input(session, refreshed["input_hash"], scope)
        data = SolverSnapshot.model_validate(row.payload)
        assert any(d.source == "published" and d.fixed for d in data.history)
        result = solve(data, 5)
        assert result.validation.publishable
        draft = service.new_draft(session, row, result.proposal, "leader")
        review = service.review_draft(session, draft.draft_id, scope, 1, "leader")
        assert review["publishable"]
        service.cancel_publication(
            session,
            publication["publication_id"],
            scope,
            "leader",
            1,
            "test cancellation",
        )
        with pytest.raises(service.Conflict, match="Published context changed"):
            service.publish(
                session,
                draft.draft_id,
                scope,
                "leader",
                1,
                0,
                row.input_hash,
                review["review_hash"],
                "stale-context",
            )
        refreshed = service.refresh_input(
            session,
            scope,
            "admin",
            session.get(PlanningScope, scope).input_revision,
            row.input_hash,
        )
        data = SolverSnapshot.model_validate(
            service.require_input(session, refreshed["input_hash"], scope).payload
        )
        assert not any(d.duty_id.startswith("publication:") for d in data.history)
        assert solve(data, 5).validation.publishable


def test_26_calendar_month_publications_reconcile_immutable_events(db):
    """26 months of transaction lifecycle, not a representative staffing benchmark."""
    base = snapshot(2, 1)
    total_seconds = 0
    for offset in range(26):
        month_index = 2026 * 12 + offset
        start = base.period.start.replace(
            year=month_index // 12, month=month_index % 12 + 1, day=5
        )
        delta = start - base.period.start

        def shift(obj, delta=delta):
            updates = {"start": obj.start + delta, "end": obj.end + delta}
            if hasattr(obj, "work"):
                updates.update(
                    work=tuple(shift(w) for w in obj.work),
                    breaks=tuple(shift(w) for w in obj.breaks),
                )
            return obj.model_copy(update=updates)

        data = base.model_copy(
            update={
                "source_revision": offset,
                "period": shift(base.period),
                "context": shift(base.context),
                "contracts": tuple(shift(c) for c in base.contracts),
                "capabilities": tuple(shift(c) for c in base.capabilities),
                "candidates": tuple(shift(d) for d in base.candidates),
                "demands": tuple(shift(d) for d in base.demands),
            }
        )
        with db.begin() as session:
            result = publish(session, data, offset, f"month-{offset:03d}")
            row = session.get(PlanningPublication, result["publication_id"])
            total_seconds += sum(
                Duty.model_validate(d).work_seconds for d in row.payload["assignments"]
            )

    with db() as session:
        assert len(session.scalars(select(PlanningPublication)).all()) == 26
        assert session.get(PlanningScope, "hospital/pharmacy").input_revision == 51
        events = session.scalars(
            select(PlanningOutbox).where(PlanningOutbox.kind == "schedule.published")
        ).all()
        assert len({e.payload["publication_id"] for e in events}) == 26
        # Each of 26 one-day fixtures needs one or more exact four-hour duties.
        assert total_seconds >= 26 * 4 * 3600
