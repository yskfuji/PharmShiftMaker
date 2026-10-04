"""Burden history across an employment revision boundary (no database needed).

A stand-in session serves only the queries rebuild() issues for publications
without carried assignments.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest

from shift_scheduler.application.burden_history import rebuild
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    ActualWorkEvent,
    PlanningInput,
    PlanningPublication,
)
from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from tests.test_catalogue_v3 import data


class Session:
    def __init__(self, publication, source, actuals=(), entities=()):
        self.rows = {
            PlanningPublication: [publication],
            ActualWorkEvent: list(actuals),
            ComplianceEntity: list(entities),
        }
        self.inputs = {source.input_hash: source}

    def scalars(self, statement):
        return list(self.rows[statement.column_descriptions[0]["entity"]])

    def get(self, model, key):
        return self.inputs.get(key) if model is PlanningInput else None


def old_snapshot(split, holiday_on_second=False):
    payload = data().model_dump(mode="json")
    payload["contracts"][0]["allowed_kinds"] = ["NIGHT"]
    payload.update(
        candidates=[], work_terms=[]
    )  # regenerated below for the new revisions
    template = payload["duty_templates"][0]
    template.update(kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:1])
    start = parse_snapshot(payload).period.start
    base = payload["employments"][0]
    base["statutory_holidays"] = []
    if split:
        boundary = (start + timedelta(days=1)).isoformat()
        second = dict(base, revision_id="emp-B", start=boundary)
        if holiday_on_second:
            second["statutory_holidays"] = [
                (start + timedelta(days=1)).date().isoformat()
            ]
        payload["employments"] = [dict(base, revision_id="emp-A", end=boundary), second]
    raw = parse_snapshot(payload)
    generated = generate_catalogue(raw)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    return parse_snapshot(payload)


def run(old, corrected=None, with_terms=True):
    duty = old.candidates[0]
    scope = f"{old.facility_id}/{old.department_id}"
    publication = SimpleNamespace(
        publication_id="pub",
        scope_id=scope,
        period_key="p",
        version=1,
        payload={
            "input_hash": old.input_hash,
            "assignments": [duty.model_dump(mode="json")],
        },
    )
    source = SimpleNamespace(
        input_hash=old.input_hash, payload=old.model_dump(mode="json")
    )
    actuals, entities = [], []
    if corrected is not None:
        work = [
            dict(w, end=(duty.work[-1].end + corrected).isoformat())
            for w in duty.model_dump(mode="json")["work"]
        ]
        actual = dict(
            duty.model_dump(mode="json"),
            duty_id="actual-1",
            work=work,
            end=(duty.end + corrected).isoformat(),
            source="actual",
        )
        actuals.append(
            SimpleNamespace(scope_id=scope, external_id="x", revision=1, payload=actual)
        )
        terms = next(t for t in old.work_terms if t.duty_id == duty.duty_id).model_dump(
            mode="json"
        )
        entry = dict(
            terms,
            duty_id="actual-1",
            planned_duty_id=duty.duty_id,
            planned_publication_id="pub",
        )
        if not with_terms:
            entry.update(employment_revision_id="unknown", employment_revision_ids=[])
        entities.append(
            SimpleNamespace(
                scope_id=scope, entity_id="actual-1", kind="work_terms", payload=entry
            )
        )
    current = SimpleNamespace(
        period=SimpleNamespace(start=old.period.end),
        people=old.people,
        facility_id=old.facility_id,
    )
    return {
        (b.person_id, b.kind): b
        for b in rebuild(Session(publication, source, actuals, entities), current)
    }


@pytest.mark.parametrize("with_terms", [True, False])
def test_corrected_actual_crossing_an_employment_revision_is_counted(with_terms):
    result = run(
        old_snapshot(split=True), corrected=timedelta(minutes=30), with_terms=with_terms
    )
    unsplit = run(old_snapshot(split=False), corrected=timedelta(minutes=30))
    assert (
        result[("p0", "night")].seconds
        == unsplit[("p0", "night")].seconds
        == 4 * 3600 + 1800
    )


def test_holiday_on_the_later_revision_counts_the_hours_after_midnight():
    result = run(old_snapshot(split=True, holiday_on_second=True))
    # 22:00-02:00 night: the two hours after midnight fall on emp-B's statutory holiday.
    assert result[("p0", "holiday")].seconds == 2 * 3600


def test_unsplit_history_is_unchanged():
    result = run(old_snapshot(split=False))
    assert result[("p0", "night")].seconds == 4 * 3600
    assert result[("p0", "night")].eligible_seconds == 4 * 3600


def test_same_revision_id_in_two_departments_is_not_merged():
    """Review finding: revision ids are unique only within a department."""
    first = old_snapshot(split=False)
    payload = first.model_dump(mode="json")
    payload["department_id"] = "other"
    for key in ("contracts", "employments", "capabilities", "demands"):
        payload[key] = [
            dict(x, department_id="other") if "department_id" in x else x
            for x in payload[key]
        ]
    payload.update(candidates=[], work_terms=[])
    # The other department's night is on the next day (not the same hours).
    template = payload["duty_templates"][0]
    template["dates"] = [(first.period.start + timedelta(days=1)).date().isoformat()]
    raw = parse_snapshot(payload)
    generated = generate_catalogue(raw)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    second = parse_snapshot(payload)
    assert first.contracts[0].revision_id == second.contracts[0].revision_id

    def publication(old, pid):
        duty = old.candidates[0]
        return SimpleNamespace(
            publication_id=pid,
            scope_id=f"{old.facility_id}/{old.department_id}",
            period_key="p",
            version=1,
            payload={
                "input_hash": old.input_hash,
                "assignments": [duty.model_dump(mode="json")],
            },
        )

    session = Session(
        publication(first, "pub-a"),
        SimpleNamespace(
            input_hash=first.input_hash, payload=first.model_dump(mode="json")
        ),
    )
    session.rows[PlanningPublication].append(publication(second, "pub-b"))
    session.inputs[second.input_hash] = SimpleNamespace(
        input_hash=second.input_hash, payload=second.model_dump(mode="json")
    )
    current = SimpleNamespace(
        period=SimpleNamespace(start=first.period.end),
        people=first.people,
        facility_id=first.facility_id,
    )
    night = {(b.person_id, b.kind): b for b in rebuild(session, current)}[
        ("p0", "night")
    ]
    assert night.seconds == night.eligible_seconds == 2 * 4 * 3600
