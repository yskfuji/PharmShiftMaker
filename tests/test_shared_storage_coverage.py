from copy import deepcopy

import pytest
from sqlalchemy import Column, Integer, Table

from shift_scheduler.application.copy_coverage import coverage, require_schema_coverage
from shift_scheduler.application.shared_projection import (
    planning_record,
    project,
    project_archive,
)
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import PlanningInput
from tests.test_reviewed_planning import snapshot


def test_new_table_and_field_require_inventory_review():
    assert require_schema_coverage()["schema_covered"]
    table = Table(
        "unreviewed_copy", Base.metadata, Column("id", Integer, primary_key=True)
    )
    try:
        with pytest.raises(ValueError, match="inventory changed"):
            require_schema_coverage()
        assert coverage()["missing_tables"] == ["unreviewed_copy"]
    finally:
        Base.metadata.remove(table)


@pytest.mark.parametrize("order", [("p0", "p1"), ("p1", "p0")])
def test_sequential_shared_erasure_preserves_third_person_exactly(order):
    source = snapshot(3, 1).model_dump(mode="json")
    original = deepcopy(source)
    first = project(source, order[0])
    second = project_archive(first, order[1])
    assert source == original
    for collection in ("people", "contracts", "candidates", "capabilities"):
        assert second["retained"][collection] == [
            r for r in source[collection] if r["person_id"] == "p2"
        ]
    assert second["publishable"] is False and second["replayable"] is False
    with pytest.raises(ValueError):
        project_archive({**first, "publishable": True}, order[1])


@pytest.mark.parametrize(
    "table", ["planning_jobs", "planning_drafts", "planning_publications"]
)
def test_planning_projection_keeps_only_actual_other_person_assignments(table):
    from types import SimpleNamespace

    data = snapshot(3, 1)
    selected = [d.duty_id for d in data.candidates]
    proposal = {"duty_ids": selected, "leave_ids": []}
    source = PlanningInput(
        input_hash=data.input_hash, payload=data.model_dump(mode="json")
    )

    class Session:
        def get(self, model, identity):
            return (
                source
                if model is PlanningInput
                else SimpleNamespace(input_hash=data.input_hash)
            )

    row = {
        "input_hash": data.input_hash,
        "proposal": proposal,
        "result": {"proposal": proposal},
        "status": "PUBLISHED",
        "draft_id": "d",
        "payload": {
            "proposal": proposal,
            "assignments": [d.model_dump(mode="json") for d in data.candidates],
            "leave_allocations": [],
        },
    }
    value = planning_record(Session(), table, row, "p0")
    assert {
        r["person_id"]
        for r in [
            d
            for r in value["retained"]["subject_records"]
            for d in r["data"].get("assignments", [])
        ]
    } == {"p1", "p2"}
    assert "validation" not in value["retained"]
    final = project_archive(value, "p1")
    assert [p["person_id"] for p in final["retained"]["people"]] == ["p2"]
    assert {
        r["person_id"]
        for r in [
            d
            for r in final["retained"]["subject_records"]
            for d in r["data"].get("assignments", [])
        ]
    } == {"p2"}
    assert not final["publishable"]
