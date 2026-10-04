"""Independent positive/negative controls for reviewed publication and interval plans."""

from datetime import datetime, timedelta
from itertools import product
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from shift_scheduler.application import planning as service
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import (
    PlanningDraft,
    PlanningOutbox,
    PlanningPublication,
)
from shift_scheduler.domain.planning import (
    Capability,
    ContractRevision,
    Demand,
    Duty,
    Evidence,
    Interval,
    Person,
    Proposal,
    SolverSnapshot,
)
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate

JST = ZoneInfo("Asia/Tokyo")


def snapshot(n=2, days=2):
    start = datetime(2026, 1, 5, tzinfo=JST)
    end = start + timedelta(days=days)
    evidence = Evidence(
        reference="synthetic-confirmed-test-only",
        status="verified",
        verified_by="test-oracle",
    )
    people = tuple(Person(person_id=f"p{i}", name=f"Person {i}") for i in range(n))
    contracts = tuple(
        ContractRevision(
            revision_id=f"c{i}",
            relationship_id=f"e{i}",
            person_id=p.person_id,
            employer_id="hospital",
            facility_id="hospital",
            department_id="pharmacy",
            start=start - timedelta(days=400),
            end=end + timedelta(days=400),
            evidence=evidence,
            regime_evidence=evidence,
            external_work_confirmed=True,
            period_max_seconds=days * 4 * 3600,
            contractual_week_seconds=20 * 3600,
            rest_seconds=11 * 3600,
        )
        for i, p in enumerate(people)
    )
    capabilities = tuple(
        Capability(
            person_id=p.person_id,
            task="dispensing",
            location="main",
            start=start - timedelta(days=400),
            end=end + timedelta(days=400),
            evidence=evidence,
        )
        for p in people
    )
    duties, demands = [], []
    for day in range(days):
        a = start + timedelta(days=day, hours=9)
        b = a + timedelta(hours=4)
        span = Interval(start=a, end=b)
        demands.append(
            Demand(
                demand_id=f"d{day}",
                start=a,
                end=b,
                task="dispensing",
                location="main",
                minimum=1,
                target=1,
                evidence=evidence,
            )
        )
        for i, p in enumerate(people):
            duties.append(
                Duty(
                    duty_id=f"p{i}d{day}",
                    person_id=p.person_id,
                    relationship_id=f"e{i}",
                    kind="DAY",
                    location="main",
                    task="dispensing",
                    start=a,
                    end=b,
                    work=(span,),
                )
            )
    return SolverSnapshot(
        facility_id="hospital",
        department_id="pharmacy",
        lookahead_days=0,
        period=Interval(start=start, end=end),
        context=Interval(
            start=start - timedelta(days=400), end=end + timedelta(days=14)
        ),
        rule_revision="general-test-v1",
        policy_evidence=evidence,
        history_complete=True,
        candidate_catalog_complete=True,
        people=people,
        contracts=contracts,
        capabilities=capabilities,
        candidates=tuple(duties),
        demands=tuple(demands),
    )


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'isolated.db'}")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def test_positive_control_and_empty_coverage_counterexample():
    data = snapshot()
    assert not validate(data, Proposal()).publishable
    result = solve(data, 5)
    assert result.status == "OPTIMAL"
    assert result.proven_levels == 3
    assert result.validation.publishable
    assert result.proposal is not None


def test_tiny_feasibility_matches_enumeration():
    for n, days in product((1, 2), (1, 2, 3)):
        data = snapshot(n, days)
        feasible = []
        for bits in product((False, True), repeat=len(data.candidates)):
            p = Proposal(
                duty_ids=tuple(
                    d.duty_id for d, b in zip(data.candidates, bits, strict=False) if b
                )
            )
            if validate(data, p).publishable:
                feasible.append(p)
        result = solve(data, 5)
        assert bool(feasible) == (result.proposal is not None)
        if result.proposal:
            assert result.proposal in feasible


def test_unknown_and_unverified_not_infeasible():
    data = snapshot().model_copy(update={"history_complete": False})
    assert solve(data).status == "BLOCKED"
    assert not validate(data, Proposal(duty_ids=("p0d0", "p0d1"))).publishable


def test_contract_candidate_zero_not_ignored():
    data = snapshot(1, 1)
    c = data.contracts[0].model_copy(
        update={"period_min_seconds": 1, "allowed_kinds": ("NIGHT",)}
    )
    data = data.model_copy(update={"contracts": (c,)})
    assert solve(data, 2).status == "INFEASIBLE"


def test_midnight_not_daily_limit_reset():
    data = snapshot(1, 1)
    d = data.candidates[0]
    start = d.start.replace(hour=20)
    end = start + timedelta(hours=10)
    rest = Interval(start=start + timedelta(hours=4), end=start + timedelta(hours=5))
    night = d.model_copy(
        update={
            "start": start,
            "end": end,
            "work": (
                Interval(start=start, end=rest.start),
                Interval(start=rest.end, end=end),
            ),
            "breaks": (rest,),
        }
    )
    data = data.model_copy(update={"candidates": (night,), "demands": ()})
    report = validate(data, Proposal(duty_ids=(night.duty_id,)))
    assert any(f.rule_id == "work.general" for f in report.findings)


def test_publication_is_same_reviewed_proposal_and_idempotent(db):
    data = snapshot()
    proposal = solve(data, 5).proposal
    with db.begin() as session:
        service.register_input(session, data, "admin", 0)
        row = service.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = service.new_draft(session, row, proposal, "leader")
        draft_id = draft.draft_id
    with db.begin() as session:
        review = service.review_draft(
            session, draft_id, "hospital/pharmacy", 1, "leader"
        )
        assert review["publishable"]
    args = (
        draft_id,
        "hospital/pharmacy",
        "leader",
        1,
        0,
        data.input_hash,
        review["review_hash"],
        "request-unique",
    )
    with db.begin() as session:
        first = service.publish(session, *args)
    with db.begin() as session:
        second = service.publish(session, *args)
        assert first == second
        publications = session.scalars(select(PlanningPublication)).all()
        assert len(publications) == 1
        assert publications[0].payload["proposal"] == proposal.model_dump(mode="json")
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


def test_edit_clears_review_and_stale_input_blocks(db):
    data = snapshot()
    proposal = solve(data, 5).proposal
    with db.begin() as session:
        service.register_input(session, data, "admin", 0)
        row = service.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = service.new_draft(session, row, proposal, "leader")
        session.flush()
        draft_id = draft.draft_id
        review = service.review_draft(
            session, draft_id, "hospital/pharmacy", 1, "leader"
        )
    with db.begin() as session:
        service.edit_draft(
            session, draft_id, "hospital/pharmacy", Proposal(), 1, "leader"
        )
    with db.begin() as session:
        draft = session.get(PlanningDraft, draft_id)
        assert draft.reviewed_hash is None
        assert draft.proposal["duty_ids"] == []
        with pytest.raises(service.Conflict):
            service.publish(
                session,
                draft_id,
                "hospital/pharmacy",
                "leader",
                1,
                0,
                data.input_hash,
                review["review_hash"],
                "not-same-key",
            )


def test_no_cross_scope_lookup(db):
    data = snapshot()
    with db.begin() as session:
        service.register_input(session, data, "admin", 0)
    with db() as session, pytest.raises(LookupError):
        service.require_input(session, data.input_hash, "another/pharmacy")


def test_job_lease_and_cancel_suppress_late_result(db):
    data = snapshot()
    with db.begin() as session:
        service.register_input(session, data, "admin", 0)
        job = service.enqueue(
            session,
            data.input_hash,
            "hospital/pharmacy",
            "leader",
            "job-idempotency",
            5,
        )
        job_id = job.job_id
    with db.begin() as session:
        claim = service.claim_job(session)
        assert claim and claim[0] == job_id
    from shift_scheduler.db.planning_models import PlanningJob

    with db.begin() as session:
        assert service.claim_job(session) is None
        session.get(PlanningJob, job_id).status = "CANCELLED"
    with db.begin() as session:
        assert service.finish_job(session, job_id, claim[1], solve(data, 2)) is None
        assert not session.scalars(select(PlanningDraft)).all()


def test_api_membership_and_full_review_flow(db):
    from fastapi.testclient import TestClient

    from shift_scheduler.api.main import app
    from shift_scheduler.api.routers.planning import transaction
    from shift_scheduler.db.planning_models import AccountMembership

    def isolated():
        with db.begin() as session:
            yield session

    app.dependency_overrides[transaction] = isolated
    try:
        with db.begin() as session:
            session.add(
                AccountMembership(
                    membership_id="admin-test",
                    issuer="mock",
                    subject="admin",
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                )
            )
        client = TestClient(app, headers={"Origin": "https://localhost:3000"})
        assert (
            client.post(
                "/auth/login", json={"username": "admin", "password": "pass-admin"}
            ).status_code
            == 200
        )
        data = snapshot()
        assert (
            client.post(
                "/planning/inputs",
                json={"snapshot": data.model_dump(mode="json"), "expected_revision": 0},
            ).status_code
            == 200
        )
        query = "?scope_id=hospital%2Fpharmacy"
        result = solve(data, 5)
        draft = client.post(
            "/planning/drafts" + query,
            json={
                "idempotency_key": "api-create-draft",
                "input_hash": data.input_hash,
                "proposal": result.proposal.model_dump(mode="json"),
            },
        ).json()
        review = client.post(
            "/planning/drafts/" + draft["draft_id"] + "/review" + query,
            json={"version": 1, "idempotency_key": "api-review-draft"},
        )
        assert review.status_code == 200, review.text
        response = client.post(
            "/planning/drafts/" + draft["draft_id"] + "/publish" + query,
            json={
                "version": 1,
                "expected_publication_version": 0,
                "input_hash": data.input_hash,
                "review_hash": review.json()["review_hash"],
                "idempotency_key": "api-publication",
            },
        )
        assert response.status_code == 200, response.text
        saved = client.get("/planning/publications" + query).json()
        assert len(saved) == 1
        assert (
            client.get("/planning/publications?scope_id=other%2Fpharmacy").status_code
            == 403
        )
        assert client.post("/auth/logout").status_code == 204
    finally:
        app.dependency_overrides.pop(transaction, None)
