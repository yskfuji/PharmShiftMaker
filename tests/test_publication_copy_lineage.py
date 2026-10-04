"""Same-table published ancestry is an explicit logical edge, never a self-loop."""

from sqlalchemy import select

from shift_scheduler.application.copy_graph import database_inventory
from shift_scheduler.application.storage_reconciliation import database_observation
from shift_scheduler.db.planning_models import PlanningPublication
from shift_scheduler.domain.planning import content_hash
from tests.test_publication_actual_history import (
    SCOPE,
)
from tests.test_publication_actual_history import (
    test_republish_keeps_original_plan_across_actual_revision_and_two_successors as create_lineage,
)


def test_carried_source_is_tracked_and_self_reference_is_not_accepted(pg):
    create_lineage(pg)
    with pg() as session:
        rows = list(
            session.scalars(
                select(PlanningPublication).order_by(PlanningPublication.version)
            )
        )
        current = rows[-1]
        key = content_hash(
            ["planning_publications", {"publication_id": current.publication_id}]
        )
        source = current.payload["carried_assignments"][0]["source_publication_id"]
        source_key = content_hash(["planning_publications", {"publication_id": source}])
        person = current.payload["assignments"][0]["person_id"]
        observed = database_inventory(session, SCOPE, person)
        record = next(r for r in observed["records"] if r["object"] == key)
        assert {"target": source_key, "kind": "logical_json"} in record["references"]
        assert not any(r["target"] == key for r in record["references"])
        assert not any(
            i["reason"] == "invalid_publication_lineage"
            for i in database_observation(session, SCOPE)["issues"]
        )
    with pg.begin() as session:
        row = session.get(PlanningPublication, current.publication_id)
        row.payload = {
            **row.payload,
            "carried_assignments": [
                {**item, "source_publication_id": row.publication_id}
                for item in row.payload["carried_assignments"]
            ],
        }
    with pg() as session:
        assert any(
            i["reason"] == "invalid_publication_lineage"
            for i in database_observation(session, SCOPE)["issues"]
        )
