"""Real PostgreSQL counterexample: separate periods compete for one grant."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from shift_scheduler.application import planning as service
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.domain.compliance import SolverSnapshotV2
from shift_scheduler.domain.planning import Interval, Proposal
from tests.test_compliance_v2 import leave_event, leave_fixture
from tests.test_planning_postgres import pg as _pg

pg = _pg


def test_two_period_reservations_have_one_winner(pg):
    original = leave_fixture()
    prepared = []
    scope = "hospital/pharmacy"
    for i in (0, 1):
        start = original.period.start + timedelta(days=i)
        period = Interval(start=start, end=start + timedelta(days=1))
        candidate = original.candidates[i]
        event = {
            **leave_event("reserve-" + str(i), "reserve"),
            "effective_on": start.date().isoformat(),
            "interval": period.model_dump(mode="json"),
        }
        payload = original.model_dump(mode="json")
        payload.update(
            period=period.model_dump(mode="json"),
            candidates=[candidate.model_dump(mode="json")],
            demands=[],
            work_terms=[original.work_terms[i].model_dump(mode="json")],
            leave_obligations=[],
            leave_accounts=[
                {**payload["leave_accounts"][0], "statutory_days": 1, "granted_days": 1}
            ],
            leave_records=[event],
        )
        data = SolverSnapshotV2.model_validate(payload)
        with pg.begin() as session:
            service.register_input(session, data, "admin", i)
            draft = service.new_draft(
                session,
                service.require_input(session, data.input_hash, scope),
                Proposal(),
                "admin",
            )
            session.flush()
            review = service.review_draft(session, draft.draft_id, scope, 1, "admin")
            assert review["publishable"], review
            prepared.append((draft.draft_id, data.input_hash, review["review_hash"]))
    barrier = Barrier(2)

    def attempt(index):
        barrier.wait()
        draft, identity, review = prepared[index]
        try:
            with pg.begin() as session:
                return service.publish(
                    session,
                    draft,
                    scope,
                    "admin",
                    1,
                    0,
                    identity,
                    review,
                    "race-" + str(index),
                )
        except (service.Conflict, IntegrityError):
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(attempt, [0, 1]))
    assert sum(result is not None for result in results) == 1
    with pg() as session:
        events = session.scalars(
            select(ComplianceEntity).where(ComplianceEntity.kind == "leave_record")
        ).all()
        assert len(events) == 1 and events[0].payload["kind"] == "reserve"
