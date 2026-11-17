"""L02: flextime (Art. 32-3) settled from actual work; no timed duty is planned.

Sources: Labour Standards Act Art. 32-3, 32-3-2; 平30.9.7基発0907第1号 第1の7 (monthly 50h
and final-month settlement), 旧Q&A Q3 and 平30.9.7 (the employer cannot fix start and
end times), MHLW flextime guide (91-day example: frame 520h). Expected values are
computed by hand.
"""

from datetime import date, datetime, timedelta

import pytest

from shift_scheduler.domain.compliance import Employment, parse_snapshot
from shift_scheduler.validation.work_accounting import (
    _allocate_flex,
    account_work,
    flex_frame,
    flex_period,
    input_findings,
)
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade

HOUR = 3600
EVIDENCE = {
    "reference": "synthetic work rules and agreement",
    "status": "verified",
    "verified_by": "HR",
}


def employment(**change):
    values = {
        "revision_id": "e",
        "relationship_id": "r",
        "person_id": "p",
        "employer_id": "A",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2028-01-01T00:00:00+09:00",
        "declaration": EVIDENCE,
        "working_time_system": "flex",
        "flex_anchor": "2026-04-01",
        "flex_months": 3,
        "variable_evidence": EVIDENCE,
        **change,
    }
    return Employment(**values)


def rows(entries):
    """entries: (date, seconds); one piece per day starting 09:00 JST, actual work."""
    result = []
    for i, (day, seconds) in enumerate(entries):
        start = datetime.fromisoformat(f"{day}T09:00:00+09:00")
        result.append(
            {
                "duty_id": str(i),
                "start": start,
                "end": start + timedelta(seconds=seconds),
                "day": date.fromisoformat(day),
                "calendar_day": date.fromisoformat(day),
                "seconds": seconds,
                "scheduled": False,
                "holiday": False,
                "source": "actual",
            }
        )
    return result


def days(first, count):
    start = date.fromisoformat(first)
    return [(start + timedelta(days=i)).isoformat() for i in range(count)]


def test_settlement_periods_and_frames():
    assert flex_period(date(2026, 4, 1), 3, date(2026, 6, 30)) == (
        date(2026, 4, 1),
        date(2026, 7, 1),
    )
    assert flex_period(date(2026, 4, 1), 3, date(2026, 3, 31)) == (
        date(2026, 1, 1),
        date(2026, 4, 1),
    )
    # April-June: 91 days -> 144000 x 91 / 7 = 1,872,000 s = 520h (MHLW guide).
    assert flex_frame(employment(), date(2026, 4, 1), date(2026, 7, 1)) == 520 * HOUR


def test_three_month_settlement_follows_the_guide_example():
    # April 220h, May 150h, June 170h = 540h. April's 50h limit: 50h x 30 / 7 =
    # 771,428 s (214h17m) -> 792,000 - 771,428 = 20,572 s that month. Final month:
    # 540h - 520h - 20,572 s = 51,428 s (guide: 5.8h and 14.2h, rounded).
    entries = (
        [(d, 10 * HOUR) for d in days("2026-04-01", 22)]
        + [(d, 10 * HOUR) for d in days("2026-05-01", 15)]
        + [(d, 10 * HOUR) for d in days("2026-06-01", 17)]
    )
    allocated, summaries = _allocate_flex(rows(entries), employment())
    by_month = {}
    for r in allocated:
        by_month[r["day"].month] = by_month.get(r["day"].month, 0) + r["overtime"]
    assert by_month == {4: 20572, 5: 0, 6: 51428}
    assert all(r["daily_overtime"] == r["weekly_overtime"] == 0 for r in allocated)
    assert summaries[0]["frame_seconds"] == 520 * HOUR
    assert summaries[0]["final_month_overtime_seconds"] == 51428
    assert summaries[0]["unattributed_seconds"] == 0


def test_one_month_settlement_counts_only_beyond_the_frame():
    # January (31 days): frame 637,714 s. 23 days x 7h45m = 641,700 s -> 3,986 s,
    # although no single day passes 8h (there is no daily stage).
    entries = [(d, 7 * HOUR + 45 * 60) for d in days("2026-01-05", 23)]
    allocated, _ = _allocate_flex(
        rows(entries), employment(flex_anchor="2026-01-01", flex_months=1)
    )
    assert sum(r["overtime"] for r in allocated) == 3986


def test_the_full_two_day_weekend_frame_is_eight_hours_per_scheduled_day():
    # July 2026: 23 weekdays. Standard frame 637,714 s; with Saturday and Sunday off
    # the frame is 8h x 23 = 184h. Working 8h on each weekday (184h) is then no overtime.
    weekdays = [
        d for d in days("2026-07-01", 31) if date.fromisoformat(d).weekday() < 5
    ]
    entries = [(d, 8 * HOUR) for d in weekdays]
    standard = employment(flex_anchor="2026-07-01", flex_months=1)
    special = employment(
        flex_anchor="2026-07-01",
        flex_months=1,
        flex_full_two_day_weekend=True,
        flex_rest_weekdays=(5, 6),
    )
    assert (
        sum(r["overtime"] for r in _allocate_flex(rows(entries), standard)[0])
        == 184 * HOUR - 637714
    )
    assert sum(r["overtime"] for r in _allocate_flex(rows(entries), special)[0]) == 0


def test_statutory_holiday_work_is_counted_apart():
    entries = rows([("2026-01-04", 5 * HOUR)])
    entries[0]["holiday"] = True
    allocated, summaries = _allocate_flex(
        entries, employment(flex_anchor="2026-01-01", flex_months=1)
    )
    assert (allocated[0]["holiday_seconds"], allocated[0]["overtime"], summaries) == (
        5 * HOUR,
        0,
        [],
    )


@pytest.mark.parametrize(
    "change",
    [
        {"flex_months": None},
        {"flex_months": 4},
        {"variable_evidence": None},
        {"flex_full_two_day_weekend": True, "flex_rest_weekdays": (6,)},
        {
            "working_time_system": "standard",
            "flex_anchor": None,
            "flex_months": None,
            "flex_rest_weekdays": (5, 6),
        },
    ],
)
def test_invalid_flextime_settings_are_refused(change):
    with pytest.raises(ValueError):
        employment(**change)


def adopt(payload):
    """The facility's confirmed adoption and the person's confirmed enrolment
    (flextime is off without them), from the first employment's terms."""
    e, site = payload["employments"][0], payload["establishments"][0]
    start = f"{e['flex_anchor']}T00:00:00+09:00"
    e["start"] = max(e["start"], start)
    adoption = {
        "adoption_id": "flex-1",
        "employer_id": e["employer_id"],
        "establishment_id": e["establishment_id"],
        "start": start,
        "end": site["end"],
        "target_scope": "synthetic pharmacists",
        "settlement_months": e["flex_months"],
        "settlement_anchor": e["flex_anchor"],
        "total_hours_rule": (
            "full_two_day_weekend"
            if e.get("flex_full_two_day_weekend")
            else "statutory_frame"
        ),
        "agreed_total_description": "synthetic agreed total",
        "rest_weekdays": list(e.get("flex_rest_weekdays", ())),
        "standard_day_seconds": 8 * HOUR,
        "work_rules_evidence": EVIDENCE,
        "agreement_evidence": EVIDENCE,
        "status": "confirmed",
        "created_by": "admin-a",
        "created_at": "2025-12-01T09:00:00+09:00",
        "reviewed_by": "admin-b",
        "reviewed_at": "2025-12-02T09:00:00+09:00",
    }
    if e["flex_months"] > 1:
        adoption |= {
            "filing": {
                "filed_on": "2025-12-10",
                "office": "synthetic office",
                "evidence": EVIDENCE,
            },
            "agreement_valid_until": "2026-12-31",
        }
    payload["flex_adoptions"] = [adoption]
    payload["flex_enrollments"] = [
        {
            "enrollment_id": "enr-1",
            "adoption_id": "flex-1",
            "person_id": e["person_id"],
            "start": start,
            "status": "confirmed",
            "created_by": "admin-a",
            "created_at": "2025-12-01T09:00:00+09:00",
            "reviewed_by": "admin-b",
            "reviewed_at": "2025-12-02T09:00:00+09:00",
        }
    ]
    return payload


def flex_payload(specs, **change):
    payload = upgrade(work_fixture(specs, orders=(1,)))
    payload["employments"][0].update(
        {
            "working_time_system": "flex",
            "flex_anchor": "2026-01-01",
            "flex_months": 1,
            "variable_evidence": EVIDENCE,
            **change,
        }
    )
    return adopt(payload)


def account_actual(payload):
    data = parse_snapshot(payload)
    return account_work(
        data, [d.model_copy(update={"source": "actual"}) for d in data.candidates]
    )


def test_actual_work_is_settled_and_a_long_day_is_not_overtime():
    result = account_actual(flex_payload([("A", 0, 9, 12, 12)]))
    assert [f.message for f in result["findings"]] == []
    assert sum(r["overtime_seconds"] for r in result["trace"]) == 0
    assert [s["kind"] for s in result["settlements"]] == ["flextime"]


def test_a_timed_duty_for_a_flextime_worker_is_a_violation():
    data = parse_snapshot(flex_payload([("A", 0, 9, 8, 8)]))
    result = account_work(data, list(data.candidates))
    assert [
        f.status
        for f in result["findings"]
        if "set their own start and end times" in f.message
    ] == ["violation"]


def test_inputs_must_hold_the_settlement_period_and_verified_rules():
    payload = flex_payload([("A", 0, 9, 8, 8)])
    payload["context"]["start"] = "2026-01-02T00:00:00+09:00"
    assert any(
        "settlement period from 2026-01-01 is not fully in the input" in f.message
        for f in input_findings(parse_snapshot(payload))
    )
    draft = flex_payload([("A", 0, 9, 8, 8)], variable_evidence={"reference": "draft"})
    assert any(
        "Flextime work rules or agreement unverified" in f.message
        for f in input_findings(parse_snapshot(draft))
    )


def test_a_joiner_within_a_longer_settlement_period_is_settled():
    # Settlement Jan-Mar from Jan 1; the person joins on Jan 5 and the input ends on
    # Jan 12, so nothing is settled yet (the part ends on Mar 31). With a person who
    # leaves on Jan 12 the part Jan 5 - Jan 12 (7 days, frame 40h) is complete:
    # 12h worked, no overtime counted -> nothing above 40h to settle.
    payload = flex_payload([("A", 0, 9, 12, 12)], flex_months=3)
    payload["employments"][0].update(
        start="2026-01-05T00:00:00+09:00", end="2026-01-12T00:00:00+09:00"
    )
    parts = [
        s
        for s in account_actual(payload)["settlements"]
        if s["kind"] == "flextime_part"
    ]
    assert [
        (p["frame_seconds"], p["worked_seconds"], p["settlement_seconds"])
        for p in parts
    ] == [(40 * HOUR, 12 * HOUR, 0)]


def test_the_solver_assigns_no_timed_duty_to_a_flextime_worker():
    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.planning import _calendar_and_flex_limits

    data = parse_snapshot(flex_payload([("A", 0, 9, 8, 8)]))
    model = cp_model.CpModel()
    x = {d.duty_id: model.new_bool_var(d.duty_id) for d in data.candidates}
    eligible = set(x)
    _calendar_and_flex_limits(model, data, "p0", list(data.candidates), [], x, eligible)
    assert eligible == set()
    model.add(next(iter(x.values())) == 1)
    assert cp_model.CpSolver().solve(model) == cp_model.INFEASIBLE


def test_month_ends_are_counted_from_a_month_end_anchor():
    # Anchor Jan 31, three months: Apr 30 - Jul 31 with months to May 31 and Jun 30.
    # A day on Jul 30 lies in the last month (it used to fall outside every month).
    e = employment(flex_anchor="2026-01-31", flex_months=3)
    assert flex_period(date(2026, 1, 31), 3, date(2026, 7, 30)) == (
        date(2026, 4, 30),
        date(2026, 7, 31),
    )
    allocated, summaries = _allocate_flex(rows([("2026-07-30", 8 * HOUR)]), e)
    assert allocated[0]["overtime"] == 0 and summaries[0]["start"] == "2026-04-30"


def test_revisions_with_another_week_start_are_not_mixed():
    payload = flex_payload([("A", 0, 9, 8, 8)])
    second = dict(
        payload["employments"][0],
        revision_id="emp-A2",
        start="2026-01-08T00:00:00+09:00",
        week_start=2,
    )
    payload["employments"][0]["end"] = "2026-01-08T00:00:00+09:00"
    payload["employments"].append(second)
    for t in payload["work_terms"]:
        t["employment_revision_id"] = "emp-A"
    result = account_actual(payload)
    assert any(
        "changed settlement terms is not supported" in f.message
        for f in result["findings"]
    )
