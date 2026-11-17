from copy import deepcopy
from datetime import UTC, datetime

import pytest

from shift_scheduler.application.shared_subject_record import (
    project_outbox,
    project_partial,
    project_record,
    project_workflow_record,
)
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningChangeCase,
    PlanningInput,
    PlanningPublication,
    PlanningScope,
)


@pytest.mark.parametrize(
    "table",
    ["compliance_entities", "privacy_cases", "planning_outbox", "actual_work_events"],
)
def test_body_subject_and_actor_are_preserved_separately(sqlite_session_factory, table):
    with sqlite_session_factory.begin() as s:
        for n in (1, 2):
            s.add(
                AccountMembership(
                    membership_id=str(n),
                    issuer="oidc",
                    subject=f"account{n}",
                    person_id=f"p{n}",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                )
            )
    row = {
        "person_id": "p0",
        "actor": "account1",
        "payload": {"person_id": "p0", "reviewed_by": "account2", "value": 4},
        "kind": "synthetic",
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
    }
    original = deepcopy(row)
    with sqlite_session_factory() as s:
        removed_body = project_record(s, table, row, "hospital/pharmacy", "p0")
        assert row == original
        assert all(r["data"] == {} for r in removed_body["retained"]["subject_records"])
        removed_actor = project_record(s, table, row, "hospital/pharmacy", "p2")
        preserved_body = next(
            r
            for r in removed_actor["retained"]["subject_records"]
            if r["person_id"] == "p0"
        )
        assert preserved_body["data"] == {"person_id": "p0", "value": 4}
        # Both erasure orders preserve exactly the remaining role/body information.
        first = project_partial(removed_body, "p2")
        second = project_partial(removed_actor, "p0")
        assert first["retained"] == second["retained"]
        assert first["retained"]["people"] == [{"person_id": "p1"}]
        assert not first["publishable"] and not first["replayable"]
        both_actors_removed = project_partial(
            project_record(s, table, row, "hospital/pharmacy", "p1"), "p2"
        )
        assert both_actors_removed["retained"]["subject_records"] == [
            {
                "person_id": "p0",
                "roles": ["body_subject"],
                "accounts": [],
                "data": {"person_id": "p0", "value": 4},
            }
        ]


def test_ambiguous_account_and_joint_body_remain_blocked(sqlite_session_factory):
    with sqlite_session_factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="one",
                issuer="oidc",
                subject="actor",
                person_id="p1",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        s.add(
            AccountMembership(
                membership_id="two",
                issuer="other",
                subject="actor",
                person_id="p2",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
    with sqlite_session_factory() as s, pytest.raises(ValueError, match="unresolved"):
        project_record(
            s,
            "privacy_cases",
            {"person_id": "p0", "actor": "actor", "payload": {}},
            "hospital/pharmacy",
            "p0",
        )


def test_multi_subject_event_erases_actor_and_affected_people_in_both_orders(
    sqlite_session_factory,
):
    with sqlite_session_factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="actor",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
    row = {
        "kind": "actual.import",
        "actor": "operator-account",
        "payload": {"person_ids": ["p0", "p1"], "count": 3, "source_hash": "a" * 64},
    }
    original = deepcopy(row)
    with sqlite_session_factory() as s:
        first = project_record(
            s, "planning_outbox", row, "hospital/pharmacy", "operator-person"
        )
        assert "operator-account" not in str(first)
        assert "count" not in first["retained"]
        second = project_partial(first, "p0")
        reverse = project_partial(
            project_record(s, "planning_outbox", row, "hospital/pharmacy", "p0"),
            "operator-person",
        )
        assert second["retained"] == reverse["retained"]
        assert second["retained"]["people"] == [{"person_id": "p1"}]
        assert not second["replayable"]
        with pytest.raises(ValueError, match="Unknown"):
            project_record(
                s,
                "planning_outbox",
                {**row, "payload": {**row["payload"], "prose": "unknown joint owner"}},
                "hospital/pharmacy",
                "p0",
            )
    assert row == original


def test_arbitrary_explicit_person_array_with_joint_text_is_not_a_supported_schema(
    sqlite_session_factory,
):
    with sqlite_session_factory() as session:
        for table in ("compliance_entities", "privacy_cases", "actual_work_events"):
            row = {
                "payload": {
                    "records": [{"person_id": "p0"}, {"person_id": "p1"}],
                    "joint_free_text": "unattributable shared account",
                }
            }
            with pytest.raises(ValueError, match="schema-specific adapter"):
                project_record(session, table, row, "hospital/pharmacy", "p0")


def test_change_case_projection_partitions_duties_and_omits_joint_evidence(
    sqlite_session_factory,
):
    from tests.test_reviewed_planning import snapshot

    data = snapshot(2, 1)
    duties = [d.model_dump(mode="json") for d in data.candidates]
    at = datetime(2026, 1, 1, tzinfo=UTC)
    with sqlite_session_factory.begin() as s:
        s.add(PlanningScope(scope_id="hospital/pharmacy"))
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        s.add(
            PlanningInput(
                input_hash=data.input_hash,
                scope_id="hospital/pharmacy",
                input_revision=1,
                payload=data.model_dump(mode="json"),
                created_by="operator-account",
            )
        )
        s.add(
            PlanningPublication(
                publication_id="pub",
                draft_id="draft",
                scope_id="hospital/pharmacy",
                period_key="2026-01",
                version=1,
                published_by="operator-account",
                payload={
                    "input_hash": data.input_hash,
                    "assignments": [duties[0]],
                    "leave_allocations": [],
                },
            )
        )
    row = {
        "case_id": "case-secret",
        "scope_id": "hospital/pharmacy",
        "publication_id": "pub",
        "kind": "SWAP",
        "status": "READY",
        "version": 2,
        "affected_assignments": [duties[0]],
        "proposed_assignments": [duties[1]],
        "validation": {"person_ids": ["p0", "p1"], "private": "omit-me"},
        "evidence": {"reason": "omit-this-prose"},
        "created_by": "operator-account",
        "created_at": at,
        "updated_at": at,
    }
    with sqlite_session_factory() as s:
        projected = project_workflow_record(
            s, "planning_change_cases", row, "hospital/pharmacy", "p0"
        )
        assert [p["person_id"] for p in projected["retained"]["people"]] == [
            "operator-person",
            "p1",
        ]
        assert "case-secret" not in str(projected)
        assert "omit-this-prose" not in str(projected)
        p1 = next(
            r
            for r in projected["retained"]["subject_records"]
            if r["person_id"] == "p1"
        )
        assert [d["duty_id"] for d in p1["data"]["proposed_assignments"]] == [
            duties[1]["duty_id"]
        ]
        assert p1["data"]["affected_assignments"] == []
        final = project_partial(projected, "operator-person")
        assert final["retained"]["people"] == [{"person_id": "p1"}]
        assert not final["replayable"] and not final["publishable"]


def test_lifecycle_projection_keeps_task_state_but_not_task_evidence(
    sqlite_session_factory,
):
    at = datetime(2026, 1, 1, tzinfo=UTC)
    with sqlite_session_factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
    row = {
        "case_id": "lifecycle-secret",
        "scope_id": "hospital/pharmacy",
        "person_id": "p0",
        "kind": "OFFBOARD",
        "effective_date": at.date(),
        "status": "IN_PROGRESS",
        "version": 2,
        "tasks": [
            {
                "key": "contract_end",
                "status": "COMPLETED",
                "completed_at": at.isoformat(),
                "evidence": {"reason": "private-task-note"},
            },
            {
                "key": "candidate_exclusion",
                "status": "NOT_STARTED",
                "completed_at": None,
            },
            {"key": "balance_review", "status": "NOT_STARTED", "completed_at": None},
            {
                "key": "membership_deactivation",
                "status": "NOT_STARTED",
                "completed_at": None,
            },
        ],
        "evidence": {"reason": "private-case-note"},
        "created_by": "operator-account",
        "created_at": at,
        "updated_at": at,
    }
    with sqlite_session_factory() as s:
        projected = project_workflow_record(
            s, "staff_lifecycle_cases", row, "hospital/pharmacy", "operator-person"
        )
        assert projected["retained"]["people"] == [{"person_id": "p0"}]
        text = str(projected)
        assert "private-task-note" not in text and "private-case-note" not in text
        assert "contract_end" in text and "COMPLETED" in text


def test_new_change_outbox_event_uses_case_subjects_and_omits_evidence(
    sqlite_session_factory,
):
    from tests.test_reviewed_planning import snapshot

    duties = [d.model_dump(mode="json") for d in snapshot(2, 1).candidates]
    at = datetime(2026, 1, 1, tzinfo=UTC)
    with sqlite_session_factory.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        s.add(
            PlanningChangeCase(
                case_id="change-1",
                scope_id="hospital/pharmacy",
                publication_id="pub",
                kind="SWAP",
                status="AWAITING_CONSENT",
                version=1,
                affected_assignments=[duties[0]],
                proposed_assignments=[duties[1]],
                validation={},
                evidence={},
                created_by="operator-account",
                created_at=at,
                updated_at=at,
            )
        )
    event = {
        "kind": "change.swap.created",
        "actor": "operator-account",
        "created_at": at,
        "payload": {
            "case_id": "change-1",
            "person_ids": ["p0", "p1"],
            "publishable": True,
            "evidence": {"reason": "private-event-note"},
        },
    }
    with sqlite_session_factory() as s:
        projected = project_outbox(s, event, "hospital/pharmacy", "p0")
        assert [p["person_id"] for p in projected["retained"]["people"]] == [
            "operator-person",
            "p1",
        ]
        assert "private-event-note" not in str(projected)
        assert all(
            record["data"].get("event_fields") == {"publishable": True}
            for record in projected["retained"]["subject_records"]
            if record["person_id"] == "p1"
        )
