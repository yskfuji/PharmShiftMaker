"""Independent arithmetic oracles, in seconds, not copied from production functions."""

from datetime import date, timedelta

import pytest

from shift_scheduler.domain.compliance import SolverSnapshotV2, parse_snapshot
from shift_scheduler.validation.leave_accounting import account_leave
from shift_scheduler.validation.work_accounting import (
    account_work,
    month_boundary,
    month_index,
)
from tests.test_reviewed_planning import snapshot


def v2():
    base = snapshot(1, 7)
    payload = base.model_dump(mode="json")
    payload.update(
        schema_version=2,
        employments=[
            {
                "revision_id": "emp-A",
                "relationship_id": "e0",
                "person_id": "p0",
                "employer_id": "hospital",
                "contract_order": 1,
                "start": base.context.start,
                "end": base.context.end,
                "calendar_confirmed": True,
                "statutory_holidays": [
                    (base.context.start + timedelta(days=i)).date().isoformat()
                    for i in range((base.context.end - base.context.start).days)
                    if (base.context.start + timedelta(days=i)).weekday() == 6
                ],
                "declaration": base.policy_evidence.model_dump(mode="json"),
            }
        ],
        work_terms=[
            {
                "duty_id": d.duty_id,
                "employment_revision_id": "emp-A",
                "scheduled_work": [w.model_dump(mode="json") for w in d.work],
            }
            for d in base.candidates
        ],
    )
    return SolverSnapshotV2.model_validate(payload)


def test_unknown_contract_order_is_unverified_without_guessed_attribution():
    data = v2()
    payload = data.model_dump(mode="json")
    payload["employments"][0]["contract_order"] = None
    unknown = SolverSnapshotV2.model_validate(payload)
    report = account_work(unknown, list(unknown.candidates))
    assert not report["trace"]
    assert any(
        f.status == "unverified" and "Contract order" in f.message
        for f in report["findings"]
    )


def work_fixture(specs, orders=(1, 2), method="standard"):
    """specs: employer letter, day offset, start hour, hours, scheduled hours."""
    data = v2()
    payload = data.model_dump(mode="json")
    payload["candidates"] = []
    payload["demands"] = []
    payload["work_terms"] = []
    payload["employments"] = []
    payload["agreements"] = []
    for i, order in enumerate(orders):
        employer = chr(65 + i)
        payload["employments"].append(
            dict(
                payload_employment(data),
                revision_id="emp-" + employer,
                relationship_id=employer,
                employer_id=employer,
                contract_order=order,
                method=method,
                agreement_id="36-" + employer,
            )
        )
        payload["agreements"].append(
            {
                "agreement_id": "36-" + employer,
                "employer_id": employer,
                "start": data.context.start,
                "end": data.context.end,
                "year_start": "2026-01-01",
                "month_anchor": "2026-01-01",
                "daily_limit_seconds": 8 * 3600,
                "monthly_limit_seconds": 45 * 3600,
                "annual_limit_seconds": 360 * 3600,
                "evidence": data.policy_evidence,
                "holiday_work_permitted": True,
            }
        )
    for i, (employer, day, hour, hours, scheduled) in enumerate(specs):
        start = data.period.start + timedelta(days=day, hours=hour)
        end = start + timedelta(hours=hours)
        duty = {
            "duty_id": str(i),
            "person_id": "p0",
            "relationship_id": employer,
            "kind": "DAY",
            "location": "main",
            "task": "dispensing",
            "start": start,
            "end": end,
            "work": [{"start": start, "end": end}],
        }
        payload["candidates"].append(duty)
        payload["work_terms"].append(
            {
                "duty_id": str(i),
                "employment_revision_id": "emp-" + employer,
                "scheduled_work": (
                    [{"start": start, "end": start + timedelta(hours=scheduled)}]
                    if scheduled
                    else []
                ),
            }
        )
    return SolverSnapshotV2.model_validate(payload)


def payload_employment(data):
    return data.employments[0].model_dump(mode="json")


def totals(report):
    return {
        employer: sum(
            r["overtime_seconds"]
            for r in report["trace"]
            if r["employer_id"] == employer
        )
        for employer in {"A", "B", "C"}
    }


def test_v1_hash_is_unchanged_and_v2_dispatches():
    old = snapshot()
    assert parse_snapshot(old.model_dump(mode="json")).input_hash == old.input_hash
    assert isinstance(parse_snapshot(v2().model_dump(mode="json")), SolverSnapshotV2)


@pytest.mark.parametrize(
    "orders,expected",
    [((1, 2), {"A": 0, "B": 7200, "C": 0}), ((2, 1), {"A": 7200, "B": 0, "C": 0})],
)
def test_contract_order_reversal_changes_payer(orders, expected):
    data = work_fixture([("A", 0, 7, 7, 7), ("B", 0, 15, 3, 3)], orders)
    assert totals(account_work(data, list(data.candidates))) == expected


def test_scheduled_before_extra_not_wall_clock_alone():
    data = work_fixture([("A", 0, 7, 8, 7), ("B", 0, 16, 2, 1)])
    assert totals(account_work(data, list(data.candidates))) == {
        "A": 3600,
        "B": 3600,
        "C": 0,
    }


def test_daily_weekly_excess_not_double_counted():
    data = work_fixture([("A", d, 7, 9, 9) for d in range(5)] + [("A", 5, 7, 4, 4)])
    # 49h worked: 5 daily excess + 4 weekly excess = 9, not 14.
    assert totals(account_work(data, list(data.candidates)))["A"] == 9 * 3600


def test_three_employers_and_nonemployment():
    data = work_fixture(
        [("A", 0, 6, 4, 4), ("B", 0, 11, 4, 4), ("C", 0, 16, 2, 2)], (1, 2, 3)
    )
    assert totals(account_work(data, list(data.candidates)))["C"] == 7200
    data = data.model_copy(
        update={
            "employments": (
                *data.employments[:2],
                data.employments[2].model_copy(update={"activity": "nonemployment"}),
            )
        }
    )
    report = account_work(data, list(data.candidates))
    assert totals(report)["C"] == 0 and report["nonemployment_seconds"] == 7200


def test_management_model_second_employer_all_hours():
    data = work_fixture([("A", 0, 6, 6, 6), ("B", 0, 13, 1, 1)], method="management")
    payload = data.model_dump(mode="json")
    payload["management_models"] = [
        {
            "model_id": "AB",
            "person_id": "p0",
            "first_employer": "A",
            "second_employer": "B",
            "start": data.context.start,
            "end": data.context.end,
            "month_anchor": "2026-01-01",
            "first_month_limit_seconds": 40 * 3600,
            "second_month_limit_seconds": 40 * 3600,
            "first_consent": data.policy_evidence,
            "second_consent": data.policy_evidence,
            "notification": data.policy_evidence,
        }
    ]
    data = SolverSnapshotV2.model_validate(payload)
    assert totals(account_work(data, list(data.candidates))) == {
        "A": 0,
        "B": 3600,
        "C": 0,
    }
    data = data.model_copy(update={"management_models": ()})
    assert any(
        f.status == "unverified"
        for f in account_work(data, list(data.candidates))["findings"]
    )


def test_noncalendar_anchor_and_leap_clamp():
    assert month_index(date(2026, 1, 21), date(2026, 2, 20)) == 0
    assert month_index(date(2026, 1, 21), date(2026, 2, 21)) == 1
    assert month_boundary(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert month_boundary(date(2028, 1, 31), 2) == date(2028, 3, 31)


def leave_fixture(events=()):
    data = v2()
    payload = data.model_dump(mode="json")
    payload.update(
        leave_accounts=[
            {
                "account_id": "g",
                "person_id": "p0",
                "employer_id": "hospital",
                "granted_on": "2026-01-01",
                "expires_on": "2028-01-01",
                "statutory_days": 10,
                "granted_days": 10,
                "evidence": data.policy_evidence,
            }
        ],
        leave_policies=[
            {
                "policy_id": "lp",
                "person_id": "p0",
                "employer_id": "hospital",
                "start": "2026-01-01T00:00:00+09:00",
                "end": "2027-01-01T00:00:00+09:00",
                "hours_per_day": 8,
                "hourly_enabled": True,
                "half_day_enabled": True,
                "hourly_year_start": "2026-01-01",
                "evidence": data.policy_evidence,
            }
        ],
        leave_obligations=[
            {
                "obligation_id": "five",
                "person_id": "p0",
                "employer_id": "hospital",
                "start": "2026-01-01",
                "end": "2027-01-01",
                "qualifying_grant_ids": ["g"],
                "evidence": data.policy_evidence,
            }
        ],
        leave_records=list(events),
    )
    return SolverSnapshotV2.model_validate(payload)


def leave_event(identity, kind="take", unit="day", quantity=1, **kwargs):
    return dict(
        event_id=identity,
        account_id="g",
        kind=kind,
        unit=unit,
        quantity=quantity,
        effective_on="2026-01-06",
        policy_id="lp",
        interval={
            "start": "2026-01-06T09:00:00+09:00",
            "end": "2026-01-06T10:00:00+09:00",
        },
        evidence=v2().policy_evidence,
        **kwargs,
    )


def test_half_day_counts_hourly_does_not_and_reservation_is_not_actual():
    report = account_leave(
        leave_fixture(
            [
                leave_event("r", "reserve"),
                {
                    **leave_event("h", unit="half_day"),
                    "effective_on": "2026-01-07",
                    "interval": {
                        "start": "2026-01-07T13:00:00+09:00",
                        "end": "2026-01-07T17:00:00+09:00",
                    },
                },
                {
                    **leave_event("t", unit="hour"),
                    "effective_on": "2026-01-07",
                    "interval": {
                        "start": "2026-01-07T10:00:00+09:00",
                        "end": "2026-01-07T11:00:00+09:00",
                    },
                },
            ]
        ),
        date(2026, 9, 22),
    )
    assert not report["findings"]
    assert report["obligations"][0]["taken_half_days"] == 1
    assert report["obligations"][0]["status"] == "at_risk"
    assert report["balances"][0]["available_days"] == {
        "numerator": 67,
        "denominator": 8,
    }
    expired = account_leave(leave_fixture(), date(2028, 1, 1))
    assert expired["balances"][0]["available_days"]["numerator"] == 0
    assert expired["balances"][0]["remaining_days"]["numerator"] == 10
    assert expired["balances"][0]["availability_status"] == "expired"
    report = account_leave(leave_fixture(), date(2027, 1, 1))
    assert report["obligations"][0]["status"] == "overdue"


def test_reserve_take_reverse_release_invariants_and_overconsumption():
    events = [
        leave_event("r", "reserve"),
        leave_event("t", related_event_id="r"),
        leave_event("undo", "reverse", related_event_id="t"),
    ]
    report = account_leave(leave_fixture(events), date(2026, 9, 22))
    assert not report["findings"]
    assert report["balances"][0]["available_days"] == {
        "numerator": 10,
        "denominator": 1,
    }
    report = account_leave(
        leave_fixture([*events, leave_event("again", related_event_id="r")]),
        date(2026, 9, 22),
    )
    assert any("already" in f.message for f in report["findings"])


def test_hour_agreement_missing_and_excess_never_publishable():
    data = leave_fixture([leave_event("many", quantity=11)])
    assert any(
        "balance" in f.message
        for f in account_leave(data, date(2026, 9, 22))["findings"]
    )
    data = leave_fixture([leave_event("hour", unit="hour")])
    data = data.model_copy(
        update={
            "leave_policies": (
                data.leave_policies[0].model_copy(update={"hourly_enabled": False}),
            )
        }
    )
    assert any(
        "agreement" in f.message
        for f in account_leave(data, date(2026, 9, 22))["findings"]
    )


def test_v2_generation_publication_and_refresh_transaction(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.application import planning as service
    from shift_scheduler.db.base import Base
    from shift_scheduler.optimizer.planning import solve

    engine = create_engine("sqlite:///" + str(tmp_path / "v2.db"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    data = v2()
    candidates = tuple(d for d in data.candidates if d.start.weekday() < 5)
    data = data.model_copy(
        update={
            "candidates": candidates,
            "demands": tuple(d for d in data.demands if d.start.weekday() < 5),
            "work_terms": tuple(
                t
                for t in data.work_terms
                if t.duty_id in {d.duty_id for d in candidates}
            ),
        }
    )
    with factory.begin() as session:
        service.register_input(session, data, "admin", 0)
        result = solve(data, 5)
        assert result.proposal is not None, result.model_dump()
        assert result.validation.publishable
        row = service.require_input(session, data.input_hash, "hospital/pharmacy")
        draft = service.new_draft(session, row, result.proposal, "admin")
        session.flush()
        review = service.review_draft(
            session, draft.draft_id, "hospital/pharmacy", 1, "admin"
        )
        publication = service.publish(
            session,
            draft.draft_id,
            "hospital/pharmacy",
            "admin",
            1,
            0,
            data.input_hash,
            review["review_hash"],
            "test-v2-publication",
        )
        refreshed = service.refresh_input(session, "hospital/pharmacy", "admin", 1)
        current = parse_snapshot(
            service.require_input(
                session, refreshed["input_hash"], "hospital/pharmacy"
            ).payload
        )
        assert current.previous_duty_ids
        assert solve(current, 5).validation.publishable
        assert publication["version"] == 1
    engine.dispose()


def test_leave_does_not_block_other_employer_but_double_booking_is_detected():
    data = leave_fixture([leave_event("hour", unit="hour")])
    own = data.candidates[1]
    report = account_leave(data, date(2026, 9, 22), [own])
    assert any("Work overlaps" in f.message for f in report["findings"])
    data = data.model_copy(
        update={
            "employments": (
                data.employments[0].model_copy(update={"employer_id": "other"}),
            )
        }
    )
    assert not any(
        "Work overlaps" in f.message
        for f in account_leave(data, date(2026, 9, 22), [own])["findings"]
    )
    data = leave_fixture(
        [leave_event("one", unit="hour"), leave_event("two", unit="hour")]
    )
    assert any(
        "intervals overlap" in f.message
        for f in account_leave(data, date(2026, 9, 22))["findings"]
    )


def test_documented_conversion_ceil_and_unrelated_old_rule_rejected():
    # 10 granted days minus 6 days and 5/8 day = 3 days + 3 hours at 8h/day.
    events = [
        {
            **leave_event(f"day-{d}"),
            "effective_on": f"2026-01-{d:02d}",
            "interval": {
                "start": f"2026-01-{d:02d}T09:00:00+09:00",
                "end": f"2026-01-{d:02d}T17:00:00+09:00",
            },
        }
        for d in range(12, 18)
    ]
    events.append(
        {
            **leave_event("hours", unit="hour", quantity=5),
            "effective_on": "2026-01-07",
            "interval": {
                "start": "2026-01-07T09:00:00+09:00",
                "end": "2026-01-07T14:00:00+09:00",
            },
        }
    )
    data = leave_fixture(events)
    old = data.leave_policies[0].model_copy(
        update={"end": data.period.start.replace(month=2, day=1)}
    )
    new = old.model_copy(
        update={
            "policy_id": "new",
            "start": old.end,
            "end": data.period.start.replace(year=2027, month=1, day=1),
            "hours_per_day": 4,
        }
    )
    conversion = {
        **leave_event("conversion", "conversion", "hour", 2),
        "effective_on": "2026-02-01",
        "policy_id": "new",
        "conversion_old_hours": 8,
        "conversion_new_hours": 4,
        "interval": None,
    }
    payload = data.model_dump(mode="json")
    payload.update(
        leave_policies=[old.model_dump(mode="json"), new.model_dump(mode="json")],
        leave_records=[*payload["leave_records"], conversion],
    )
    data = SolverSnapshotV2.model_validate(payload)
    result = account_leave(data, date(2026, 9, 22))
    assert not result["findings"]
    assert result["balances"][0]["remaining_days"] == {"numerator": 7, "denominator": 2}
    assert result["conversion_trace"][0]["old_hours"] == 8
    bad = data.model_copy(
        update={
            "leave_records": (
                *data.leave_records[:-1],
                data.leave_records[-1].model_copy(update={"conversion_old_hours": 7}),
            )
        }
    )
    assert account_leave(bad, date(2026, 9, 22))["findings"]


def test_actual_links_publication_without_counting_plan_twice(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.application import compliance
    from shift_scheduler.application import planning as service
    from shift_scheduler.db.base import Base
    from shift_scheduler.domain.compliance import WorkTerms
    from shift_scheduler.optimizer.planning import solve

    engine = create_engine("sqlite:///" + str(tmp_path / "actual.db"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    data = v2()
    candidates = tuple(d for d in data.candidates if d.start.weekday() < 5)
    data = data.model_copy(
        update={
            "candidates": candidates,
            "demands": tuple(d for d in data.demands if d.start.weekday() < 5),
            "work_terms": tuple(
                t
                for t in data.work_terms
                if t.duty_id in {d.duty_id for d in candidates}
            ),
        }
    )
    scope = "hospital/pharmacy"
    with factory.begin() as session:
        service.register_input(session, data, "admin", 0)
        result = solve(data, 5)
        draft = service.new_draft(
            session,
            service.require_input(session, data.input_hash, scope),
            result.proposal,
            "admin",
        )
        session.flush()
        review = service.review_draft(session, draft.draft_id, scope, 1, "admin")
        published = service.publish(
            session,
            draft.draft_id,
            scope,
            "admin",
            1,
            0,
            data.input_hash,
            review["review_hash"],
            "actual-link-test",
        )
        original = data.candidates[0]
        actual = original.model_copy(
            update={"duty_id": "actual-new", "source": "actual"}
        )
        term = WorkTerms(
            duty_id=actual.duty_id,
            employment_revision_id="emp-A",
            scheduled_work=actual.work,
            planned_duty_id=original.duty_id,
            planned_publication_id=published["publication_id"],
        )
        compliance.save_entity(
            session, scope, "work_terms", term.model_dump(mode="json"), 0, "admin"
        )
        service.import_actual(session, scope, "admin", "clock-correction", 1, actual)
        from shift_scheduler.db.planning_models import PlanningScope

        revision = session.get(PlanningScope, scope).input_revision
        refreshed = service.refresh_input(session, scope, "admin", revision)
        data = parse_snapshot(
            service.require_input(session, refreshed["input_hash"], scope).payload
        )
        assert original.duty_id not in {d.duty_id for d in data.candidates}
        assert [d.duty_id for d in data.history if d.source == "actual"] == [
            "actual-new"
        ]
        assert solve(data, 5).validation.publishable
    engine.dispose()
