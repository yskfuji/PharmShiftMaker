from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from shift_scheduler.api.main import app
from shift_scheduler.api.routers.workflows import personal_duties
from shift_scheduler.application import ideal_workflows, planning
from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningChangeCase,
    PlanningChangeEvent,
    PlanningOutbox,
    PlanningPublication,
    PlanningScope,
)


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as value:
        value.add(
            PlanningScope(scope_id="hospital/pharmacy", display_name="合成病院 薬剤部")
        )
        # Staff registered in the contract workflow; accounts can be linked only to them.
        for person in ("person-1", "person-2"):
            value.add(
                ComplianceEntity(
                    key=f"person-{person}",
                    scope_id="hospital/pharmacy",
                    kind="person",
                    entity_id=person,
                    person_id=person,
                    payload={"name": person},
                )
            )
        value.commit()
        yield value


def test_named_openapi_contracts_are_exposed() -> None:
    schema = app.openapi()
    names = {
        "PlanningScopeSummary",
        "MembershipRevision",
        "ScheduleChangeCase",
        "LifecycleCase",
        "PersonalScheduleExport",
    }
    assert names <= set(schema["components"]["schemas"])
    assert "/planning/change-cases/{case_id}/approve" in schema["paths"]
    assert "/planning/change-cases/{case_id}/consent" in schema["paths"]
    assert "/planning/personal-schedule/{publication_id}/content" in schema["paths"]


def test_membership_link_is_idempotent_and_deactivation_preserves_row(
    session: Session,
) -> None:
    request = {
        "scope_id": "hospital/pharmacy",
        "actor": "admin-1",
        "issuer": "https://id.example",
        "subject": "synthetic-user",
        "person_id": "person-1",
        "role": "PHARMACIST",
        "evidence": {"reason": "入職確認", "reference": "LFC-1"},
        "expected_version": 0,
        "idempotency_key": "membership-0001",
    }
    first = ideal_workflows.link_membership(session, **request)
    replay = ideal_workflows.link_membership(session, **request)
    assert replay == first
    assert first["revision"] == 1
    deactivated = ideal_workflows.deactivate_membership(
        session,
        scope_id="hospital/pharmacy",
        actor="admin-1",
        actor_membership_id="m-admin-1",
        membership_id=first["membership_id"],
        expected_version=1,
        evidence={"reason": "退職確認", "reference": "LFC-2"},
        idempotency_key="membership-0002",
    )
    assert deactivated["active"] is False
    assert deactivated["revision"] == 2
    assert deactivated["deactivated_at"] is not None
    assert {row.kind for row in session.scalars(select(PlanningOutbox))} == {
        "membership.linked",
        "membership.deactivated",
    }
    with pytest.raises(planning.Conflict, match="already inactive"):
        ideal_workflows.deactivate_membership(
            session,
            scope_id="hospital/pharmacy",
            actor="admin-1",
            actor_membership_id="m-admin-1",
            membership_id=first["membership_id"],
            expected_version=2,
            evidence={"reason": "退職確認", "reference": "LFC-3"},
            idempotency_key="membership-0003",
        )


def test_last_administrator_cannot_be_deactivated_even_by_another_membership(
    session: Session,
) -> None:
    session.add(
        AccountMembership(
            membership_id="only-admin",
            issuer="mock",
            subject="admin",
            person_id="person-1",
            scope_id="hospital/pharmacy",
            role="ADMIN",
            active=True,
        )
    )
    session.flush()
    with pytest.raises(planning.Conflict, match="last active administrator"):
        ideal_workflows.deactivate_membership(
            session,
            scope_id="hospital/pharmacy",
            actor="break-glass-reviewer",
            actor_membership_id="other-admin",
            membership_id="only-admin",
            expected_version=1,
            evidence={"reason": "権限変更", "reference": "SEC-1"},
            idempotency_key="last-admin-0001",
        )


def test_idempotency_key_cannot_be_reused_for_different_membership(
    session: Session,
) -> None:
    base = {
        "scope_id": "hospital/pharmacy",
        "actor": "admin-1",
        "issuer": "https://id.example",
        "subject": "synthetic-user",
        "role": "PHARMACIST",
        "evidence": {"reason": "入職確認", "reference": "LFC-1"},
        "expected_version": 0,
        "idempotency_key": "membership-0001",
    }
    ideal_workflows.link_membership(session, person_id="person-1", **base)
    with pytest.raises(planning.Conflict, match="Idempotency"):
        ideal_workflows.link_membership(session, person_id="person-2", **base)


def test_only_attestation_lifecycle_tasks_are_manually_revisioned(
    session: Session,
) -> None:
    created = ideal_workflows.create_lifecycle_case(
        session,
        scope_id="hospital/pharmacy",
        actor="admin-1",
        person_id="person-2",
        kind="OFFBOARD",
        effective_date=date(2026, 10, 31),
        evidence={"reason": "本人届出", "reference": "HR-42"},
        idempotency_key="lifecycle-0001",
    )
    updated = ideal_workflows.complete_lifecycle_task(
        session,
        scope_id="hospital/pharmacy",
        actor="admin-1",
        case_id=created["case_id"],
        task_key="balance_review",
        expected_version=1,
        evidence={"reason": "契約終了確認", "reference": "HR-42"},
        idempotency_key="lifecycle-0002",
    )
    assert updated["version"] == 2
    assert (
        next(task for task in updated["tasks"] if task["key"] == "balance_review")[
            "status"
        ]
        == "COMPLETED"
    )
    with pytest.raises(planning.Conflict, match="already completed"):
        ideal_workflows.complete_lifecycle_task(
            session,
            scope_id="hospital/pharmacy",
            actor="admin-1",
            case_id=created["case_id"],
            task_key="balance_review",
            expected_version=2,
            evidence={"reason": "上書き", "reference": "HR-43"},
            idempotency_key="lifecycle-0003",
        )

    with pytest.raises(ValueError, match="authoritative record"):
        ideal_workflows.complete_lifecycle_task(
            session,
            scope_id="hospital/pharmacy",
            actor="admin-1",
            case_id=created["case_id"],
            task_key="contract_end",
            expected_version=2,
            evidence={"reason": "手入力", "reference": "HR-44"},
            idempotency_key="lifecycle-0004",
        )


def test_personal_export_filter_never_includes_other_people() -> None:
    start = datetime(2026, 10, 12, 0, tzinfo=UTC)

    def duty(identifier: str, person: str, offset: int) -> dict[str, object]:
        duty_start = start + timedelta(days=offset, hours=8)
        duty_end = duty_start + timedelta(hours=8)
        return {
            "duty_id": identifier,
            "person_id": person,
            "relationship_id": f"rel-{person}",
            "kind": "日勤",
            "location": "中央病棟",
            "task": "調剤",
            "start": duty_start.isoformat(),
            "end": duty_end.isoformat(),
            "work": [{"start": duty_start.isoformat(), "end": duty_end.isoformat()}],
            "breaks": [],
            "source": "published",
            "fixed": False,
            "statutory_holiday": False,
            "external_employer_id": None,
        }

    publication = PlanningPublication(
        publication_id="pub-1",
        draft_id="draft-1",
        scope_id="hospital/pharmacy",
        period_key="2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00",
        version=1,
        payload={"assignments": [duty("d1", "person-1", 0), duty("d2", "person-2", 1)]},
        published_by="leader",
    )
    result = personal_duties(publication, "person-1")
    assert [item.duty_id for item in result] == ["d1"]
    assert {item.person_id for item in result} == {"person-1"}


def test_change_replacement_keeps_every_unaffected_assignment() -> None:
    published = [{"duty_id": "d1"}, {"duty_id": "d2"}, {"duty_id": "d3"}]
    assert ideal_workflows.merged_assignment_ids(published, ["d2"], ["d4"]) == (
        "d1",
        "d3",
        "d4",
    )
    with pytest.raises(ValueError, match="Unknown affected"):
        ideal_workflows.merged_assignment_ids(published, ["missing"], ["d4"])


def test_swap_requires_each_affected_persons_consent(session: Session) -> None:
    now = datetime.now(UTC)
    row = PlanningChangeCase(
        case_id="case-1",
        scope_id="hospital/pharmacy",
        publication_id="publication-1",
        kind="SWAP",
        status="AWAITING_CONSENT",
        version=1,
        affected_assignments=[],
        proposed_assignments=[],
        validation={
            "publishable": True,
            "required_consent_person_ids": ["person-1", "person-2"],
            "consented_person_ids": [],
        },
        evidence={"reason": "本人申請", "reference": "SWAP-1"},
        created_by="person-1",
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    first = ideal_workflows.consent_change_case(
        session,
        scope_id="hospital/pharmacy",
        actor="user-1",
        person_id="person-1",
        case_id="case-1",
        expected_version=1,
        evidence={"reason": "交換同意", "reference": "SWAP-1"},
        idempotency_key="consent-person-1",
    )
    assert first["status"] == "AWAITING_CONSENT"
    second = ideal_workflows.consent_change_case(
        session,
        scope_id="hospital/pharmacy",
        actor="user-2",
        person_id="person-2",
        case_id="case-1",
        expected_version=2,
        evidence={"reason": "交換同意", "reference": "SWAP-1"},
        idempotency_key="consent-person-2",
    )
    assert second["status"] == "READY"
    assert second["validation"]["consented_person_ids"] == ["person-1", "person-2"]
    assert len(session.scalars(select(PlanningChangeEvent)).all()) == 2


def test_membership_cannot_be_moved_to_another_or_unknown_person(
    session: Session,
) -> None:
    base = {
        "scope_id": "hospital/pharmacy",
        "actor": "admin-1",
        "issuer": "https://id.example",
        "subject": "synthetic-user",
        "role": "PHARMACIST",
        "evidence": {"reason": "入職確認", "reference": "LFC-1"},
    }
    with pytest.raises(ValueError, match="not in this scope"):
        ideal_workflows.link_membership(
            session,
            person_id="stranger",
            expected_version=0,
            idempotency_key="membership-x001",
            **base,
        )
    first = ideal_workflows.link_membership(
        session,
        person_id="person-1",
        expected_version=0,
        idempotency_key="membership-x002",
        **base,
    )
    with pytest.raises(planning.Conflict, match="another person"):
        ideal_workflows.link_membership(
            session,
            person_id="person-2",
            expected_version=1,
            idempotency_key="membership-x003",
            **base,
        )
    promoted = ideal_workflows.link_membership(
        session,
        person_id="person-1",
        expected_version=1,
        idempotency_key="membership-x004",
        **{**base, "role": "LEADER"},
    )
    assert promoted["revision"] == 2 and promoted["person_id"] == first["person_id"]
    assert promoted["evidence"]["previous"]["reference"] == "LFC-1"


def test_ical_lines_fold_at_75_octets_without_splitting_characters() -> None:
    from shift_scheduler.api.routers.workflows import ical_fold

    line = "LOCATION:" + "中央病棟の調剤室・無菌調製室" * 6
    folded = ical_fold(line).encode("utf-8").split(b"\r\n")
    assert len(folded) > 1
    assert all(len(part) <= 75 for part in folded)
    assert all(part.startswith(b" ") for part in folded[1:])
    assert (
        b"".join([folded[0], *[part[1:] for part in folded[1:]]]).decode("utf-8")
        == line
    )
    assert ical_fold("SUMMARY:日勤") == "SUMMARY:日勤"
