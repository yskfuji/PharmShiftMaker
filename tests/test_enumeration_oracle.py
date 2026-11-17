"""F02: solver vs exhaustive validation on small random instances (no database).

Two people x three day shifts (64 proposals). Each example varies demand,
capability, supervision, restrictions, rest, consecutive days and allowed
weekdays, so many mandatory rules decide feasibility, including infeasible
instances. Soundness: a returned plan always validates. Completeness: the
solver finds a plan exactly when enumeration finds one.
"""

from datetime import timedelta
from itertools import product

import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import Proposal
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.test_catalogue_v3 import data

case = st.fixed_dictionaries(
    {
        "minimum": st.lists(st.integers(0, 2), min_size=3, max_size=3),
        "p1_capable": st.booleans(),
        "p0_trainee": st.booleans(),
        "p1_capacity": st.integers(0, 1),
        "restricted_day": st.sampled_from([None, 0, 1, 2]),
        "rest_hours": st.sampled_from([0, 21]),
        "max_consecutive": st.sampled_from([1, 2, 6]),
        "p1_skip_tuesday": st.booleans(),
    }
)


def instance(c):
    p = data().model_dump(mode="json")
    p["people"].append({"person_id": "p1", "name": "Synthetic second person"})
    p["contracts"].append(
        dict(p["contracts"][0], person_id="p1", revision_id="c1", relationship_id="e1")
    )
    p["employments"].append(
        dict(
            p["employments"][0],
            person_id="p1",
            revision_id="emp1",
            relationship_id="e1",
        )
    )
    base_cap = p["capabilities"][0]
    p["capabilities"] = [dict(base_cap, supervision_required=c["p0_trainee"])]
    if c["p1_capable"]:
        p["capabilities"].append(
            dict(base_cap, person_id="p1", supervisor_capacity=c["p1_capacity"])
        )
    for contract in p["contracts"]:
        contract.update(
            rest_seconds=c["rest_hours"] * 3600,
            max_consecutive_days=c["max_consecutive"],
        )
    if c["p1_skip_tuesday"]:
        p["contracts"][1]["allowed_weekdays"] = [0, 2, 3, 4, 5, 6]
    template = p["duty_templates"][0]
    template["dates"] = template["dates"][:3]  # Mon-Wed 09:00-13:00
    raw = parse_snapshot(p)
    start = raw.period.start
    if c["restricted_day"] is not None:
        day = start + timedelta(days=c["restricted_day"])
        p["restrictions"] = [
            {
                "person_id": "p0",
                "start": day.isoformat(),
                "end": (day + timedelta(days=1)).isoformat(),
                "evidence": p["policy_evidence"],
            }
        ]
    generated = generate_catalogue(parse_snapshot(p))
    p.update(candidates=generated["candidates"], work_terms=generated["work_terms"])
    p["demands"] = [
        dict(
            p["demands"][0],
            demand_id=f"d{i}",
            minimum=m,
            target=max(m, p["demands"][0].get("target", m)),
            start=(start + timedelta(days=i, hours=9)).isoformat(),
            end=(start + timedelta(days=i, hours=13)).isoformat(),
        )
        for i, m in enumerate(c["minimum"])
    ]
    return parse_snapshot(p)


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(case)
def test_solver_agrees_with_exhaustive_validation(c):
    snapshot = instance(c)
    candidates = list(snapshot.candidates)
    feasible = set()
    for bits in product((False, True), repeat=len(candidates)):
        ids = tuple(
            sorted(
                d.duty_id for d, chosen in zip(candidates, bits, strict=True) if chosen
            )
        )
        if validate(snapshot, Proposal(duty_ids=ids)).publishable:
            feasible.add(ids)
    result = solve(snapshot, 10)
    if result.proposal is not None:  # soundness
        assert validate(snapshot, result.proposal).publishable
        assert tuple(sorted(result.proposal.duty_ids)) in feasible
    # completeness in both directions
    assert (result.proposal is not None) == bool(feasible), (c, result.status)


priority_case = st.fixed_dictionaries(
    {
        "previous": st.lists(st.booleans(), min_size=6, max_size=6),
        "avoid": st.lists(
            st.tuples(
                st.sampled_from(["p0", "p1"]), st.integers(0, 2), st.integers(1, 3)
            ),
            max_size=3,
        ),
    }
)


def with_priorities(snapshot, previous_flags, avoid):
    payload = snapshot.model_dump(mode="json")
    start = snapshot.period.start
    candidates = sorted(snapshot.candidates, key=lambda d: (d.person_id, d.start))
    payload["previous_duty_ids"] = [
        d.duty_id for d, keep in zip(candidates, previous_flags, strict=True) if keep
    ]
    payload["preferences"] = [
        {
            "person_id": person,
            "rank": rank,
            "start": (start + timedelta(days=day)).isoformat(),
            "end": (start + timedelta(days=day + 1)).isoformat(),
        }
        for person, day, rank in avoid
    ]
    return parse_snapshot(payload)


def hand_levels(snapshot, ids):
    """(changes, preference cost) computed independently of the solver."""
    previous, chosen = set(snapshot.previous_duty_ids), set(ids)
    changes = len(previous - chosen) + len(chosen - previous) if previous else 0
    max_rank = max((p.rank for p in snapshot.preferences), default=1)
    cost = sum(
        max_rank - p.rank + 1
        for p in snapshot.preferences
        for d in snapshot.candidates
        if d.duty_id in chosen
        and p.person_id == d.person_id
        and any(w.start < p.end and p.start < w.end for w in d.work)
    )
    return changes, cost


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(priority_case)
def test_changes_then_preferences_are_minimised_in_order(c):
    base = instance(
        {
            "minimum": [1, 1, 1],
            "p1_capable": True,
            "p0_trainee": False,
            "p1_capacity": 0,
            "restricted_day": None,
            "rest_hours": 0,
            "max_consecutive": 6,
            "p1_skip_tuesday": False,
        }
    )
    snapshot = with_priorities(base, c["previous"], c["avoid"])
    candidates = list(snapshot.candidates)
    feasible = [
        ids
        for bits in product((False, True), repeat=len(candidates))
        if validate(
            snapshot,
            Proposal(
                duty_ids=(
                    ids := tuple(
                        d.duty_id for d, b in zip(candidates, bits, strict=True) if b
                    )
                )
            ),
        ).publishable
    ]
    result = solve(snapshot, 10)
    assert result.proposal is not None and feasible
    assert hand_levels(snapshot, result.proposal.duty_ids) == min(
        hand_levels(snapshot, ids) for ids in feasible
    )


def test_keeping_the_previous_plan_outranks_preferences():
    base = instance(
        {
            "minimum": [1, 1, 1],
            "p1_capable": True,
            "p0_trainee": False,
            "p1_capacity": 0,
            "restricted_day": None,
            "rest_hours": 0,
            "max_consecutive": 6,
            "p1_skip_tuesday": False,
        }
    )
    p0_days = [
        d for d in sorted(base.candidates, key=lambda d: d.start) if d.person_id == "p0"
    ]
    flags = [
        d.person_id == "p0"
        for d in sorted(base.candidates, key=lambda d: (d.person_id, d.start))
    ]
    # p0 asks to avoid all three days, but the previous plan had p0 on all three.
    snapshot = with_priorities(base, flags, [("p0", i, 1) for i in range(3)])
    result = solve(snapshot, 10)
    assert sorted(result.proposal.duty_ids) == sorted(d.duty_id for d in p0_days)


# --- F02/F04: more mandatory rules and the complete four-level objective ------------
#
# Two people x three day shifts plus one extra duty (8 candidates, 256 proposals).
# Added dimensions: annual-leave reservation, statutory holiday with or without a
# holiday-work agreement, a 9h duty needing a 36 agreement (8h rule), overlapping
# duties, contract volume minimum/maximum, allowed kinds, dispatch tasks and
# lookahead (confirmed or not).

HOUR = 3600


def extended(c):
    from scripts.remediation_fixture import snapshot

    p = snapshot().model_dump(mode="json")
    start = parse_snapshot(p).period.start
    ev = p["policy_evidence"]

    def day(i):
        return start + timedelta(days=i)

    base = p["duty_templates"][0]
    base["dates"] = base["dates"][:3]  # Mon-Wed 09:00-13:00
    spans = (
        [
            {"start_seconds": 0, "end_seconds": 4 * HOUR},
            {"start_seconds": 5 * HOUR, "end_seconds": 10 * HOUR},
        ]
        if c["long"]
        else [{"start_seconds": 0, "end_seconds": 6 * HOUR}]
    )
    if c["late"] is not None:  # 12:00 overlaps the day shift; 13:00 follows it
        p["duty_templates"].append(
            dict(
                base,
                template_id="late",
                kind="LATE",
                dates=base["dates"][:1],
                start_second=c["late"] * HOUR,
                duration_seconds=(10 if c["long"] else 6) * HOUR,
                work=spans,
                scheduled_work=spans,
            )
        )
    for contract in p["contracts"]:
        contract["allowed_kinds"] = ["DAY", "LATE"]
    if c["p1_no_late"]:
        p["contracts"][1]["allowed_kinds"] = ["DAY"]
    p["contracts"][1]["period_max_seconds"] = c["p1_max"] * HOUR
    p["contracts"][0]["period_min_seconds"] = c["p0_min"] * HOUR
    if c["dispatch"] is not None:
        p["contracts"][1].update(
            engagement="agency", dispatch_evidence=ev, dispatch_tasks=c["dispatch"]
        )
    if c["holiday"] is not None:
        p["employments"][0]["statutory_holidays"] = sorted(
            set(p["employments"][0]["statutory_holidays"])
            | {day(c["holiday"]).date().isoformat()}
        )
    if c["leave"] is not None:
        d = day(c["leave"]).date().isoformat()
        p["leave_records"].append(
            {
                "event_id": "leave-p0",
                "account_id": "g0",
                "kind": "reserve",
                "unit": "day",
                "quantity": 1,
                "effective_on": d,
                "policy_id": "lp0",
                "evidence": ev,
                "interval": {
                    "start": f"{d}T09:00:00+09:00",
                    "end": f"{d}T13:00:00+09:00",
                },
            }
        )
        p["ledger_recordings"].append(
            {
                "recording_id": "hr-leave-p0",
                "object_kind": "leave_record",
                "object_id": "leave-p0",
                "external_event_id": "hr:leave-p0",
                "external_revision": 1,
                "recorded_at": "2026-01-01T00:00:00+09:00",
                "evidence": ev,
            }
        )
    if c["agreement"] is not None:
        p["agreements"] = [
            {
                "start": p["context"]["start"],
                "end": p["context"]["end"],
                "agreement_id": "36-h",
                "employer_id": "hospital",
                "establishment_id": "site-hospital",
                "year_start": "2026-01-01",
                "month_anchor": "2026-01-01",
                "daily_limit_seconds": 2 * HOUR,
                "monthly_limit_seconds": 45 * HOUR,
                "annual_limit_seconds": 360 * HOUR,
                "special_clause": False,
                "holiday_work_permitted": c["agreement"] == "holiday",
                "evidence": ev,
                "invocation_evidence": None,
            }
        ]
        for e in p["employments"]:
            e["agreement_id"] = "36-h"
    if c["lookahead"] != "off":
        p["lookahead_days"] = 2
        p["lookahead_demand_confirmed"] = c["lookahead"] == "confirmed"
    generated = generate_catalogue(parse_snapshot(p))
    p.update(candidates=generated["candidates"], work_terms=generated["work_terms"])
    demand = p["demands"][0]
    p["demands"] = [
        dict(
            demand,
            demand_id=f"d{i}",
            minimum=m,
            target=max(m, 1),
            start=(day(i) + timedelta(hours=9)).isoformat(),
            end=(day(i) + timedelta(hours=13)).isoformat(),
        )
        for i, m in enumerate(c["minimum"])
    ]
    if c["late"] is not None and c["late_minimum"]:
        p["demands"].append(
            dict(
                demand,
                demand_id="late",
                minimum=1,
                target=1,
                start=(day(0) + timedelta(hours=c["late"])).isoformat(),
                end=(day(0) + timedelta(hours=c["late"] + 4)).isoformat(),
            )
        )
    return parse_snapshot(p)


PLAIN = {
    "minimum": [1, 1, 1],
    "late": 13,
    "late_minimum": True,
    "long": False,
    "p1_no_late": False,
    "p1_max": 28,
    "p0_min": 0,
    "dispatch": None,
    "holiday": None,
    "leave": None,
    "lookahead": "off",
    "agreement": None,
}

extended_case = st.fixed_dictionaries(
    {
        "minimum": st.lists(st.integers(0, 2), min_size=3, max_size=3),
        "late": st.sampled_from([None, 12, 13]),
        "late_minimum": st.booleans(),
        "long": st.booleans(),
        "p1_no_late": st.booleans(),
        "p1_max": st.sampled_from([4, 8, 28]),
        "p0_min": st.sampled_from([0, 8]),
        "dispatch": st.sampled_from([None, ["dispensing"], []]),
        "holiday": st.sampled_from([None, 0, 1]),
        "leave": st.sampled_from([None, 0, 2]),
        # Pending lookahead blocks every proposal; it is checked once below, not sampled.
        "lookahead": st.sampled_from(["off", "confirmed"]),
        "agreement": st.sampled_from([None, "overtime", "holiday"]),
    }
)


def enumerate_feasible(snapshot):
    candidates = list(snapshot.candidates)
    feasible, rules = [], set()
    for bits in product((False, True), repeat=len(candidates)):
        ids = tuple(
            sorted(
                d.duty_id for d, chosen in zip(candidates, bits, strict=True) if chosen
            )
        )
        report = validate(snapshot, Proposal(duty_ids=ids))
        if report.publishable:
            feasible.append(ids)
        else:
            rules |= {f.rule_id for f in report.findings}
    return feasible, rules


def test_each_added_dimension_produces_its_own_finding():
    # The generator is not vacuous: each dimension adds a finding absent from PLAIN.
    # (Overlap only adds a finding: the 11h rest already forbids the same pairs,
    # so the feasible set does not change. The 9h rule is checked below.)
    plain = enumerate_feasible(extended(PLAIN))[1]
    expected = {
        "leave.v2": {"leave": 0},
        "overlap": {"late": 12},
        "contract.volume": {"p1_max": 4},
        "contract.availability": {"p1_no_late": True},
        "dispatch": {"dispatch": []},
        "lookahead": {"lookahead": "pending"},
    }
    for rule, change in expected.items():
        _, rules = enumerate_feasible(extended(PLAIN | change))
        assert rule in rules and rule not in plain, (rule, sorted(rules), sorted(plain))
    # A designated holiday needs holiday work in the agreement; overtime alone is not enough.
    counts = {
        agreement: len(
            enumerate_feasible(
                extended(PLAIN | {"holiday": 1, "agreement": agreement})
            )[0]
        )
        for agreement in (None, "overtime", "holiday")
    }
    assert counts[None] == counts["overtime"] < counts["holiday"]
    # The 9h duty is feasible only with a 36 agreement.
    assert not enumerate_feasible(extended(PLAIN | {"long": True}))[0]
    assert enumerate_feasible(
        extended(PLAIN | {"long": True, "agreement": "overtime"})
    )[0]


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(extended_case)
@example(PLAIN | {"leave": 0})  # leave must be in the model, not left to cuts
@example(PLAIN | {"dispatch": []})  # so must the dispatch tasks
def test_solver_agrees_with_exhaustive_validation_across_more_rules(c):
    import shift_scheduler.optimizer.planning as optimizer

    snapshot = extended(c)
    feasible, _ = enumerate_feasible(snapshot)
    # The solver re-validates each incumbent and cuts rejected ones, which would
    # hide a rule missing from the model. Only the 8h/40h work limits are left to
    # those cuts by design; every other rule must already be in the model.
    rejected, real = [], optimizer.validate

    def counting(data, proposal):
        report = real(data, proposal)
        if not report.publishable:
            rejected.append({f.rule_id for f in report.findings})
        return report

    optimizer.validate = counting
    try:
        result = solve(snapshot, 10)
    finally:
        optimizer.validate = real
    assert all(rules <= {"work.v2"} for rules in rejected), rejected
    if result.proposal is not None:
        assert validate(snapshot, result.proposal).publishable
        assert tuple(sorted(result.proposal.duty_ids)) in feasible
    assert (result.proposal is not None) == bool(feasible), (c, result.status)


HISTORY = [
    (0, 0),
    (0, 16),
    (4, 16),
    (8, 16),
]  # (worked hours, eligible hours); (0, 0) has no exposure


def fairness_instance(c):
    """Day shifts Mon-Wed and one 22:00-02:00 night; Wednesday is p1's statutory
    holiday (holiday work agreed). A Tuesday night ends on that holiday, so its last
    2h are night and holiday work for p1. A Sunday night (a weekly holiday of both)
    ends after the period and needs confirmed lookahead; only its part inside the
    period counts. p1 is part-time with a smaller period maximum. A whole-day
    restriction and p0's reserved leave remove opportunities. An old history entry
    outside the twelve-month window must be ignored."""
    lookahead = "confirmed" if c["night_day"] == 6 else c["lookahead"]
    day_leave = c["leave"] if c["leave"] != "night" else None
    p = extended(
        PLAIN
        | {
            "minimum": [1, 0, 1],
            "late": None,
            "late_minimum": False,
            "leave": day_leave,
            "agreement": "holiday",
            "lookahead": lookahead,
        }
    ).model_dump(mode="json")
    start = parse_snapshot(p).period.start
    for contract in p["contracts"]:
        contract["allowed_kinds"] = ["DAY", "NIGHT"]
    p["contracts"][1].update(
        time_category="part_time", period_max_seconds=c["p1_max"] * HOUR
    )
    wednesday = (start + timedelta(days=2)).date().isoformat()
    p["employments"][1]["statutory_holidays"] = sorted(
        set(p["employments"][1]["statutory_holidays"]) | {wednesday}
    )
    day_template = p["duty_templates"][0]
    night = (start + timedelta(days=c["night_day"])).date().isoformat()
    p["duty_templates"].append(
        dict(
            day_template,
            template_id="night",
            kind="NIGHT",
            dates=[night],
            start_second=22 * HOUR,
            duration_seconds=4 * HOUR,
            work=[{"start_seconds": 0, "end_seconds": 4 * HOUR}],
            scheduled_work=[{"start_seconds": 0, "end_seconds": 4 * HOUR}],
        )
    )
    if c["leave"] == "night":  # p0's annual leave over the night duty
        begin = start + timedelta(days=c["night_day"], hours=22)
        p["leave_records"].append(
            {
                "event_id": "leave-p0",
                "account_id": "g0",
                "kind": "reserve",
                "unit": "day",
                "quantity": 1,
                "effective_on": begin.date().isoformat(),
                "policy_id": "lp0",
                "evidence": p["policy_evidence"],
                "interval": {
                    "start": begin.isoformat(),
                    "end": (begin + timedelta(hours=4)).isoformat(),
                },
            }
        )
        p["ledger_recordings"].append(
            {
                "recording_id": "hr-leave-p0",
                "object_kind": "leave_record",
                "object_id": "leave-p0",
                "external_event_id": "hr:leave-p0",
                "external_revision": 1,
                "recorded_at": "2026-01-01T00:00:00+09:00",
                "evidence": p["policy_evidence"],
            }
        )
    if c["restrict"] is not None:
        person, day = c["restrict"]
        p["restrictions"] = [
            {
                "person_id": person,
                "start": (start + timedelta(days=day)).isoformat(),
                "end": (start + timedelta(days=day + 1)).isoformat(),
                "evidence": p["policy_evidence"],
            }
        ]
    p.update(candidates=[], work_terms=[])
    generated = generate_catalogue(parse_snapshot(p))
    p.update(candidates=generated["candidates"], work_terms=generated["work_terms"])
    p["demands"].append(
        dict(
            p["demands"][0],
            demand_id="night",
            minimum=c["night_min"],
            target=1,
            start=(start + timedelta(days=c["night_day"], hours=22)).isoformat(),
            end=(start + timedelta(days=c["night_day"] + 1, hours=2)).isoformat(),
        )
    )
    p["burden_history"] = [
        {
            "person_id": f"p{i}",
            "kind": kind,
            "seconds": HISTORY[c["history"][i][k]][0] * HOUR,
            "eligible_seconds": HISTORY[c["history"][i][k]][1] * HOUR,
            "period_start": "2025-12-01",
            "period_end": "2026-01-01",
            "eligibility_evidence": p["policy_evidence"],
        }
        for i in range(2)
        for k, kind in enumerate(("night", "holiday"))
    ]
    if c["stale"]:  # before the twelve-month window of the January 2026 period
        p["burden_history"].append(
            dict(
                p["burden_history"][0],
                seconds=16 * HOUR,
                eligible_seconds=16 * HOUR,
                period_start="2024-11-01",
                period_end="2024-12-01",
            )
        )
    ordered = sorted(p["candidates"], key=lambda d: (d["person_id"], d["start"]))
    p["previous_duty_ids"] = [
        d["duty_id"] for d, keep in zip(ordered, c["previous"], strict=True) if keep
    ]
    p["preferences"] = [
        {
            "person_id": person,
            "rank": rank,
            "start": (start + timedelta(days=day)).isoformat(),
            "end": (start + timedelta(days=day + 1)).isoformat(),
        }
        for person, day, rank in c["avoid"]
    ]
    return parse_snapshot(p)


def burden_spans_by_hand(duty, kind, holidays):
    """Night: 22:00-05:00 local; holiday: the whole statutory holiday (calendar day)."""
    from datetime import datetime, time
    from zoneinfo import ZoneInfo

    zone = ZoneInfo("Asia/Tokyo")
    spans = []
    for w in duty.work:
        day = w.start.astimezone(zone).date()
        while day <= w.end.astimezone(zone).date():
            zero = datetime.combine(day, time(), zone)
            if kind == "holiday":
                windows = [(zero, zero + timedelta(days=1))] if day in holidays else []
            else:
                windows = [
                    (zero, zero + timedelta(hours=5)),
                    (zero + timedelta(hours=22), zero + timedelta(days=1)),
                ]
            spans += [
                (max(a, w.start), min(b, w.end))
                for a, b in windows
                if max(a, w.start) < min(b, w.end)
            ]
            day += timedelta(days=1)
    return spans


def union_by_hand(spans):
    total, reach = 0, None
    for a, b in sorted(spans):
        a = max(a, reach) if reach else a
        total += max(0, int((b - a).total_seconds()))
        reach = max(reach, b) if reach else b
    return total


def four_levels_by_hand(snapshot, ids, c):
    """(changes, preference cost, maximum burden rate, sum of same-kind deviations).

    Rate per person and kind: (history seconds + chosen seconds in the period) /
    (min(period maximum, union of the person's eligible spans in the period) +
    history exposure), history counted only from the twelve months before the
    period (from the first day of that month). A duty overlapping the person's
    restriction or reserved leave is not an opportunity. A person and kind
    without any exposure has no rate.
    """
    from datetime import date
    from fractions import Fraction

    changes, cost = hand_levels(snapshot, ids)
    chosen = set(ids)
    period = snapshot.period
    first = period.start.date()
    cutoff = date(first.year - 1, first.month, 1)
    blocked = []
    if c["leave"] == "night":
        night = period.start + timedelta(days=c["night_day"], hours=22)
        blocked.append(("p0", night, night + timedelta(hours=4)))
    elif c["leave"] is not None:
        day = period.start + timedelta(days=c["leave"])
        blocked.append(("p0", day + timedelta(hours=9), day + timedelta(hours=13)))
    if c["restrict"] is not None:
        person, day = c["restrict"]
        blocked.append(
            (
                person,
                period.start + timedelta(days=day),
                period.start + timedelta(days=day + 1),
            )
        )
    rates = {}
    for person in ("p0", "p1"):
        employment = next(e for e in snapshot.employments if e.person_id == person)
        contract = next(c for c in snapshot.contracts if c.person_id == person)
        own = [d for d in snapshot.candidates if d.person_id == person]
        eligible = [
            d
            for d in own
            if not any(
                who == person and any(w.start < b and a < w.end for w in d.work)
                for who, a, b in blocked
            )
        ]
        holidays = frozenset(employment.statutory_holidays)
        for kind in ("night", "holiday"):

            def clipped(d, kind=kind, holidays=holidays):
                return [
                    (max(a, period.start), min(b, period.end))
                    for a, b in burden_spans_by_hand(d, kind, holidays)
                    if a < period.end and period.start < b
                ]

            opportunity = union_by_hand([s for d in eligible for s in clipped(d)])
            history = [
                h
                for h in snapshot.burden_history
                if h.person_id == person
                and h.kind == kind
                and cutoff <= h.period_start
                and h.period_end <= first
            ]
            denominator = min(contract.period_max_seconds, opportunity) + sum(
                h.eligible_seconds for h in history
            )
            if denominator:
                worked = sum(
                    int((b - a).total_seconds())
                    for d in own
                    if d.duty_id in chosen
                    for a, b in clipped(d)
                )
                rates[person, kind] = Fraction(
                    sum(h.seconds for h in history) + worked, denominator
                )
    maximum = max(rates.values(), default=Fraction(0))
    deviation = sum(
        abs(rates["p0", k] - rates["p1", k])
        for k in ("night", "holiday")
        if ("p0", k) in rates and ("p1", k) in rates
    )
    return changes, cost, maximum, deviation


fairness_case = st.fixed_dictionaries(
    {
        "leave": st.sampled_from([None, 0, 2, "night"]),
        "restrict": st.sampled_from([None, ("p1", 2), ("p0", 1), ("p1", 6)]),
        "night_day": st.sampled_from([1, 6]),
        "lookahead": st.sampled_from(["off", "confirmed"]),
        "p1_max": st.sampled_from([4, 8, 28]),
        "night_min": st.integers(0, 1),
        "history": st.lists(
            st.lists(st.integers(0, len(HISTORY) - 1), min_size=2, max_size=2),
            min_size=2,
            max_size=2,
        ),
        # History outside the twelve-month window is refused by the input check
        # (test below), so the objective's own window filter is not reachable here.
        "stale": st.just(False),
        # Half the cases have no previous plan and no preferences, so that the two
        # fairness levels decide between otherwise equal plans.
        "previous": st.one_of(
            st.just([False] * 8), st.lists(st.booleans(), min_size=8, max_size=8)
        ),
        "avoid": st.one_of(
            st.just([]),
            st.lists(
                st.tuples(
                    st.sampled_from(["p0", "p1"]), st.integers(0, 2), st.integers(1, 3)
                ),
                max_size=2,
            ),
        ),
    }
)


BASE_FAIRNESS = {
    "leave": None,
    "restrict": None,
    "night_day": 1,
    "lookahead": "off",
    "p1_max": 28,
    "night_min": 0,
    "history": [[1, 1], [1, 1]],
    "stale": False,
    "previous": [False] * 8,
    "avoid": [],
}


def test_history_outside_the_twelve_month_window_blocks_the_input():
    snapshot = fairness_instance(BASE_FAIRNESS | {"stale": True})
    assert not enumerate_feasible(snapshot)[0]
    assert solve(snapshot, 10).status == "BLOCKED"


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(fairness_case)
# Found by search; each example is decided only by the named part of the definition.
@example(
    BASE_FAIRNESS | {"p1_max": 4, "history": [[1, 1], [2, 2]]}
)  # third level (maximum)
@example(
    BASE_FAIRNESS | {"p1_max": 4, "history": [[2, 3], [3, 2]]}
)  # fourth level (deviation)
@example(
    BASE_FAIRNESS | {"p1_max": 4, "night_min": 1, "history": [[3, 3], [3, 3]]}
)  # period maximum caps exposure
@example(
    BASE_FAIRNESS
    | {"leave": "night", "night_day": 6, "p1_max": 4, "history": [[0, 3], [2, 0]]}
)  # leave removes an opportunity
@example(
    BASE_FAIRNESS | {"restrict": ("p1", 2), "night_day": 6, "history": [[0, 3], [2, 0]]}
)  # so does a restriction
def test_all_four_objective_levels_match_an_independent_hand_calculation(c):
    snapshot = fairness_instance(c)
    feasible, _ = enumerate_feasible(snapshot)
    result = solve(snapshot, 10)
    assert (result.proposal is not None) == bool(feasible), (c, result.status)
    if feasible:
        assert result.status == "OPTIMAL" and result.proven_levels == 4
        best = min(four_levels_by_hand(snapshot, ids, c) for ids in feasible)
        assert four_levels_by_hand(snapshot, result.proposal.duty_ids, c) == best, c


def eligible_by_hand(snapshot, c):
    """Candidates that are opportunities: not overlapping the person's restriction or leave."""
    period = snapshot.period
    blocked = []
    if c["leave"] == "night":
        night = period.start + timedelta(days=c["night_day"], hours=22)
        blocked.append(("p0", night, night + timedelta(hours=4)))
    elif c["leave"] is not None:
        day = period.start + timedelta(days=c["leave"])
        blocked.append(("p0", day + timedelta(hours=9), day + timedelta(hours=13)))
    if c["restrict"] is not None:
        person, day = c["restrict"]
        blocked.append(
            (
                person,
                period.start + timedelta(days=day),
                period.start + timedelta(days=day + 1),
            )
        )
    return {
        d.duty_id
        for d in snapshot.candidates
        if not any(
            who == d.person_id and any(w.start < b and a < w.end for w in d.work)
            for who, a, b in blocked
        )
    }


@pytest.mark.parametrize(
    "change",
    [
        {},
        {"night_day": 6},  # the Sunday night ends after the period (clipped)
        {"night_day": 6, "p1_max": 4, "history": [[0, 3], [2, 0]]},
        {"stale": True},  # history outside the twelve-month window is ignored
        {"stale": True, "night_day": 6, "history": [[3, 1], [2, 2]]},
        {"leave": "night", "restrict": ("p1", 2), "p1_max": 4},
        # A period ending at 01:00 cuts the Sunday night inside a calendar day, so
        # only the hour before the end counts (burden spans are split at midnight,
        # which is why clipping matters only for such boundaries).
        {
            "night_day": 6,
            "period_end": "2026-01-12T01:00:00+09:00",
            "history": [[0, 3], [2, 0]],
        },
    ],
)
def test_objective_values_equal_the_hand_calculation_for_every_assignment(change):
    """The third and fourth levels as values, not only as the optimum's choice:
    for every one of the 256 assignments the solver's scaled maximum rate and
    deviation equal the hand calculation. The objective is called directly, so
    inputs the input check would stop (history outside the window) are covered."""
    from fractions import Fraction

    from ortools.sat.python import cp_model

    from shift_scheduler.optimizer.fairness import objectives

    c = BASE_FAIRNESS | {k: v for k, v in change.items() if k != "period_end"}
    snapshot = fairness_instance(c)
    if "period_end" in change:
        payload = snapshot.model_dump(mode="json")
        payload["period"]["end"] = change["period_end"]
        snapshot = parse_snapshot(payload)
    candidates = list(snapshot.candidates)
    eligible = eligible_by_hand(snapshot, c)
    for bits in product((False, True), repeat=len(candidates)):
        model = cp_model.CpModel()
        x = {d.duty_id: model.new_bool_var(d.duty_id) for d in candidates}
        encoding = {}
        maximum, deviation = objectives(
            model, snapshot, candidates, x, eligible, encoding
        )
        assert encoding["kind"] == "scaled_integer"
        for d, chosen in zip(candidates, bits, strict=True):
            model.add(x[d.duty_id] == int(chosen))
        solver = cp_model.CpSolver()
        assert solver.solve(model) == cp_model.OPTIMAL
        common = int(encoding["common_denominator"])
        ids = tuple(
            d.duty_id for d, chosen in zip(candidates, bits, strict=True) if chosen
        )
        _, _, hand_maximum, hand_deviation = four_levels_by_hand(snapshot, ids, c)
        assert (
            Fraction(solver.value(maximum), common),
            Fraction(solver.value(deviation), common),
        ) == (hand_maximum, hand_deviation), (change, ids)
