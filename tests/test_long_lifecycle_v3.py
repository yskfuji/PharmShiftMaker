"""25 sequential months against one database; synthetic calendar, never real staff."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from shift_scheduler.application import compliance
from shift_scheduler.application import planning as app
from shift_scheduler.db.planning_models import (
    PlanningInput,
    PlanningPublication,
    PlanningScope,
)
from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import Duty, Interval
from shift_scheduler.optimizer.planning import solve
from tests.test_catalogue_v3 import data
from tests.test_reviewed_planning import db as _db

db = _db
JST = ZoneInfo("Asia/Tokyo")


def month_start(index):
    year, month = divmod(2026 * 12 + index, 12)
    return datetime(year, month + 1, 1, tzinfo=JST)


def run_months(db, monkeypatch, *, night=False):
    template = data().model_dump(mode="json")
    template["policy_evidence"]
    if night:
        template["contracts"][0]["allowed_kinds"] = ["NIGHT"]
        template["duty_templates"][0].update(kind="NIGHT", start_second=20 * 3600)
    all_contracts = []
    all_employment = []
    scopes = "hospital/pharmacy"
    public = []
    for index in range(25):
        begin, end = month_start(index), month_start(index + 1)
        # Each month is published on its first day of the simulated timeline.
        monkeypatch.setattr(
            "shift_scheduler.application.rule_impact.today",
            lambda timezone, day=begin.date(): day,
        )
        payload = dict(template)
        payload["source_revision"] = index
        payload["period"] = {
            "start": begin.isoformat(),
            "end": end.isoformat(),
        }
        payload["context"] = {
            "start": (begin - timedelta(days=400)).isoformat(),
            "end": (end + timedelta(days=14)).isoformat(),
        }
        contract = dict(
            template["contracts"][0],
            revision_id=f"c{index}",
            start=begin.isoformat(),
            end=end.isoformat(),
            period_max_seconds=(end - begin).days * 4 * 3600,
            contractual_week_seconds=40 * 3600,
        )
        all_contracts.append(contract)
        holiday = 6
        employment = dict(
            template["employments"][0],
            revision_id=f"emp{index}",
            start=begin.isoformat(),
            end=end.isoformat(),
            statutory_holidays=[
                (begin + timedelta(days=i)).date().isoformat()
                for i in range((end - begin).days)
                if (begin + timedelta(days=i)).weekday() == holiday
            ],
        )
        all_employment.append(employment)
        payload["contracts"] = list(all_contracts)
        payload["employments"] = list(all_employment)
        payload["establishments"] = [
            dict(
                template["establishments"][0],
                start="2020-01-01T00:00:00+09:00",
                end="2040-01-01T00:00:00+09:00",
            )
        ]
        payload["capabilities"] = [
            dict(
                template["capabilities"][0],
                start="2020-01-01T00:00:00+09:00",
                end="2040-01-01T00:00:00+09:00",
            )
        ]
        payload["rule_reviews"] = [
            dict(
                template["rule_reviews"][0],
                review_id=f"review{index}",
                start=begin.isoformat(),
                end=end.isoformat(),
                reviewed_on=begin.date().isoformat(),
                next_review_on=end.date().isoformat(),
            )
        ]
        payload["duty_templates"] = [
            dict(
                template["duty_templates"][0],
                dates=[
                    (begin + timedelta(days=day)).date().isoformat()
                    for day in range((end - begin).days)
                ],
            )
        ]
        payload["candidates"] = []
        payload["work_terms"] = []
        payload["history"] = []
        payload["demands"] = [
            dict(
                template["demands"][0],
                demand_id=f"d{index}-{day}",
                start=(
                    begin + timedelta(days=day, hours=20 if night else 9)
                ).isoformat(),
                end=(
                    begin + timedelta(days=day, hours=24 if night else 13)
                ).isoformat(),
            )
            for day in range((end - begin).days)
            if (begin + timedelta(days=day)).weekday() != holiday
        ]
        candidate = SolverSnapshotV3.model_validate(payload)
        catalogue = generate_catalogue(candidate)
        payload["candidates"] = catalogue["candidates"]
        payload["work_terms"] = catalogue["work_terms"]
        candidate = parse_snapshot(payload)
        with db.begin() as session:
            if index == 12:
                old_publication = session.get(
                    PlanningPublication, public[6]["publication_id"]
                )
                original = Duty.model_validate(
                    old_publication.payload["assignments"][0]
                )
                actual = original.model_copy(
                    update={
                        "duty_id": "late-july-actual",
                        "source": "actual",
                        "end": original.end + timedelta(hours=1),
                        "work": (
                            Interval(
                                start=original.start,
                                end=original.end + timedelta(hours=1),
                            ),
                        ),
                    }
                )
                compliance.save_entity(
                    session,
                    scopes,
                    "work_terms",
                    {
                        "duty_id": actual.duty_id,
                        "employment_revision_id": "emp6",
                        "scheduled_work": [
                            w.model_dump(mode="json") for w in original.work
                        ],
                        "planned_publication_id": old_publication.publication_id,
                        "planned_duty_id": original.duty_id,
                    },
                    0,
                    "synthetic",
                )
                app.import_actual(
                    session, scopes, "synthetic", "july-actual", 1, actual
                )
            current = session.get(PlanningScope, scopes)
            revision = current.input_revision if current else 0
            app.register_input(session, candidate, "synthetic", revision)
            refreshed = app.refresh_input(session, scopes, "synthetic", revision + 1)
            row = session.get(PlanningInput, refreshed["input_hash"])
            ready = parse_snapshot(row.payload)
            if index == 12:
                assert sum(d.duty_id == "late-july-actual" for d in ready.history) == 1
                assert not any(
                    d.duty_id.endswith(":" + original.duty_id) for d in ready.history
                )
            if night and index:
                for burden in ready.burden_history:
                    if burden.kind != "night":
                        continue
                    counted_days = sum(
                        (burden.period_start + timedelta(days=d)).weekday() != 6
                        for d in range((burden.period_end - burden.period_start).days)
                    )
                    late_hour = (
                        3600
                        if index >= 12 and burden.period_start == month_start(6).date()
                        else 0
                    )
                    assert burden.seconds == counted_days * 2 * 3600 + late_hour
            solved = solve(ready, 5)
            assert solved.status == "OPTIMAL", (index, solved)
            draft = app.new_draft(session, row, solved.proposal, "synthetic")
            session.flush()
            review = app.review_draft(session, draft.draft_id, scopes, 1, "synthetic")
            assert review["publishable"], (index, review)
            result = app.publish(
                session,
                draft.draft_id,
                scopes,
                "synthetic",
                1,
                0,
                row.input_hash,
                review["review_hash"],
                f"month-{index}",
            )
            public.append(result)
    with db() as session:
        assert len(session.scalars(select(PlanningPublication)).all()) == 25
        assert (
            len(
                {r.publication_id for r in session.scalars(select(PlanningPublication))}
            )
            == 25
        )
        last = session.scalar(
            select(PlanningInput).order_by(PlanningInput.input_revision.desc())
        )
        history = parse_snapshot(last.payload).burden_history
        assert len({h.period_start for h in history}) == 12
        if night:
            night_rows = [h for h in history if h.kind == "night"]
            assert len(night_rows) == 12
            for row in night_rows:
                # Independent interval oracle: 20:00-24:00 contains two hours in 22:00-05:00.
                expected_days = sum(
                    (row.period_start + timedelta(days=d)).weekday() != 6
                    for d in range((row.period_end - row.period_start).days)
                )
                assert row.seconds == expected_days * 2 * 3600
                assert row.seconds > 0 and row.eligible_seconds >= row.seconds
        else:
            assert all(h.seconds == 0 for h in history)


def test_25_month_publication_history_and_late_actual(db, monkeypatch):
    run_months(db, monkeypatch)
