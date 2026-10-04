"""S01/D03: copy, erasure and hold control events as shared subject records (SQLite).

Each event names a scoped control record (managed copy, copy-erasure plan,
erasure plan, legal hold). Its subjects come from that record, never from the
event text; hashes and counts of joint content are not retained. Removing two
people in either order leaves the same partial history.
"""

from datetime import UTC, datetime

import pytest

from shift_scheduler.application.shared_subject_record import (
    project_outbox,
    project_partial,
)
from shift_scheduler.db.compliance_models import (
    CopyErasure,
    CopySubject,
    ErasurePlan,
    LegalHold,
    ManagedCopy,
)
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningScope,
)

SCOPE = "hospital/pharmacy"
INPUT = "i" * 64
AT = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def control(sqlite_session_factory):
    with sqlite_session_factory.begin() as s:
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
        s.add(PlanningScope(scope_id=SCOPE))
        s.add(
            PlanningInput(
                input_hash=INPUT,
                scope_id=SCOPE,
                input_revision=1,
                created_by="operator-account",
                payload={"people": [{"person_id": "p0"}, {"person_id": "p1"}]},
            )
        )
        s.add(
            ManagedCopy(
                copy_id="c1",
                scope_id=SCOPE,
                category="planning_history",
                medium="database",
                locator={},
                content_hash="h" * 64,
                revision=2,
                anchor="created",
                anchor_at=AT,
                evidence={},
            )
        )
        s.add_all(
            [
                CopySubject(copy_id="c1", person_id="p0"),
                CopySubject(copy_id="c1", person_id="p1"),
            ]
        )
        s.add(
            CopyErasure(
                plan_id="cp1",
                scope_id=SCOPE,
                person_id="p0",
                fingerprint="f" * 64,
                payload={},
            )
        )
        s.add(
            ErasurePlan(
                plan_id="e1",
                scope_id=SCOPE,
                fingerprint="f" * 64,
                payload={"input_hash": INPUT},
            )
        )
        s.add(
            LegalHold(
                hold_id="h1",
                scope_id=SCOPE,
                person_id="p0",
                active=True,
                revision=2,
                payload={},
            )
        )
    return sqlite_session_factory


EVENTS = {
    "privacy.hold": (
        {"hold_id": "h1", "revision": 2, "active": True},
        ["p0"],
        {"revision": 2, "active": True},
    ),
    "copy.external_confirmed": (
        {
            "copy_id": "c1",
            "revision": 2,
            "content_hash": "e" * 64,
            "person_ids": ["p1", "p0"],
            "local_physical_erasure_verified": False,
        },
        ["p0", "p1"],
        {"revision": 2},
    ),
    "copy.preview": ({"plan_id": "cp1"}, ["p0"], {}),
    "copy.erasure_queued": ({"plan_id": "cp1", "count": 3}, ["p0"], {}),
    "erasure.preview": ({"plan_id": "e1", "blocked": False}, ["p0", "p1"], {}),
}
# Events that name only a copy (its subjects are replaced on re-registration),
# events written by an unresolvable worker account, or after their input was
# erased, stay unsupported and fail closed.
UNSUPPORTED = {
    "copy.register": {"copy_id": "c1", "revision": 1},
    "copy.review": {"copy_id": "c1", "revision": 2},
    "copy.preservation_review": {
        "copy_id": "c1",
        "revision": 2,
        "projection_hash": "a" * 64,
    },
    "copy.joint_review": {
        "copy_id": "c1",
        "revision": 2,
        "context_hash": "b" * 64,
        "review_hash": "c" * 64,
        "projection_hash": "d" * 64,
    },
    "copy.erased": {"copy_id": "c1", "prior_hash": "h" * 64, "plan_id": "cp1"},
    "erasure.executed": {"plan_id": "e1", "count": 7, "replayable": False},
    "retention.rule": {"key": "k", "revision": 2},
}


def event(kind, fields):
    return {
        "kind": kind,
        "actor": "operator-account",
        "payload": fields,
        "created_at": AT,
    }


@pytest.mark.parametrize("kind", sorted(EVENTS))
def test_control_event_subjects_come_from_the_named_record(control, kind):
    fields, subjects, kept = EVENTS[kind]
    everyone = sorted({*subjects, "operator-person"})
    with control() as s:
        for person in everyone:
            projected = project_outbox(s, event(kind, fields), SCOPE, person)
            assert [p["person_id"] for p in projected["retained"]["people"]] == [
                p for p in everyone if p != person
            ]
            for record in projected["retained"]["subject_records"]:
                expected = (
                    {"person_id": record["person_id"], "event_fields": kept}
                    if record["person_id"] in subjects
                    else {}
                )
                assert record["data"] == expected
            text = str(projected)
            # Hashes and counts of joint content are not retained. The account
            # identifier stays only in its own person's partition.
            assert (
                "a" * 64 not in text and "e" * 64 not in text and "h" * 64 not in text
            )
            operator = [
                r
                for r in projected["retained"]["subject_records"]
                if r["person_id"] == "operator-person"
            ]
            assert ("operator-account" in text) == bool(operator)
            assert all(
                not r["accounts"]
                for r in projected["retained"]["subject_records"]
                if r["person_id"] != "operator-person"
            )
            assert "'count'" not in text and "'blocked'" not in text
        # Two removals in either order leave the same partial history.
        if len(everyone) >= 3:
            a, b = everyone[0], everyone[-1]
            first = project_partial(project_outbox(s, event(kind, fields), SCOPE, a), b)
            second = project_partial(
                project_outbox(s, event(kind, fields), SCOPE, b), a
            )
            assert first["retained"] == second["retained"]


@pytest.mark.parametrize("kind", sorted(EVENTS))
def test_control_events_fail_closed(control, kind):
    fields, _, _ = EVENTS[kind]
    with control() as s:
        with pytest.raises(ValueError):  # another department
            project_outbox(s, event(kind, fields), "hospital/other", "p0")
        with pytest.raises(ValueError):  # an unknown field is never guessed
            project_outbox(s, event(kind, {**fields, "note": "free text"}), SCOPE, "p0")


def test_disagreeing_event_contents_are_refused(control):
    with control() as s:
        for kind, fields in [
            (
                "copy.external_confirmed",
                {**EVENTS["copy.external_confirmed"][0], "person_ids": ["p0"]},
            ),
            (
                "copy.external_confirmed",
                {
                    **EVENTS["copy.external_confirmed"][0],
                    "local_physical_erasure_verified": True,
                },
            ),
            (
                "copy.external_confirmed",
                {**EVENTS["copy.external_confirmed"][0], "revision": {"note": "x"}},
            ),
            (
                "copy.external_confirmed",
                {**EVENTS["copy.external_confirmed"][0], "revision": 99},
            ),
            ("privacy.hold", {"hold_id": "h1", "revision": 3, "active": True}),
            ("privacy.hold", {"hold_id": "h1", "revision": "2", "active": True}),
            ("privacy.hold", {"hold_id": "h1", "revision": True, "active": True}),
            ("privacy.hold", {"hold_id": "h1", "revision": 0, "active": True}),
            ("privacy.hold", {"hold_id": "h1", "revision": 2, "active": "yes"}),
        ]:
            with pytest.raises(ValueError):
                project_outbox(s, event(kind, fields), SCOPE, "p0")


@pytest.mark.parametrize("kind", sorted(UNSUPPORTED))
def test_events_without_fixed_subjects_stay_unsupported(control, kind):
    with control() as s, pytest.raises(ValueError):
        project_outbox(s, event(kind, UNSUPPORTED[kind]), SCOPE, "p0")


def test_a_changed_copy_subject_set_refuses_the_recorded_event(control):
    with control.begin() as s:
        s.delete(s.get(CopySubject, ("c1", "p0")))
        s.add(CopySubject(copy_id="c1", person_id="p2"))
    with control() as s, pytest.raises(ValueError, match="disagree"):
        project_outbox(
            s,
            event("copy.external_confirmed", EVENTS["copy.external_confirmed"][0]),
            SCOPE,
            "p1",
        )


def test_an_erased_subject_is_not_reintroduced(control):
    from shift_scheduler.db.compliance_models import ErasedSubject

    with control.begin() as s:
        s.add(
            ErasedSubject(
                facility_id="hospital", person_id="p1", plan_id="old", evidence={}
            )
        )
    with control() as s, pytest.raises(ValueError, match="already erased"):
        project_outbox(
            s, event("erasure.preview", EVENTS["erasure.preview"][0]), SCOPE, "p0"
        )


def test_erasure_event_after_its_input_was_erased_is_refused(control):
    with control.begin() as s:
        s.delete(s.get(PlanningInput, INPUT))
    with control() as s, pytest.raises(ValueError, match="provenance"):
        project_outbox(
            s, event("erasure.preview", EVENTS["erasure.preview"][0]), SCOPE, "p0"
        )


def test_input_projection_keeps_the_other_persons_outside_declarations():
    # A V3 input with declarations of two people: removing one keeps the other's.
    from scripts.remediation_fixture import snapshot

    from shift_scheduler.application.shared_projection import project
    from tests.test_outside_declaration_accounting import declared

    payload = declared(snapshot().model_dump(mode="json"))
    payload["outside_declarations"].append(
        dict(
            payload["outside_declarations"][0],
            declaration_id="outside-p1",
            person_id="p1",
        )
    )
    projected = project(payload, "p0")
    assert [d["person_id"] for d in projected["retained"]["outside_declarations"]] == [
        "p1"
    ]
    assert projected["removed_counts"]["outside_declarations"] == 1
