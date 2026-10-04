"""Facility adoption of flextime: off by default, registered by one administrator
and confirmed by another, with the impact reviewed first (労基法32条の3, 則12条の3;
MHLW flextime guide p.5-11; OWASP ASVS 5.0 V2.3.1/V2.3.5/V8.2.1/V16.2.1; user
decisions 2026-09-28). Synthetic data only.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import (
    FlexAdoption,
    FlexEnrollment,
    SolverSnapshotV3,
    settlement_starts,
)
from shift_scheduler.validation.work_accounting import account_work, input_findings
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade
from tests.test_flextime import EVIDENCE, HOUR, adopt, flex_payload

JST = ZoneInfo("Asia/Tokyo")


def adoption(**change):
    values = {
        "adoption_id": "flex-1",
        "employer_id": "A",
        "establishment_id": "site-A",
        "start": "2026-04-01T00:00:00+09:00",
        "end": "2027-04-01T00:00:00+09:00",
        "target_scope": "pharmacists of the dispensary",
        "settlement_months": 1,
        "settlement_anchor": "2026-04-01",
        "total_hours_rule": "statutory_frame",
        "agreed_total_description": "40h x days / 7",
        "standard_day_seconds": 8 * HOUR,
        "work_rules_evidence": EVIDENCE,
        "agreement_evidence": EVIDENCE,
        "created_by": "admin",
        "created_at": "2026-03-01T09:00:00+09:00",
        **change,
    }
    return FlexAdoption(**values)


# --- the record -----------------------------------------------------------


@pytest.mark.parametrize(
    "change",
    [
        {"start": "2026-04-02T00:00:00+09:00"},  # not the settlement anchor
        {
            "core_time": [{"start": "10:00", "end": "15:00"}]
        },  # core without flexible time
        {
            "flexible_time": [{"start": "07:00", "end": "10:00"}],
            "core_time": [{"start": "09:00", "end": "11:00"}],
        },  # core outside flexible time
        {
            "flexible_time": [{"start": "06:00", "end": "22:00"}],
            "core_time": [{"start": "09:00", "end": "17:00"}],
        },  # core as long as the standard day
        {"settlement_months": 3},  # >1 month needs filing, validity
        {
            "total_hours_rule": "full_two_day_weekend",
            "rest_weekdays": [6],
        },  # needs two rest weekdays
        {
            "total_hours_rule": "statutory_frame",
            "rest_weekdays": [5, 6],
        },  # rest days only for the special rule
        {
            "status": "confirmed",
            "reviewed_by": "admin",
            "reviewed_at": "2026-03-02T09:00:00+09:00",
        },  # self-review
        {"status": "withdrawn"},  # no withdrawer or reason
    ],
)
def test_invalid_adoptions_are_refused(change):
    with pytest.raises(ValueError):
        adoption(**change)


def test_a_valid_adoption_with_core_time_and_a_three_month_filing():
    a = adoption(
        settlement_months=3,
        agreement_valid_until="2027-03-31",
        filing={
            "filed_on": "2026-03-15",
            "office": "synthetic office",
            "evidence": EVIDENCE,
        },
        flexible_time=[{"start": "07:00", "end": "20:00"}],
        core_time=[{"start": "10:00", "end": "15:00"}],
        status="confirmed",
        reviewed_by="leader",
        reviewed_at="2026-03-02T09:00:00+09:00",
    )
    assert sorted(settlement_starts(a))[:3] == [
        datetime(2026, 4, 1).date(),
        datetime(2026, 7, 1).date(),
        datetime(2026, 10, 1).date(),
    ]
    with pytest.raises(ValueError):  # the adoption may not outlast the agreement
        adoption(
            settlement_months=3,
            agreement_valid_until="2026-12-31",
            end="2027-04-01T00:00:00+09:00",
            filing={"filed_on": "2026-03-15", "office": "o", "evidence": EVIDENCE},
        )


def test_inputs_without_flextime_records_keep_their_hash():
    from scripts.remediation_fixture import snapshot

    data = snapshot()
    dumped = data.model_dump(mode="json")
    assert "flex_adoptions" not in dumped and "flex_enrollments" not in dumped
    assert parse_snapshot(dumped).input_hash == data.input_hash


def test_an_enrolment_must_start_on_a_settlement_day_within_the_adoption():
    payload = flex_payload([("A", 0, 9, 8, 8)])
    payload["flex_enrollments"][0]["start"] = "2026-01-02T00:00:00+09:00"
    with pytest.raises(ValueError):
        SolverSnapshotV3.model_validate(payload)
    payload = flex_payload([("A", 0, 9, 8, 8)])
    payload["flex_adoptions"][0]["establishment_id"] = "elsewhere"
    with pytest.raises(ValueError):
        SolverSnapshotV3.model_validate(payload)


# --- findings: off by default ------------------------------------------------


def messages(payload):
    return [(f.status, f.message) for f in input_findings(parse_snapshot(payload))]


def test_flextime_without_a_confirmed_adoption_is_not_adopted():
    for change in ({"flex_adoptions": [], "flex_enrollments": []},):
        payload = flex_payload([("A", 0, 9, 8, 8)])
        payload.update(change)
        assert any(
            s == "unverified" and "Flextime is not adopted" in m
            for s, m in messages(payload)
        )
    withdrawn = flex_payload([("A", 0, 9, 8, 8)])
    withdrawn["flex_adoptions"][0].update(
        status="withdrawn",
        decided_by="admin-a",
        decided_at="2025-12-20T09:00:00+09:00",
        withdrawal_reason="synthetic",
    )
    assert any("Flextime is not adopted" in m for _, m in messages(withdrawn))
    pending = flex_payload([("A", 0, 9, 8, 8)])
    for key in ("reviewed_by", "reviewed_at"):
        pending["flex_enrollments"][0].pop(key)
    pending["flex_enrollments"][0]["status"] = "registered"
    assert any("Flextime is not adopted" in m for _, m in messages(pending))
    assert not any(
        "Flextime is not adopted" in m
        for _, m in messages(flex_payload([("A", 0, 9, 8, 8)]))
    )


def test_terms_differing_from_the_adoption_or_a_late_filing_are_violations():
    payload = flex_payload([("A", 0, 9, 8, 8)])
    payload["flex_adoptions"][0].update(
        settlement_months=1,
        total_hours_rule="full_two_day_weekend",
        rest_weekdays=[5, 6],
    )
    assert any(
        s == "violation" and "differ from the confirmed adoption" in m
        for s, m in messages(payload)
    )
    late = flex_payload([("A", 0, 9, 8, 8)], flex_months=3)
    late["flex_adoptions"][0]["filing"]["filed_on"] = "2026-01-10"
    assert any(
        s == "violation" and "filed after the adoption started" in m
        for s, m in messages(late)
    )
    draft = flex_payload([("A", 0, 9, 8, 8)])
    draft["flex_adoptions"][0]["agreement_evidence"] = {"reference": "draft"}
    assert any(
        s == "unverified" and "adoption work rules, agreement or filing unverified" in m
        for s, m in messages(draft)
    )


def test_a_flextime_contract_with_planned_minimum_hours_is_a_violation():
    payload = flex_payload([("A", 0, 9, 8, 8)])
    payload["contracts"][0].update(regime="flex", period_min_seconds=HOUR)
    assert any(
        s == "violation" and "cannot require planned minimum hours" in m
        for s, m in messages(payload)
    )


# --- the switch from standard hours ----------------------------------------------


def switch_payload(anchor="2026-01-08"):
    """Standard hours to Jan 8, flextime from Jan 8 (a Thursday; weeks start on Monday)."""
    payload = upgrade(
        work_fixture([("A", 0, 9, 8, 8), ("A", 4, 9, 12, 0)], orders=(1,))
    )
    first = payload["employments"][0]
    first["end"] = f"{anchor}T00:00:00+09:00"
    second = dict(
        first,
        revision_id="emp-A2",
        start=f"{anchor}T00:00:00+09:00",
        end="2026-01-26T00:00:00+09:00",
        working_time_system="flex",
        flex_anchor=anchor,
        flex_months=1,
        variable_evidence=EVIDENCE,
    )
    payload["employments"].append(second)
    payload["work_terms"][1].update(employment_revision_id="emp-A2", scheduled_work=[])
    payload["flex_adoptions"], payload["flex_enrollments"] = [], []
    payload["employments"][0], payload["employments"][1] = (
        second,
        first,
    )  # adopt() reads the first
    adopt(payload)
    payload["employments"][0], payload["employments"][1] = first, second
    return payload


def test_a_switch_on_the_first_day_of_a_settlement_period_is_accounted():
    data = parse_snapshot(switch_payload())
    result = account_work(
        data, [d.model_copy(update={"source": "actual"}) for d in data.candidates]
    )
    statuses = [(f.status, f.message) for f in result["findings"]]
    assert not any(s == "unsupported" for s, _ in statuses), statuses
    assert any(
        s == "unverified" and "week of the switch to flextime" in m for s, m in statuses
    )
    assert [s["kind"] for s in result["settlements"]] == ["flextime"]
    by_duty = {r["duty_id"]: r["overtime_seconds"] for r in result["trace"]}
    assert by_duty["1"] == 0  # a 12h flextime day is not daily overtime


def test_a_switch_within_a_settlement_period_is_not_supported():
    payload = switch_payload()
    for e in payload["employments"]:
        if e.get("working_time_system") == "flex":
            e["flex_anchor"] = "2026-01-01"
    payload["flex_adoptions"][0].update(
        settlement_anchor="2026-01-01", start="2026-01-01T00:00:00+09:00"
    )
    payload["flex_enrollments"][0]["start"] = "2026-01-01T00:00:00+09:00"
    data = parse_snapshot(payload)
    result = account_work(
        data, [d.model_copy(update={"source": "actual"}) for d in data.candidates]
    )
    assert any(
        f.status == "unsupported" and "mixed system" in f.message
        for f in result["findings"]
    )


# --- the two-administrator procedure over HTTP ---------------------------------------

BASE = "/planning/compliance"
QUERY = "?scope_id=hospital%2Fpharmacy"
PASSWORDS = {"admin": "pass-admin", "leader": "pass-lead", "pharmacist": "pass-ph"}


def login(client, who):
    client.cookies.clear()
    response = client.post(
        "/auth/login", json={"username": who, "password": PASSWORDS[who]}
    )
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def future_anchor():
    today = datetime.now(JST).date()
    month = today.replace(day=1) + timedelta(days=62)
    return month.replace(day=1)


def prepared(factory, other_department=False):
    from shift_scheduler.db.planning_models import AccountMembership, PlanningScope
    from tests.test_compliance_v3_api import prepare

    prepare(factory)
    with factory.begin() as session:
        # A second administrator of the same facility (the account named "leader").
        session.add(
            AccountMembership(
                membership_id="leader-admin",
                issuer="mock",
                subject="leader",
                person_id="p1",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        if other_department:
            session.add(
                PlanningScope(
                    scope_id="hospital/ward", input_revision=0, data_revision=0
                )
            )


def adoption_payload(anchor):
    return {
        "adoption_id": "flex-hospital",
        "employer_id": "hospital",
        "establishment_id": "site-hospital",
        "start": f"{anchor}T00:00:00+09:00",
        "end": "2029-01-01T00:00:00+09:00",
        "target_scope": "薬剤部の薬剤師（合成）",
        "settlement_months": 1,
        "settlement_anchor": anchor.isoformat(),
        "total_hours_rule": "statutory_frame",
        "agreed_total_description": "清算期間の暦日数÷7×40時間",
        "standard_day_seconds": 8 * HOUR,
        "flexible_time": [{"start": "07:00", "end": "20:00"}],
        "core_time": [{"start": "10:00", "end": "15:00"}],
        "work_rules_evidence": EVIDENCE,
        "agreement_evidence": EVIDENCE,
    }


def extend_site(client, admin):
    site = {
        "establishment_id": "site-hospital",
        "employer_id": "hospital",
        "start": "2024-12-01T00:00:00+09:00",
        "end": "2029-01-01T00:00:00+09:00",
        "evidence": EVIDENCE,
    }
    stored = client.get(BASE + "/records" + QUERY, headers=admin).json()
    revision = next(
        (
            r["revision"]
            for r in stored
            if r["kind"] == "establishment" and r["entity_id"] == "site-hospital"
        ),
        0,
    )
    reply = client.post(
        BASE + "/records/establishment" + QUERY,
        headers=admin,
        json={
            "expected_revision": revision,
            "idempotency_key": "site-extend-1",
            "payload": site,
        },
    )
    assert reply.status_code == 200, reply.text


def flex_employment(anchor, **change):
    from scripts.remediation_fixture import snapshot

    base = next(
        e
        for e in snapshot().model_dump(mode="json")["employments"]
        if e["person_id"] == "p0"
    )
    return {
        **base,
        "revision_id": "emp0-flex",
        "start": f"{anchor}T00:00:00+09:00",
        "end": "2029-01-01T00:00:00+09:00",
        "working_time_system": "flex",
        "flex_anchor": anchor.isoformat(),
        "flex_months": 1,
        "variable_evidence": EVIDENCE,
        **change,
    }


def test_registration_and_confirmation_need_two_administrators(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from shift_scheduler.application.subject_references import account_references
    from shift_scheduler.db.compliance_models import (
        ComplianceEntity,
        ComplianceRevision,
    )

    prepared(sqlite_session_factory)
    anchor = future_anchor()
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        extend_site(client, admin)
        # The generic record route cannot bypass the procedure.
        bypass = client.post(
            BASE + "/records/flex_adoption" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "bypass-001",
                "payload": {**adoption_payload(anchor), "status": "confirmed"},
            },
        )
        assert bypass.status_code == 422, bypass.text
        # Without a confirmed adoption a flextime employment cannot be saved.
        early = client.post(
            BASE + "/records/employment" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "emp-flex-early",
                "payload": flex_employment(anchor),
            },
        )
        assert (
            early.status_code == 422 and "施設の設定" in early.json()["detail"]
        ), early.text
        # The server records status and identities; the client cannot assert them.
        forged = client.post(
            BASE + "/flex-adoptions" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "register-forged",
                "payload": {**adoption_payload(anchor), "created_by": "leader"},
            },
        )
        assert forged.status_code == 422, forged.text
        request = {
            "idempotency_key": "register-0001",
            "payload": adoption_payload(anchor),
        }
        registered = client.post(
            BASE + "/flex-adoptions" + QUERY, headers=admin, json=request
        )
        assert registered.status_code == 200, registered.text
        assert (
            client.post(
                BASE + "/flex-adoptions" + QUERY, headers=admin, json=request
            ).json()
            == registered.json()
        )
        enrolled = client.post(
            BASE + "/flex-enrollments" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "enrol-0001",
                "payload": {
                    "enrollment_id": "enr-p0",
                    "adoption_id": "flex-hospital",
                    "person_id": "p0",
                    "start": f"{anchor}T00:00:00+09:00",
                },
            },
        )
        assert enrolled.status_code == 200, enrolled.text
        stranger = client.post(
            BASE + "/flex-enrollments" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "enrol-0002",
                "payload": {
                    "enrollment_id": "enr-x",
                    "adoption_id": "flex-hospital",
                    "person_id": "not-here",
                    "start": f"{anchor}T00:00:00+09:00",
                },
            },
        )
        assert stranger.status_code == 422, stranger.text

        impact = client.get(
            BASE + "/flex-adoptions/flex-hospital/impact" + QUERY, headers=admin
        ).json()
        assert impact["blocking"] == [] and [
            p["person_id"] for p in impact["people"]
        ] == ["p0"]
        confirm = {
            "idempotency_key": "confirm-0001",
            "expected_revision": 1,
            "impact_hash": impact["impact_hash"],
        }
        own = client.post(
            BASE + "/flex-adoptions/flex-hospital/confirm" + QUERY,
            headers=admin,
            json=confirm,
        )
        assert own.status_code == 403, own.text

        leader = login(client, "leader")
        stale = client.post(
            BASE + "/flex-adoptions/flex-hospital/confirm" + QUERY,
            headers=leader,
            json={
                **confirm,
                "idempotency_key": "confirm-stale",
                "impact_hash": "0" * 64,
            },
        )
        assert stale.status_code == 409, stale.text
        done = client.post(
            BASE + "/flex-adoptions/flex-hospital/confirm" + QUERY,
            headers=leader,
            json=confirm,
        )
        assert done.status_code == 200, done.text
        assert done.json()["confirmed_enrollments"] == ["enr-p0"]
        assert (
            client.post(
                BASE + "/flex-adoptions/flex-hospital/confirm" + QUERY,
                headers=leader,
                json=confirm,
            ).json()
            == done.json()
        )

        # Now a flextime employment with the agreed terms is accepted; other terms are not.
        wrong = client.post(
            BASE + "/records/employment" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "emp-flex-wrong",
                "payload": flex_employment(anchor, flex_months=2),
            },
        )
        assert wrong.status_code == 422, wrong.text
        right = client.post(
            BASE + "/records/employment" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "emp-flex-right",
                "payload": flex_employment(anchor),
            },
        )
        assert right.status_code == 200, right.text

        listed = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()
        assert (
            listed["can_manage"]
            and listed["adoptions"][0]["payload"]["status"] == "confirmed"
        )
        assert listed["enrollments"][0]["payload"]["reviewed_by"] == "leader"
        staff = login(client, "pharmacist")
        assert (
            client.get(BASE + "/flex-adoptions" + QUERY, headers=staff).status_code
            == 403
        )

        admin = login(client, "admin")
        withdrawn = client.post(
            BASE + "/flex-adoptions/flex-hospital/withdraw" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "withdraw-0001",
                "expected_revision": 2,
                "reason": "合成データの取下げ",
            },
        )
        assert withdrawn.status_code == 200, withdrawn.text

    with sqlite_session_factory() as session:
        rows = {
            r.entity_id: r
            for r in session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.kind.in_(("flex_adoption", "flex_enrollment"))
                )
            )
        }
        history = session.scalars(
            select(ComplianceRevision)
            .where(ComplianceRevision.entity_key == rows["flex-hospital"].key)
            .order_by(ComplianceRevision.revision)
        )
        assert [(h.revision, h.actor, h.payload["status"]) for h in history] == [
            (1, "admin", "registered"),
            (2, "leader", "confirmed"),
            (3, "admin", "withdrawn"),
        ]
        adopted = rows["flex-hospital"].payload
        assert (
            adopted["created_by"],
            adopted["reviewed_by"],
            adopted["decided_by"],
        ) == ("admin", "leader", "admin")
        # Erasure finds the administrators who registered and confirmed (account roles).
        roles = {
            r["role"]: r["person_ids"]
            for r in account_references(session, "hospital/pharmacy", adopted)
        }
        assert roles == {
            "created_by": ["p0"],
            "reviewed_by": ["p1"],
            "decided_by": ["p0"],
        }
        assert rows["enr-p0"].person_id == "p0"


def test_an_administrator_of_one_department_only_cannot_adopt_for_the_facility(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory, other_department=True)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        reply = client.post(
            BASE + "/flex-adoptions" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "register-dept",
                "payload": adoption_payload(future_anchor()),
            },
        )
        assert reply.status_code == 403, reply.text
        listed = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()
        assert listed["can_manage"] is False and listed["manage_refusal"]


def test_a_past_start_or_an_unverified_agreement_blocks_the_adoption(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        extend_site(client, admin)
        past = adoption_payload(datetime(2026, 1, 1).date())
        reply = client.post(
            BASE + "/flex-adoptions" + QUERY,
            headers=admin,
            json={"idempotency_key": "register-past", "payload": past},
        )
        assert reply.status_code == 422, reply.text
        draft = {
            **adoption_payload(future_anchor()),
            "agreement_evidence": {"reference": "draft"},
        }
        assert (
            client.post(
                BASE + "/flex-adoptions" + QUERY,
                headers=admin,
                json={"idempotency_key": "register-draft", "payload": draft},
            ).status_code
            == 200
        )
        impact = client.get(
            BASE + "/flex-adoptions/flex-hospital/impact" + QUERY, headers=admin
        ).json()
        assert any("労使協定" in b for b in impact["blocking"])
        leader = login(client, "leader")
        blocked = client.post(
            BASE + "/flex-adoptions/flex-hospital/confirm" + QUERY,
            headers=leader,
            json={
                "idempotency_key": "confirm-draft",
                "expected_revision": 1,
                "impact_hash": impact["impact_hash"],
            },
        )
        assert blocked.status_code == 422, blocked.text


def test_the_records_are_split_so_erasure_finds_the_person():
    # The enrolment carries person_id (the key erasure follows); the adoption holds none.
    assert "person_id" in FlexEnrollment.model_fields
    assert not any("person" in name for name in FlexAdoption.model_fields)


# --- settlement, staffing diagnosis and actual work -----------------------------------


def flex_snapshot(minimum=1):
    """The remediation fixture with p0 on flextime (adopted and enrolled) and p1 on standard hours."""
    from scripts.remediation_fixture import snapshot

    payload = snapshot().model_dump(mode="json")
    payload["employments"][0].update(
        working_time_system="flex",
        flex_anchor="2024-12-01",
        flex_months=1,
        variable_evidence=EVIDENCE,
    )
    payload["contracts"][0].update(regime="flex", period_min_seconds=0)
    adopt(payload)
    for demand in payload["demands"]:
        demand.update(minimum=minimum, target=minimum)
    return parse_snapshot(payload)


def test_the_solver_says_when_staffing_needs_people_on_flextime():
    from shift_scheduler.optimizer.planning import solve

    assert solve(flex_snapshot(minimum=1), budget_seconds=5).status == "OPTIMAL"
    result = solve(flex_snapshot(minimum=2), budget_seconds=5)
    assert result.status == "INFEASIBLE"
    assert all(
        "1 on flextime cannot take timed duties" in d for d in result.diagnostics
    )


def seeded(factory, data):
    """Stores the adoption and enrolment as the facility procedure would have, then
    registers the input that carries them (an input cannot create them)."""
    from shift_scheduler.application import compliance as service
    from tests.test_compliance_v3_api import prepare

    with factory.begin() as session:
        for kind, collection in (
            ("flex_adoption", "flex_adoptions"),
            ("flex_enrollment", "flex_enrollments"),
        ):
            for value in getattr(data, collection):
                service.save_entity(
                    session,
                    "hospital/pharmacy",
                    kind,
                    value.model_dump(mode="json"),
                    0,
                    "seed",
                )
    prepare(factory, data)


def test_settlements_are_readable_and_flextime_actuals_carry_no_scheduled_hours(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    data = flex_snapshot()
    seeded(sqlite_session_factory, data)
    duty = next(d for d in data.candidates if d.person_id == "p0").model_copy(
        update={"source": "actual"}
    )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        settled = client.get(BASE + "/flex-settlements" + QUERY, headers=admin)
        assert settled.status_code == 200, settled.text
        assert [p["person_id"] for p in settled.json()["people"]] == ["p0"]
        assert settled.json()["input_hash"] == data.input_hash
        staff = login(client, "pharmacist")
        assert (
            client.get(BASE + "/flex-settlements" + QUERY, headers=staff).status_code
            == 403
        )
        admin = login(client, "admin")
        terms = next(
            t for t in data.work_terms if t.duty_id == duty.duty_id
        ).model_dump(mode="json")
        request = {
            "expected_revision": 0,
            "idempotency_key": "flex-actual-1",
            "payload": {
                "external_id": "flex-clock-1",
                "revision": 1,
                "duty": duty.model_dump(mode="json"),
                "work_terms": {
                    **terms,
                    "scheduled_work": [
                        {
                            "start": duty.start.isoformat(),
                            "end": (duty.start + timedelta(hours=1)).isoformat(),
                        }
                    ],
                },
                "expected_work_terms_revision": 0,
            },
        }
        stored = client.get(BASE + "/records" + QUERY, headers=admin).json()
        request["payload"]["expected_work_terms_revision"] = next(
            (
                r["revision"]
                for r in stored
                if r["kind"] == "work_terms" and r["entity_id"] == duty.duty_id
            ),
            0,
        )
        refused = client.post(
            BASE + "/actual-events" + QUERY, headers=admin, json=request
        )
        assert (
            refused.status_code == 422 and "所定労働区間を付けません" in refused.text
        ), refused.text
        request["payload"]["work_terms"]["scheduled_work"] = []
        request["idempotency_key"] = "flex-actual-2"
        accepted = client.post(
            BASE + "/actual-events" + QUERY, headers=admin, json=request
        )
        assert accepted.status_code == 200, accepted.text


# --- independent review findings (2026-09-28) ----------------------------------------------


def test_flexible_time_may_be_written_around_the_core_time():
    a = adoption(
        flexible_time=[
            {"start": "07:00", "end": "10:00"},
            {"start": "15:00", "end": "19:00"},
        ],
        core_time=[{"start": "10:00", "end": "15:00"}],
    )
    assert len(a.flexible_time) == 2


def test_an_input_cannot_create_or_confirm_an_adoption(sqlite_session_factory):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory)
    forged = flex_snapshot().model_copy(update={"source_revision": 2})
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        reply = client.post(
            "/planning/inputs",
            headers=admin,
            json={"expected_revision": 1, "snapshot": forged.model_dump(mode="json")},
        )
        assert reply.status_code == 409, reply.text


def register_confirmed(client, anchor, people=("p0",)):
    """admin registers, leader (another administrator) confirms."""
    admin = login(client, "admin")
    extend_site(client, admin)
    assert (
        client.post(
            BASE + "/flex-adoptions" + QUERY,
            headers=admin,
            json={
                "idempotency_key": f"register-{anchor}",
                "payload": {
                    **adoption_payload(anchor),
                    "adoption_id": f"flex-{anchor}",
                },
            },
        ).status_code
        == 200
    )
    for person in people:
        reply = client.post(
            BASE + "/flex-enrollments" + QUERY,
            headers=admin,
            json={
                "idempotency_key": f"enrol-{anchor}-{person}",
                "payload": {
                    "enrollment_id": f"enr-{anchor}-{person}",
                    "adoption_id": f"flex-{anchor}",
                    "person_id": person,
                    "start": f"{anchor}T00:00:00+09:00",
                },
            },
        )
        assert reply.status_code == 200, reply.text
    leader = login(client, "leader")
    impact = client.get(
        BASE + f"/flex-adoptions/flex-{anchor}/impact" + QUERY, headers=leader
    ).json()
    done = client.post(
        BASE + f"/flex-adoptions/flex-{anchor}/confirm" + QUERY,
        headers=leader,
        json={
            "idempotency_key": f"confirm-{anchor}",
            "expected_revision": 1,
            "impact_hash": impact["impact_hash"],
        },
    )
    assert done.status_code == 200, done.text
    return done.json()


def test_overlapping_enrolments_and_self_confirmation_are_refused(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory)
    anchor = future_anchor()
    with TestClient(app, base_url="https://localhost:8000") as client:
        done = register_confirmed(client, anchor, people=("p0", "p1"))
        # The leader account is person p1: its own enrolment waits for another administrator.
        assert done["confirmed_enrollments"] == [f"enr-{anchor}-p0"]
        assert done["enrollments_needing_another_admin"] == [f"enr-{anchor}-p1"]
        leader = login(client, "leader")
        own = client.post(
            BASE + f"/flex-enrollments/enr-{anchor}-p1/confirm" + QUERY,
            headers=leader,
            json={"idempotency_key": "confirm-own-1", "expected_revision": 1},
        )
        assert own.status_code == 403, own.text
        # A second adoption of the same site cannot enrol p0 again for an overlapping time.
        later = (anchor.replace(day=28) + timedelta(days=5)).replace(day=1)
        admin = login(client, "admin")
        assert (
            client.post(
                BASE + "/flex-adoptions" + QUERY,
                headers=admin,
                json={
                    "idempotency_key": "register-second",
                    "payload": {
                        **adoption_payload(later),
                        "adoption_id": "flex-second",
                    },
                },
            ).status_code
            == 200
        )
        twice = client.post(
            BASE + "/flex-enrollments" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "enrol-twice",
                "payload": {
                    "enrollment_id": "enr-twice",
                    "adoption_id": "flex-second",
                    "person_id": "p0",
                    "start": f"{later}T00:00:00+09:00",
                },
            },
        )
        assert twice.status_code == 422 and "重なる" in twice.text, twice.text


def test_after_the_start_an_adoption_is_ended_at_a_settlement_period_start(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api.main import app
    from shift_scheduler.application import flex_adoption

    prepared(sqlite_session_factory)
    anchor = future_anchor()
    with TestClient(app, base_url="https://localhost:8000") as client:
        register_confirmed(client, anchor)
        started = datetime.combine(anchor, datetime.min.time(), JST) + timedelta(days=3)
        monkeypatch.setattr(flex_adoption, "now", lambda: started)
        admin = login(client, "admin")
        late = client.post(
            BASE + f"/flex-adoptions/flex-{anchor}/withdraw" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "withdraw-late",
                "expected_revision": 2,
                "reason": "開始後",
            },
        )
        assert late.status_code == 422 and "終了" in late.text, late.text
        next_month = (anchor.replace(day=28) + timedelta(days=5)).replace(day=1)
        odd = client.post(
            BASE + f"/flex-adoptions/flex-{anchor}/end" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "end-odd-date",
                "expected_revision": 2,
                "reason": "協定の終了",
                "end_on": (next_month + timedelta(days=1)).isoformat(),
            },
        )
        assert odd.status_code == 422, odd.text
        ended = client.post(
            BASE + f"/flex-adoptions/flex-{anchor}/end" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "end-at-boundary",
                "expected_revision": 2,
                "reason": "協定の終了",
                "end_on": next_month.isoformat(),
            },
        )
        assert ended.status_code == 200, ended.text
        assert ended.json()["end"] == f"{next_month}T00:00:00+09:00"
        listed = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()[
            "adoptions"
        ][0]["payload"]
        assert (listed["status"], listed["decided_by"], listed["end_reason"]) == (
            "confirmed",
            "admin",
            "協定の終了",
        )


def test_a_department_administrator_sees_only_the_department(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from shift_scheduler.application import compliance as service

    prepared(sqlite_session_factory, other_department=True)
    anchor = future_anchor()
    elsewhere = adoption(
        adoption_id="flex-ward",
        employer_id="hospital",
        establishment_id="site-ward",
        start=f"{anchor}T00:00:00+09:00",
        settlement_anchor=anchor.isoformat(),
    )
    with sqlite_session_factory.begin() as session:
        service.save_entity(
            session,
            "hospital/ward",
            "flex_adoption",
            elsewhere.model_dump(mode="json"),
            0,
            "seed",
        )
        enrolment = FlexEnrollment(
            enrollment_id="enr-w1",
            adoption_id="flex-ward",
            person_id="w1",
            start=f"{anchor}T00:00:00+09:00",
            created_by="seed",
            created_at="2026-09-28T00:00:00+09:00",
        )
        service.save_entity(
            session,
            "hospital/ward",
            "flex_enrollment",
            enrolment.model_dump(mode="json"),
            0,
            "seed",
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        listed = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()
        assert listed["can_manage"] is False
        assert (listed["adoptions"], listed["enrollments"]) == ([], [])
        records = client.get(BASE + "/records" + QUERY, headers=admin).json()
        assert not any(r["kind"].startswith("flex_") for r in records)


def test_an_employment_without_a_time_zone_is_a_validation_error(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory)
    with TestClient(
        app, base_url="https://localhost:8000", raise_server_exceptions=False
    ) as client:
        admin = login(client, "admin")
        payload = flex_employment(future_anchor(), start="2027-01-01T00:00:00")
        reply = client.post(
            BASE + "/records/employment" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "naive-time",
                "payload": payload,
            },
        )
        assert reply.status_code == 422, reply.text


def test_a_switch_back_to_standard_hours_at_a_settlement_boundary_is_accounted():
    # Flextime settled monthly from the 8th; standard hours again from Jan 8 (a Thursday).
    payload = upgrade(
        work_fixture([("A", 0, 9, 10, 0), ("A", 4, 9, 8, 8)], orders=(1,))
    )
    standard = payload["employments"][0]
    flex = dict(
        standard,
        revision_id="emp-flex",
        start="2025-12-08T00:00:00+09:00",
        end="2026-01-08T00:00:00+09:00",
        working_time_system="flex",
        flex_anchor="2025-12-08",
        flex_months=1,
        variable_evidence=EVIDENCE,
    )
    standard["start"] = "2026-01-08T00:00:00+09:00"
    payload["employments"] = [flex, standard]
    payload["work_terms"][0].update(
        employment_revision_id="emp-flex", scheduled_work=[]
    )
    adopt(payload)
    data = parse_snapshot(payload)
    result = account_work(
        data, [d.model_copy(update={"source": "actual"}) for d in data.candidates]
    )
    statuses = [(f.status, f.message) for f in result["findings"]]
    assert not any(s == "unsupported" for s, _ in statuses), statuses
    assert any(
        "week of the switch from flextime on 2026-01-08" in m for _, m in statuses
    )
    assert [s["kind"] for s in result["settlements"]] == ["flextime"]
    by_duty = {r["duty_id"]: r["overtime_seconds"] for r in result["trace"]}
    assert by_duty["0"] == 0  # a 10h flextime day is not daily overtime


# --- second independent review (2026-09-28) ----------------------------------------------


def test_the_same_person_is_recognised_behind_an_oidc_account(sqlite_session_factory):
    import hashlib
    import json

    from shift_scheduler.application import flex_adoption
    from shift_scheduler.db.planning_models import AccountMembership

    with sqlite_session_factory.begin() as session:
        for issuer, subject in (
            ("https://idp.invalid", "sub-a"),
            ("https://other.invalid", "sub-b"),
        ):
            session.add(
                AccountMembership(
                    membership_id=subject,
                    issuer=issuer,
                    subject=subject,
                    person_id="p9",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                )
            )
    first = hashlib.sha256(
        json.dumps(["https://idp.invalid", "sub-a"]).encode()
    ).hexdigest()
    second = hashlib.sha256(
        json.dumps(["https://other.invalid", "sub-b"]).encode()
    ).hexdigest()
    with sqlite_session_factory() as session:
        assert flex_adoption._people(session, first) == {"p9"}
        with pytest.raises(flex_adoption.Refused):  # one person, two accounts
            flex_adoption._separate(session, first, second)
        with pytest.raises(flex_adoption.Refused):  # an administrator's own enrolment
            flex_adoption._separate(session, "someone-else", second, "p9")


def test_unconfirmed_records_can_be_withdrawn_after_their_start_and_ending_needs_a_start(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api.main import app
    from shift_scheduler.application import flex_adoption

    prepared(sqlite_session_factory)
    anchor = future_anchor()
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        extend_site(client, admin)
        assert (
            client.post(
                BASE + "/flex-adoptions" + QUERY,
                headers=admin,
                json={
                    "idempotency_key": "register-pending",
                    "payload": adoption_payload(anchor),
                },
            ).status_code
            == 200
        )
        early = client.post(
            BASE + "/flex-adoptions/flex-hospital/end" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "end-too-early",
                "expected_revision": 1,
                "reason": "x",
                "end_on": (anchor.replace(day=28) + timedelta(days=5))
                .replace(day=1)
                .isoformat(),
            },
        )
        assert early.status_code == 422, early.text
        monkeypatch.setattr(
            flex_adoption,
            "now",
            lambda: datetime.combine(anchor, datetime.min.time(), JST)
            + timedelta(days=3),
        )
        withdrawn = client.post(
            BASE + "/flex-adoptions/flex-hospital/withdraw" + QUERY,
            headers=admin,
            json={
                "idempotency_key": "withdraw-pending",
                "expected_revision": 1,
                "reason": "確認されなかった",
            },
        )
        assert withdrawn.status_code == 200, withdrawn.text


def test_a_flextime_employment_without_a_site_is_refused(sqlite_session_factory):
    from shift_scheduler.api.main import app

    prepared(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        payload = flex_employment(future_anchor())
        payload.pop("establishment_id")
        reply = client.post(
            BASE + "/records/employment" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "v2-flex-employment",
                "payload": payload,
            },
        )
        assert reply.status_code == 422 and "事業場" in reply.text, reply.text


def test_a_department_without_enrolled_people_is_not_touched_by_an_adoption(
    sqlite_session_factory,
):
    from scripts.remediation_fixture import snapshot

    from shift_scheduler.application import compliance as service

    data = flex_snapshot()
    seeded(sqlite_session_factory, data)
    with sqlite_session_factory() as session:
        stored = snapshot().model_dump(mode="json")
        stored["people"] = [p for p in stored["people"] if p["person_id"] == "p1"]
        assert "flex_adoptions" not in service.overlay(
            session, "hospital/pharmacy", stored
        )
        full = service.overlay(
            session, "hospital/pharmacy", data.model_dump(mode="json")
        )
        assert [a["adoption_id"] for a in full["flex_adoptions"]] == ["flex-1"]
