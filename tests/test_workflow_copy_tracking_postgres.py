"""Physical copy tracking for workflow tables added after the original trigger."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from shift_scheduler.application import planning
from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject, ManagedCopy
from shift_scheduler.db.planning_models import (
    PlanningChangeCase,
    PlanningChangeEvent,
    StaffLifecycleCase,
    StaffLifecycleEvent,
)
from tests.test_planning_postgres import pg, prepare  # noqa: F401
from tests.test_reviewed_planning import snapshot

SCOPE = "hospital/pharmacy"


def _copy_for(session, table: str, key: str) -> ManagedCopy:
    return next(
        copy
        for copy in session.scalars(select(ManagedCopy))
        if copy.locator.get("table") == table
        and key in copy.locator.get("pk", {}).values()
    )


def test_workflow_events_inherit_case_subjects_and_erasure_barrier(pg):  # noqa: F811
    data = snapshot(2, 1)
    draft_id, review_hash = prepare(pg, data)
    with pg.begin() as session:
        publication = planning.publish(
            session,
            draft_id,
            SCOPE,
            "synthetic-admin",
            1,
            0,
            data.input_hash,
            review_hash,
            "workflow-copy-publication",
        )
        session.add(
            PlanningChangeCase(
                case_id="change-case",
                scope_id=SCOPE,
                publication_id=publication["publication_id"],
                kind="ABSENCE",
                status="DRAFT",
                version=1,
                affected_assignments=[data.candidates[0].model_dump(mode="json")],
                proposed_assignments=[],
                validation=None,
                evidence={"reason": "synthetic"},
                created_by="synthetic-admin",
            )
        )
        session.flush()
        session.add(
            PlanningChangeEvent(
                event_id="change-event",
                case_id="change-case",
                kind="CREATED",
                actor="synthetic-admin",
                evidence={"reason": "synthetic"},
            )
        )
        session.add(
            StaffLifecycleCase(
                case_id="lifecycle-case",
                scope_id=SCOPE,
                person_id="p0",
                kind="OFFBOARD",
                effective_date=date(2026, 1, 31),
                status="IN_PROGRESS",
                version=1,
                tasks=[],
                evidence={"reason": "synthetic"},
                created_by="synthetic-admin",
            )
        )
        session.flush()
        session.add(
            StaffLifecycleEvent(
                event_id="lifecycle-event",
                case_id="lifecycle-case",
                kind="CREATED",
                task_key=None,
                actor="synthetic-admin",
                evidence={"reason": "synthetic"},
            )
        )

    with pg() as session:
        for table, key in (
            ("planning_change_events", "change-event"),
            ("staff_lifecycle_events", "lifecycle-event"),
        ):
            copy = _copy_for(session, table, key)
            assert copy.scope_id == SCOPE
            assert set(
                session.scalars(
                    select(CopySubject.person_id).where(
                        CopySubject.copy_id == copy.copy_id
                    )
                )
            ) == {"p0"}

    with pg.begin() as session:
        session.add(
            ErasedSubject(
                facility_id="hospital",
                person_id="p0",
                plan_id="approved-erasure",
                created_at=datetime.now(UTC),
                evidence={"reference": "synthetic"},
            )
        )

    for event in (
        PlanningChangeEvent(
            event_id="change-reintroduction",
            case_id="change-case",
            kind="COMMENTED",
            actor="synthetic-admin",
            evidence={"reason": "must fail"},
        ),
        StaffLifecycleEvent(
            event_id="lifecycle-reintroduction",
            case_id="lifecycle-case",
            kind="COMMENTED",
            task_key=None,
            actor="synthetic-admin",
            evidence={"reason": "must fail"},
        ),
    ):
        with pytest.raises(IntegrityError), pg.begin() as session:
            session.add(event)
            session.flush()
