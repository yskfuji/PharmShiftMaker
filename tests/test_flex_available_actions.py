"""The flextime listing says what each viewer may do now, and on which days.

Every `allowed` flag and every listed day is compared with what the real route
does with a well-formed request (the listing is never compared with a table kept
here): adoptions and enrolments in each state, seen by the registering
administrator, another facility administrator, an administrator of one department
only and a pharmacist, before and after the start. Synthetic data only.
"""

from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.application import compliance as service
from shift_scheduler.application import flex_adoption
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import AccountMembership, PlanningScope
from shift_scheduler.db.session import get_engine
from shift_scheduler.domain.compliance_v3 import FlexAdoption, FlexEnrollment
from tests.test_flex_adoption import BASE, QUERY, login, prepared
from tests.test_flextime import EVIDENCE, HOUR

JST = ZoneInfo("Asia/Tokyo")
SCOPE = "hospital/pharmacy"
START = date(2027, 4, 1)
BEFORE = datetime(2027, 3, 10, 12, tzinfo=JST)
AFTER = datetime(2027, 4, 10, 12, tzinfo=JST)
# Exactly the midnight a settlement period starts: that day is no longer ahead.
EDGE = datetime(2027, 5, 1, tzinfo=JST)
SPARE = "s9"  # a person of the department without any enrolment
ADOPTION_ACTIONS = ("confirm", "withdraw", "end", "add_participant")
ENROLLMENT_ACTIONS = ("confirm", "withdraw")
PREVIOUS_ROW_KEYS = ("entity_id", "revision", "payload")
# Reasons only the listing words (the route answers with a validation message).
LISTING_ONLY = {flex_adoption.NOT_WITHDRAWABLE, flex_adoption.UNREADABLE}
PREVIOUS_KEYS = {
    "viewer",
    "can_manage",
    "manage_refusal",
    "adoptions",
    "enrollments",
    "establishments",
    "people",
}


def midnight(day):
    return f"{day}T00:00:00+09:00"


def probes():
    """Days around every month start from before the adoptions to after their end."""
    days = []
    for index in range(17):  # 2027-02 .. 2028-06
        first = date(2027 + (1 + index) // 12, (1 + index) % 12 + 1, 1)
        days += [first - timedelta(days=1), first, first + timedelta(days=1)]
    return days


def adoption(identity, **change):
    values = {
        "adoption_id": identity,
        "employer_id": "hospital",
        "establishment_id": "site-hospital",
        "start": midnight(START),
        "end": midnight(date(2028, 4, 1)),
        "target_scope": "薬剤部の薬剤師（合成）",
        "settlement_months": 1,
        "settlement_anchor": START.isoformat(),
        "total_hours_rule": "statutory_frame",
        "agreed_total_description": "清算期間の暦日数÷7×40時間",
        "standard_day_seconds": 8 * HOUR,
        "work_rules_evidence": EVIDENCE,
        "agreement_evidence": EVIDENCE,
        "created_by": "admin",
        "created_at": "2027-03-01T09:00:00+09:00",
        **change,
    }
    return "flex_adoption", FlexAdoption(**values).model_dump(mode="json")


def enrollment(identity, owner, person, **change):
    values = {
        "enrollment_id": identity,
        "adoption_id": owner,
        "person_id": person,
        "start": midnight(START),
        "created_by": "admin",
        "created_at": "2027-03-01T09:00:00+09:00",
        **change,
    }
    return "flex_enrollment", FlexEnrollment(**values).model_dump(mode="json")


CONFIRMED = {
    "status": "confirmed",
    "reviewed_by": "leader",
    "reviewed_at": "2027-03-02T09:00:00+09:00",
}
WITHDRAWN = {
    "status": "withdrawn",
    "decided_by": "leader",
    "decided_at": "2027-03-03T09:00:00+09:00",
    "withdrawal_reason": "合成データの取下げ",
}


def records():
    return [
        adoption("a-registered"),
        adoption("a-by-leader", created_by="leader"),
        adoption("a-draft", agreement_evidence={"reference": "draft"}),
        adoption("a-confirmed", **CONFIRMED),
        adoption(
            "a-ended",
            **CONFIRMED,
            end=midnight(date(2027, 9, 1)),
            decided_by="leader",
            decided_at="2027-04-05T09:00:00+09:00",
            end_reason="協定の終了（合成）",
        ),
        adoption("a-withdrawn", **WITHDRAWN),
        # One settlement period only: after its start no later period start is left.
        adoption("a-single", **CONFIRMED, end=midnight(date(2027, 5, 1))),
        adoption(
            "a-quarter",
            **CONFIRMED,
            settlement_months=3,
            agreement_valid_until="2028-03-31",
            filing={
                "filed_on": "2027-03-15",
                "office": "合成の監督署",
                "evidence": EVIDENCE,
            },
        ),
        enrollment("e-pending", "a-confirmed", "s1"),
        # The account "leader" is person p1: its own enrolment.
        enrollment("e-own", "a-confirmed", "p1"),
        enrollment("e-by-leader", "a-confirmed", "s2", created_by="leader"),
        enrollment("e-confirmed", "a-confirmed", "s3", **CONFIRMED),
        enrollment("e-withdrawn", "a-confirmed", "s4", **WITHDRAWN),
        enrollment("e-waiting", "a-registered", "s5"),
        enrollment(
            "e-later", "a-confirmed", "s6", **CONFIRMED, start=midnight("2027-06-01")
        ),
        enrollment(
            "e-pending-later", "a-confirmed", "s7", start=midnight("2027-06-01")
        ),
    ]


def seed(factory, department_only=False):
    """`department_only`: a second department exists that only "admin" administers,
    so "leader" is an administrator of the pharmacy department alone."""
    prepared(factory)
    with factory.begin() as session:
        if department_only:
            session.add(
                PlanningScope(
                    scope_id="hospital/ward", input_revision=0, data_revision=0
                )
            )
            session.add(
                AccountMembership(
                    membership_id="admin-ward",
                    issuer="mock",
                    subject="admin",
                    person_id="p0",
                    scope_id="hospital/ward",
                    role="ADMIN",
                    active=True,
                )
            )
        for index in range(1, 10):
            person = {"person_id": f"s{index}", "name": f"合成職員{index}"}
            service.save_entity(session, SCOPE, "person", person, 0, "seed")
        for kind, payload in records():
            service.save_entity(session, SCOPE, kind, payload, 0, "seed")


class Database:
    """The seeded SQLite file, put back after every accepted request so that each
    request meets exactly the state the listing described."""

    def __init__(self, directory: Path):
        self.path = directory / "pharmshift.db"
        get_engine().dispose()
        self.seeded = self.path.read_bytes()

    def restore(self):
        get_engine().dispose()
        self.path.write_bytes(self.seeded)


def stored(factory):
    with factory() as session:
        rows = session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.kind.in_(("flex_adoption", "flex_enrollment"))
            )
        ).all()
        return {
            row.entity_id: {
                "entity_id": row.entity_id,
                "revision": row.revision,
                "payload": row.payload,
            }
            for row in rows
        }


class Probe:
    """Sends the real request of one action and says whether it was accepted."""

    def __init__(self, client, database, viewer, facility_admin):
        self.client, self.database = client, database
        self.viewer, self.facility_admin = viewer, facility_admin
        self.count = 0

    def post(self, path, body):
        self.count += 1
        reply = self.client.post(
            BASE + path + QUERY,
            headers=self.viewer,
            json={"idempotency_key": f"probe-{self.count:05d}", **body},
        )
        # 409 or 404 would mean a malformed probe, not the rule under test.
        assert reply.status_code in (200, 403, 422), (path, body, reply.text)
        if reply.status_code == 200:
            self.database.restore()
        return reply

    def confirm_adoption(self, row):
        # The impact a facility administrator reads (the viewer may not read it).
        impact = self.client.get(
            BASE + f"/flex-adoptions/{row['entity_id']}/impact" + QUERY,
            headers=self.facility_admin,
        ).json()
        return self.post(
            f"/flex-adoptions/{row['entity_id']}/confirm",
            {
                "expected_revision": row["revision"],
                "impact_hash": impact["impact_hash"],
            },
        )

    def withdraw(self, kind, row):
        return self.post(
            f"/{kind}/{row['entity_id']}/withdraw",
            {"expected_revision": row["revision"], "reason": "合成の理由"},
        )

    def end(self, row, day):
        return self.post(
            f"/flex-adoptions/{row['entity_id']}/end",
            {
                "expected_revision": row["revision"],
                "reason": "合成の理由",
                "end_on": str(day),
            },
        )

    def add_participant(self, row, day):
        return self.post(
            "/flex-enrollments",
            {
                "payload": {
                    "enrollment_id": "e-probe",
                    "adoption_id": row["entity_id"],
                    "person_id": SPARE,
                    "start": midnight(day),
                }
            },
        )

    def confirm_enrollment(self, row):
        return self.post(
            f"/flex-enrollments/{row['entity_id']}/confirm",
            {"expected_revision": row["revision"]},
        )

    def accepted_days(self, send, row):
        return [
            day.isoformat() for day in probes() if send(row, day).status_code == 200
        ]


def explains(reply, action):
    """A refused step answers with the reason the listing gave, where the route
    returns the reason itself (422; a 403 is a fixed sentence)."""
    assert action["allowed"] is False and action["refusal"]
    if reply.status_code == 422 and action["refusal"] not in LISTING_ONLY:
        assert reply.json()["detail"] == action["refusal"], reply.text


def check_listing(factory, client, database, who, facility_admin, can_manage):
    viewer = login(client, who)
    admin = login(client, facility_admin)
    before = stored(factory)
    reply = client.get(BASE + "/flex-adoptions" + QUERY, headers=viewer)
    assert reply.status_code == 200, reply.text
    listing = reply.json()
    probe = Probe(client, database, viewer, admin)

    # The fields the listing had before are unchanged.
    assert set(listing) == PREVIOUS_KEYS
    assert (listing["viewer"], listing["can_manage"]) == (who, can_manage)
    rows = [*listing["adoptions"], *listing["enrollments"]]
    assert {row["entity_id"] for row in rows} == set(before)
    for row in rows:
        assert {key: row[key] for key in PREVIOUS_ROW_KEYS} == before[row["entity_id"]]
    seen = {}

    for row in listing["adoptions"]:
        assert set(row) == {*PREVIOUS_ROW_KEYS, "settlement_starts", "actions"}
        assert set(row["actions"]) == set(ADOPTION_ACTIONS)
        assert set(row["settlement_starts"]) == {"participant_start", "end_on"}
        actions, days = row["actions"], row["settlement_starts"]
        for name in ADOPTION_ACTIONS:
            assert set(actions[name]) == {"allowed", "refusal"}
            assert (actions[name]["refusal"] is None) == actions[name]["allowed"]
            seen[(row["entity_id"], name)] = actions[name]["allowed"]

        confirmed = probe.confirm_adoption(row)
        assert (confirmed.status_code == 200) == actions["confirm"]["allowed"]
        withdrawn = probe.withdraw("flex-adoptions", row)
        assert (withdrawn.status_code == 200) == actions["withdraw"]["allowed"], (
            row["entity_id"],
            withdrawn.text,
        )
        if not actions["withdraw"]["allowed"]:
            explains(withdrawn, actions["withdraw"])
        if not actions["confirm"]["allowed"]:
            explains(confirmed, actions["confirm"])

        # The listed days are exactly the days the routes accept.
        assert probe.accepted_days(probe.end, row) == days["end_on"]
        assert actions["end"]["allowed"] == bool(days["end_on"])
        assert (
            probe.accepted_days(probe.add_participant, row) == days["participant_start"]
        )
        assert actions["add_participant"]["allowed"] == bool(days["participant_start"])

    for row in listing["enrollments"]:
        assert set(row) == {*PREVIOUS_ROW_KEYS, "actions"}
        assert set(row["actions"]) == set(ENROLLMENT_ACTIONS)
        actions = row["actions"]
        for name in ENROLLMENT_ACTIONS:
            assert set(actions[name]) == {"allowed", "refusal"}
            assert (actions[name]["refusal"] is None) == actions[name]["allowed"]
            seen[(row["entity_id"], name)] = actions[name]["allowed"]
        confirmed = probe.confirm_enrollment(row)
        assert (confirmed.status_code == 200) == actions["confirm"]["allowed"]
        withdrawn = probe.withdraw("flex-enrollments", row)
        assert (withdrawn.status_code == 200) == actions["withdraw"]["allowed"], (
            row["entity_id"],
            withdrawn.text,
        )
        for reply, name in ((confirmed, "confirm"), (withdrawn, "withdraw")):
            if not actions[name]["allowed"]:
                explains(reply, actions[name])
    return listing, seen


@pytest.mark.parametrize("at", [BEFORE, AFTER, EDGE], ids=["before", "after", "edge"])
@pytest.mark.parametrize("who", ["admin", "leader"])
def test_a_facility_administrator_is_offered_what_the_routes_accept(
    sqlite_session_factory, tmp_path, monkeypatch, who, at
):
    seed(sqlite_session_factory)
    monkeypatch.setattr(flex_adoption, "now", lambda: at)
    with TestClient(app(), base_url="https://localhost:8000") as client:
        listing, seen = check_listing(
            sqlite_session_factory, client, Database(tmp_path), who, "admin", True
        )
    allowed = {key for key, value in seen.items() if value}
    other = {"admin": "leader", "leader": "admin"}[who]
    started = at >= datetime.combine(START, datetime.min.time(), JST)
    # The matrix is not vacuous: each action is allowed somewhere and refused
    # somewhere, and the two administrators differ where the registrant matters.
    assert {action for row, action in allowed if row.startswith("a-")} == {
        "withdraw",
        "add_participant",
        "end" if started else "confirm",  # an adoption is confirmed before its start
    }
    for name in ADOPTION_ACTIONS:
        assert any(not v for (_, action), v in seen.items() if action == name)
    registered_by_other = "a-by-leader" if other == "leader" else "a-registered"
    assert ((registered_by_other, "confirm") in allowed) == (not started)
    mine = "a-registered" if who == "admin" else "a-by-leader"
    assert (mine, "confirm") not in allowed
    assert (("a-confirmed", "end") in allowed) == started
    assert (("a-confirmed", "withdraw") in allowed) == (not started)
    assert ("a-registered", "withdraw") in allowed  # never took effect
    assert ("a-single", "end") not in allowed  # no later period start
    assert (("e-pending", "confirm") in allowed) == (who == "leader" and not started)
    assert ("e-own", "confirm") not in allowed
    assert (("e-pending-later", "confirm") in allowed) == (who == "leader")
    assert ("e-later", "withdraw") in allowed
    assert (("e-confirmed", "withdraw") in allowed) == (not started)
    by_id = {row["entity_id"]: row for row in listing["adoptions"]}
    quarter = by_id["a-quarter"]["settlement_starts"]
    if at == BEFORE:
        assert quarter["participant_start"][:2] == ["2027-04-01", "2027-07-01"]
        assert quarter["end_on"] == []  # not started: withdrawn, not ended
    if at == EDGE:
        monthly = by_id["a-confirmed"]["settlement_starts"]
        assert monthly["end_on"][0] == "2027-06-01"  # 05-01 has begun
        assert monthly["participant_start"][0] == "2027-06-01"
        assert quarter["end_on"][0] == "2027-07-01"


@pytest.mark.parametrize("at", [BEFORE, AFTER], ids=["before", "after"])
def test_an_administrator_of_one_department_is_refused_every_step(
    sqlite_session_factory, tmp_path, monkeypatch, at
):
    seed(sqlite_session_factory, department_only=True)
    monkeypatch.setattr(flex_adoption, "now", lambda: at)
    with TestClient(app(), base_url="https://localhost:8000") as client:
        listing, seen = check_listing(
            sqlite_session_factory, client, Database(tmp_path), "leader", "admin", False
        )
    assert seen and not any(seen.values())
    for row in [*listing["adoptions"], *listing["enrollments"]]:
        for action in row["actions"].values():
            assert action["refusal"] == listing["manage_refusal"]
    # The facility administrator of the same data is still offered the steps.
    with TestClient(app(), base_url="https://localhost:8000") as client:
        mine = client.get(
            BASE + "/flex-adoptions" + QUERY, headers=login(client, "admin")
        ).json()
    assert mine["can_manage"] and any(
        action["allowed"]
        for row in mine["adoptions"]
        for action in row["actions"].values()
    )


@pytest.mark.parametrize("at", [BEFORE, AFTER], ids=["before", "after"])
def test_a_pharmacist_reads_no_listing_and_every_step_is_refused(
    sqlite_session_factory, tmp_path, monkeypatch, at
):
    seed(sqlite_session_factory)
    monkeypatch.setattr(flex_adoption, "now", lambda: at)
    before = stored(sqlite_session_factory)
    with TestClient(app(), base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        rows = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()
        staff = login(client, "pharmacist")
        assert (
            client.get(BASE + "/flex-adoptions" + QUERY, headers=staff).status_code
            == 403
        )
        probe = Probe(client, Database(tmp_path), staff, admin)
        for row in rows["adoptions"]:
            replies = [
                probe.confirm_adoption(row),
                probe.withdraw("flex-adoptions", row),
                *(probe.end(row, day) for day in probes()[:8]),
                *(probe.add_participant(row, day) for day in probes()[:8]),
            ]
            assert {reply.status_code for reply in replies} == {403}
        for row in rows["enrollments"]:
            replies = [
                probe.confirm_enrollment(row),
                probe.withdraw("flex-enrollments", row),
            ]
            assert {reply.status_code for reply in replies} == {403}
    assert stored(sqlite_session_factory) == before


def test_a_department_without_an_input_cannot_add_a_participant(
    sqlite_session_factory, tmp_path, monkeypatch
):
    """Seen from a department that has no planning input yet, the same adoption
    takes no new participant (register_enrollment needs the department's people)."""
    seed(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(
            PlanningScope(scope_id="hospital/ward", input_revision=0, data_revision=0)
        )
        for subject, person in (("admin", "p0"), ("leader", "p1")):
            session.add(
                AccountMembership(
                    membership_id=subject + "-ward",
                    issuer="mock",
                    subject=subject,
                    person_id=person,
                    scope_id="hospital/ward",
                    role="ADMIN",
                    active=True,
                )
            )
    monkeypatch.setattr(flex_adoption, "now", lambda: BEFORE)
    ward = "?scope_id=hospital%2Fward"
    with TestClient(app(), base_url="https://localhost:8000") as client:
        admin = login(client, "admin")
        listing = client.get(BASE + "/flex-adoptions" + ward, headers=admin).json()
        assert listing["can_manage"] is True
        row = next(r for r in listing["adoptions"] if r["entity_id"] == "a-confirmed")
        action = row["actions"]["add_participant"]
        assert action["allowed"] is False
        assert row["settlement_starts"]["participant_start"] == []
        reply = client.post(
            BASE + "/flex-enrollments" + ward,
            headers=admin,
            json={
                "idempotency_key": "probe-ward-1",
                "payload": {
                    "enrollment_id": "e-probe",
                    "adoption_id": "a-confirmed",
                    "person_id": SPARE,
                    "start": midnight(START),
                },
            },
        )
        assert reply.status_code == 422 and reply.json()["detail"] == action["refusal"]
        # The same adoption seen from the department that has an input.
        home = client.get(BASE + "/flex-adoptions" + QUERY, headers=admin).json()
        row = next(r for r in home["adoptions"] if r["entity_id"] == "a-confirmed")
        assert row["actions"]["add_participant"]["allowed"] is True


def app():
    from shift_scheduler.api.main import app as application

    return application
