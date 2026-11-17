"""A corrected actual must not erase the published plan or count it twice."""

from copy import deepcopy
from datetime import timedelta

import pytest
from sqlalchemy import select

from shift_scheduler.application import compliance, planning
from shift_scheduler.application.publication_history import carried_duties
from shift_scheduler.application.shared_projection import planning_record
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningPublication,
    PlanningScope,
)
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import Proposal, content_hash
from tests.test_compliance_v2 import v2

SCOPE = "hospital/pharmacy"


def republish(factory, version):
    with factory.begin() as session:
        revision = session.get(PlanningScope, SCOPE).input_revision
        result = planning.refresh_input(session, SCOPE, "admin", revision)
        row = session.get(PlanningInput, result["input_hash"])
        data = parse_snapshot(row.payload)
        draft = planning.new_draft(session, row, Proposal(), "admin")
        session.flush()
        review = planning.review_draft(session, draft.draft_id, SCOPE, 1, "admin")
        assert review["publishable"], review
        result = planning.publish(
            session,
            draft.draft_id,
            SCOPE,
            "admin",
            1,
            version - 1,
            row.input_hash,
            review["review_hash"],
            f"republish-{version}",
        )
        return session.get(PlanningPublication, result["publication_id"]), data


def test_republish_keeps_original_plan_across_actual_revision_and_two_successors(pg):
    data = v2().model_copy(update={"demands": ()})
    duty = data.candidates[0]
    original = duty.model_dump(mode="json")
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="admin",
                person_id="operator-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        planning.register_input(session, data, "admin", 0)
        row = session.get(PlanningInput, data.input_hash)
        draft = planning.new_draft(
            session, row, Proposal(duty_ids=(duty.duty_id,)), "admin"
        )
        session.flush()
        review = planning.review_draft(session, draft.draft_id, SCOPE, 1, "admin")
        assert review["publishable"], review
        first = planning.publish(
            session,
            draft.draft_id,
            SCOPE,
            "admin",
            1,
            0,
            data.input_hash,
            review["review_hash"],
            "original-publish",
        )
        actual = duty.model_copy(
            update={"duty_id": "attendance-0", "source": "actual", "fixed": True}
        )
        planning.import_actual(session, SCOPE, "admin", "external-clock-0", 1, actual)
        terms = data.work_terms[0].model_copy(
            update={
                "duty_id": actual.duty_id,
                "planned_duty_id": duty.duty_id,
                "planned_publication_id": first["publication_id"],
            }
        )
        compliance.save_entity(
            session, SCOPE, "work_terms", terms.model_dump(mode="json"), 0, "admin"
        )
        # Another department may have the same source-local actual identifier.
        # Even its incomplete staging record must not replace our classification.
        foreign = terms.model_copy(
            update={"planned_publication_id": "other-publication"}
        )
        compliance.save_entity(
            session,
            "hospital/other",
            "work_terms",
            foreign.model_dump(mode="json"),
            0,
            "admin",
        )
    second, reviewed = republish(pg, 2)
    assert second.payload["assignments"] == [original]
    assert duty.duty_id not in {d.duty_id for d in reviewed.candidates}
    assert [d.duty_id for d in reviewed.history if d.source == "actual"] == [
        "attendance-0"
    ]
    assert not reviewed.previous_duty_ids
    carry = second.payload["carried_assignments"][0]
    assert carry == {
        "duty_id": duty.duty_id,
        "source_publication_id": first["publication_id"],
        "actual_duty_id": actual.duty_id,
        "actual_hash": content_hash(actual.model_dump(mode="json")),
    }
    # A later correction changes actual work, never the originally notified plan.
    corrected = actual.model_copy(
        update={
            "end": actual.end + timedelta(minutes=30),
            "work": (
                actual.work[0].model_copy(
                    update={"end": actual.work[0].end + timedelta(minutes=30)}
                ),
            ),
        }
    )
    with pg.begin() as session:
        planning.import_actual(
            session, SCOPE, "admin", "external-clock-0", 2, corrected
        )
    third, latest = republish(pg, 3)
    assert third.payload["assignments"] == second.payload["assignments"] == [original]
    assert third.payload["carried_assignments"][0]["actual_hash"] == content_hash(
        corrected.model_dump(mode="json")
    )
    assert [
        d.model_dump(mode="json") for d in latest.history if d.source == "actual"
    ] == [corrected.model_dump(mode="json")]
    assert not latest.previous_duty_ids
    with pg() as session:
        assert session.get(PlanningPublication, first["publication_id"]).payload[
            "assignments"
        ] == [original]
        assert len(list(session.scalars(select(PlanningPublication)))) == 3
        # Shared preservation also verifies the carried body against its source.
        row = {
            c.name: getattr(third, c.name)
            for c in PlanningPublication.__table__.columns
        }
        projected = planning_record(
            session, "planning_publications", row, "operator-person"
        )
        assert projected["retained"]["subject_records"][0]["data"]["assignments"] == [
            original
        ]
        assert carried_duties(
            session, third.payload, latest, SCOPE, third.period_key, 3
        ) == [original]
        altered = deepcopy(third.payload)
        altered["carried_assignments"][0]["actual_hash"] = "0" * 64
        with pytest.raises(ValueError, match="hash mismatch"):
            carried_duties(session, altered, latest, SCOPE, third.period_key, 3)
        with pytest.raises(ValueError, match="hash mismatch"):
            carried_duties(
                session,
                third.payload,
                latest,
                "another/department",
                third.period_key,
                3,
            )
