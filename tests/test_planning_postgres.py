"""Real PostgreSQL tests: each run owns a new random schema, never existing data."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from shift_scheduler.application import planning as service
from shift_scheduler.db.planning_models import (
    LeaveBalance,
    PlanningOutbox,
    PlanningPublication,
)
from shift_scheduler.domain.planning import (
    LeaveAllocation,
    LeaveGrant,
    Proposal,
    SolverSnapshot,
)
from tests.test_reviewed_planning import snapshot


@pytest.fixture
def pg(monkeypatch):
    url = os.getenv("PHARMSHIFT_TEST_PG_URL")
    if not url:
        pytest.skip(
            "Set PHARMSHIFT_TEST_PG_URL to an isolated PostgreSQL test database"
        )
    # An explicit test DB name is a guard against pointing this fixture at production.
    if "pharmshift_audit" not in url:
        pytest.fail("Test database name must contain pharmshift_audit")
    schema = "audit_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped_url = url + "?options=-csearch_path%3D" + schema
    monkeypatch.setenv("DATABASE_URL", scoped_url)
    monkeypatch.setenv("SHIFT_SCHEDULER_DB_URL", scoped_url)
    engine = create_engine(scoped_url)
    try:
        command.upgrade(Config("alembic.ini"), "head")
        yield sessionmaker(engine, expire_on_commit=False)
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def prepare(factory, data, revision=0):
    proposal = Proposal(
        duty_ids=(data.candidates[0].duty_id,),
        leave_ids=tuple(a.allocation_id for a in data.leaves),
    )
    with factory.begin() as session:
        service.register_input(session, data, "admin", revision)
        row = service.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = service.new_draft(session, row, proposal, "leader")
        session.flush()
        review = service.review_draft(
            session, draft.draft_id, "hospital/pharmacy", 1, "leader"
        )
        assert review["publishable"], review
        return draft.draft_id, review["review_hash"]


def test_concurrent_publication_has_one_winner(pg):
    data = snapshot(2, 1)
    draft, review = prepare(pg, data)
    barrier = Barrier(2)

    def attempt(key):
        barrier.wait()
        try:
            with pg.begin() as session:
                return service.publish(
                    session,
                    draft,
                    "hospital/pharmacy",
                    "leader",
                    1,
                    0,
                    data.input_hash,
                    review,
                    key,
                )
        except (service.Conflict, IntegrityError):
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, ["first-key", "second-key"]))
    assert sum(r is not None for r in results) == 1
    with pg() as session:
        assert len(session.scalars(select(PlanningPublication)).all()) == 1
        assert (
            len(
                session.scalars(
                    select(PlanningOutbox).where(
                        PlanningOutbox.kind == "schedule.published"
                    )
                ).all()
            )
            == 1
        )


def test_two_months_share_one_leave_balance(pg):
    first = snapshot(2, 1)
    evidence = first.policy_evidence
    grant = LeaveGrant(
        grant_id="annual-2026-p1",
        person_id="p1",
        employer_id="hospital",
        granted_on=date(2025, 1, 1),
        expires_on=date(2027, 1, 1),
        amount=1,
        evidence=evidence,
    )
    leave = LeaveAllocation(
        allocation_id="leave-jan",
        grant_id=grant.grant_id,
        person_id="p1",
        start=first.period.start,
        end=first.period.end,
        amount=1,
        decision=evidence,
    )
    first = first.model_copy(update={"grants": (grant,), "leaves": (leave,)})
    jan, jan_review = prepare(pg, first)
    payload = first.model_dump(mode="json")
    # Move only period-specific duties, demand and leave; canonical contracts remain identical.
    shift = timedelta(days=28)
    payload["period"] = {
        "start": first.period.start + shift,
        "end": first.period.end + shift,
    }
    payload["context"] = {
        # Keep the contexts independent so this race specifically exercises the
        # shared leave balance, rather than stale published-history rejection.
        "start": first.period.start + shift - timedelta(days=7),
        "end": first.context.end + shift,
    }
    for key in ("candidates", "demands", "leaves"):
        for item in payload[key]:
            from datetime import datetime

            for boundary in ("start", "end"):
                item[boundary] = datetime.fromisoformat(item[boundary]) + shift
            if key == "candidates":
                for part in item["work"]:
                    for boundary in ("start", "end"):
                        part[boundary] = datetime.fromisoformat(part[boundary]) + shift
    second = SolverSnapshot.model_validate(payload)
    feb, feb_review = prepare(pg, second, 1)
    barrier = Barrier(2)

    def attempt(args):
        data, draft, review, key = args
        barrier.wait()
        try:
            with pg.begin() as session:
                return service.publish(
                    session,
                    draft,
                    "hospital/pharmacy",
                    "leader",
                    1,
                    0,
                    data.input_hash,
                    review,
                    key,
                )
        except (service.Conflict, IntegrityError):
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                attempt,
                [
                    (first, jan, jan_review, "january-key"),
                    (second, feb, feb_review, "february-key"),
                ],
            )
        )
    assert sum(r is not None for r in results) == 1
    with pg() as session:
        balance = session.get(LeaveBalance, grant.grant_id)
        assert balance.reserved == 1 and balance.consumed == 0
        assert len(session.scalars(select(PlanningPublication)).all()) == 1
