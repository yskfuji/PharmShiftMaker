"""CP-SAT adapter with lexicographic objectives and independent incumbent checks."""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, timedelta
from importlib.metadata import version
from itertools import chain, combinations
from typing import Any, cast
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model

from shift_scheduler.domain.compliance import SolverSnapshotV2
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import (
    Duty,
    Interval,
    Proposal,
    SolveResult,
    SolverSnapshot,
    SolveStatus,
)
from shift_scheduler.validation.planning import (
    contract_for,
    input_findings,
    validate,
    verified,
    working_days,
)

JST = ZoneInfo("Asia/Tokyo")


def _calendar_and_flex_limits(
    model: Any,
    snapshot: SolverSnapshotV2,
    person_id: str,
    own: list[Duty],
    fixed: list[Duty],
    x: dict[str, Any],
    eligible_ids: set[str],
) -> None:
    """Assignments that the agreed arrangement allows, with or without an agreement.

    One-year variable hours: the working days and their hours are fixed in the
    calendar and cannot be changed by the employer (平11.1.29基発45号), so a duty
    goes only on a fixed working day and each day stays within its hours.
    Flextime: the worker sets start and end times (平30.9.7基発0907第1号), so no
    timed duty is assigned at all.
    """
    employments = [
        e
        for e in snapshot.employments
        if e.person_id == person_id and e.activity == "employment"
    ]
    if any(e.working_time_system == "flex" for e in employments):
        for d in own:
            if d.duty_id in x and any(
                e.working_time_system == "flex" and e.contains(d) for e in employments
            ):
                model.add(x[d.duty_id] == 0)
                eligible_ids.discard(d.duty_id)
    names = {
        e.annual_calendar_id
        for e in employments
        if e.working_time_system == "annual_variable"
    }
    calendars = [
        c for c in getattr(snapshot, "annual_calendars", ()) if c.calendar_id in names
    ]
    if not calendars:
        return
    scheduled = {
        day: seconds for c in calendars for day, seconds in c.scheduled().items()
    }
    per_day: dict[date, tuple[list[Any], list[int]]] = defaultdict(lambda: ([], [0]))
    for d in (*own, *fixed):
        if not any(
            e.working_time_system == "annual_variable" and e.contains(d)
            for e in employments
        ):
            continue
        day = d.start.astimezone(JST).date()
        works, known = per_day[day]
        if d.duty_id in x:
            if day not in scheduled:
                model.add(x[d.duty_id] == 0)
                eligible_ids.discard(d.duty_id)
                continue
            works.append(d.work_seconds * x[d.duty_id])
        else:
            known[0] += d.work_seconds
    for day, (works, known) in per_day.items():
        if works:
            # Planned work stays within the calendar's hours (the fixed days and hours
            # are not changed by planning). Work already done beyond them, which a
            # 36 agreement may allow, only closes the day to further assignments.
            model.add(sum(works) <= max(0, scheduled.get(day, 0) - known[0]))


def _variable_hour_limits(
    model: Any,
    snapshot: SolverSnapshotV2,
    person_id: str,
    own: list[Duty],
    fixed: list[Duty],
    x: dict[str, Any],
    eligible_ids: set[str],
) -> None:
    """One-month variable hours without an agreement: no overtime at all.

    Day: work <= max(8h, scheduled that day); week (cut at period boundaries):
    work <= max(40h, scheduled that week); period: work <= 40h x days / 7. Each
    "max" is an either/or with a Boolean, so the solver can prove infeasibility
    instead of relying on validator cuts. Statutory holidays stay forbidden.
    """
    from shift_scheduler.validation.work_accounting import variable_period

    zone = ZoneInfo("Asia/Tokyo")
    employments = [
        e
        for e in snapshot.employments
        if e.person_id == person_id and e.activity == "employment"
    ]
    anchors = {
        (e.variable_anchor, e.variable_period_days, e.week_start) for e in employments
    }
    if len(anchors) != 1:
        return  # unsupported combinations are reported by the validator
    ((anchor, length, week_start),) = anchors
    if anchor is None:
        return
    terms = {t.duty_id: t for t in snapshot.work_terms}
    holidays = {day for e in employments for day in e.statutory_holidays}

    def period_of(day: date) -> date:
        return variable_period(anchor, length, day)[0]

    def week_of(day: date) -> date:
        return max(
            day - timedelta(days=(day.weekday() - week_start) % 7), period_of(day)
        )

    buckets: dict[tuple[str, date], tuple[list[Any], list[Any], list[int]]] = (
        defaultdict(lambda: ([], [], [0, 0]))
    )
    for d in (*own, *fixed):
        day = d.start.astimezone(zone).date()
        work = d.work_seconds
        term = terms.get(d.duty_id)
        scheduled = sum(s.seconds for s in term.scheduled_work) if term else 0
        on_holiday = any(w in holidays for w in working_days(d))
        for key in (("day", day), ("week", week_of(day)), ("period", period_of(day))):
            works, schedules, known = buckets[key]
            if d.duty_id in x:
                works.append(work * x[d.duty_id])
                schedules.append(scheduled * x[d.duty_id])
            else:
                known[0] += work
                known[1] += scheduled
        if on_holiday:
            if d.duty_id in x:
                model.add(x[d.duty_id] == 0)
                eligible_ids.discard(d.duty_id)
            else:
                model.add(False)
    big = 31 * 24 * 3600
    for (kind, begin), (works, schedules, known) in buckets.items():
        total = sum(works) + known[0]
        if kind == "period":
            end = variable_period(anchor, length, begin)[1]
            model.add(total <= 144000 * (end - begin).days // 7)
            continue
        limit = 8 * 3600 if kind == "day" else 40 * 3600
        within_limit = model.new_bool_var(f"variable_{kind}_{person_id}_{begin}")
        model.add(total <= limit + big * within_limit.Not())
        model.add(total - (sum(schedules) + known[1]) <= big * within_limit)


def solve(
    snapshot: SolverSnapshot,
    budget_seconds: float = 25,
    cancelled: Callable[[], bool] = lambda: False,
    seed: int = 0,
    search_workers: int = 1,
) -> SolveResult:
    if not 0 < budget_seconds <= 300:
        raise ValueError("Solve budget must be in (0, 300] seconds")
    if search_workers not in (1, 2):
        raise ValueError("Validated solver settings allow one or two search workers")
    start = time.monotonic()
    common = {
        "input_hash": snapshot.input_hash,
        "rule_revision": snapshot.rule_revision,
        "solver_version": version("ortools"),
        "random_seed": seed,
        "search_workers": search_workers,
    }
    blockers = input_findings(snapshot)
    if blockers:
        return SolveResult(
            status="BLOCKED", diagnostics=tuple(f.message for f in blockers), **common
        )
    model = cp_model.CpModel()
    structural_diagnostics: list[str] = []
    duties = snapshot.candidates
    candidates_by_person = defaultdict(list)
    history_by_person = defaultdict(list)
    for duty in duties:
        candidates_by_person[duty.person_id].append(duty)
    for duty in snapshot.history:
        history_by_person[duty.person_id].append(duty)
    local_fixed = [
        d
        for d in snapshot.history
        if d.source != "external" and snapshot.horizon.overlaps(d)
    ]
    x = {d.duty_id: model.new_bool_var(f"d_{index}") for index, d in enumerate(duties)}
    eligible_ids: set[str] = set()
    leave_intervals = []
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.validation.leave_accounting import account_leave

        leave_intervals = account_leave(
            snapshot, snapshot.period.start.astimezone(JST).date()
        )["live_intervals"]
    v2_employers = {}
    if isinstance(snapshot, SolverSnapshotV2):
        employment_map = {e.revision_id: e.employer_id for e in snapshot.employments}
        v2_employers = {
            t.duty_id: employment_map[t.employment_revision_id]
            for t in snapshot.work_terms
        }
    for d in duties:
        c = contract_for(snapshot, d)
        from shift_scheduler.domain.capability_coverage import capability_covers

        capable = capability_covers(
            snapshot.capabilities, d.person_id, d.task, d.location, d, verified
        )
        allowed = bool(
            c
            and capable
            and d.kind in c.allowed_kinds
            and all(day.weekday() in c.allowed_weekdays for day in working_days(d))
        )
        if c and c.engagement == "agency":
            from shift_scheduler.domain.contract_segments import dispatch_tasks_for
            from shift_scheduler.validation.planning import contract_resolution

            allowed = (
                allowed
                and verified(c.dispatch_evidence, d.end)
                and d.task in dispatch_tasks_for(contract_resolution(snapshot, d))
            )
        if any(
            r.person_id == d.person_id
            and r.overlaps(d)
            and (not r.prohibited_kinds or d.kind in r.prohibited_kinds)
            for r in snapshot.restrictions
        ):
            allowed = False
        if any(
            a["person_id"] == d.person_id
            and a["employer_id"] == v2_employers.get(d.duty_id)
            and any(w.overlaps(Interval.model_validate(a["interval"])) for w in d.work)
            for a in leave_intervals
        ):
            allowed = False
        if any(
            a.person_id == d.person_id and any(w.overlaps(a) for w in d.work)
            for a in snapshot.leaves
        ):
            allowed = False
        usable_break = sum(
            b.seconds for b in d.breaks if d.start < b.start and b.end < d.end
        )
        needed_break = (
            3600
            if d.work_seconds > 8 * 3600
            else 2700 if d.work_seconds > 6 * 3600 else 0
        )
        if usable_break < needed_break:
            allowed = False
        if not allowed:
            model.add(x[d.duty_id] == 0)
        else:
            eligible_ids.add(d.duty_id)
        if d.fixed:
            model.add(x[d.duty_id] == 1)
            if not allowed:
                structural_diagnostics.append(
                    f"Fixed duty is outside verified availability: {d.duty_id}"
                )
        for fixed in history_by_person[d.person_id]:
            if fixed.person_id == d.person_id:
                rest = c.rest_seconds if c else 0
                gap = max(
                    (d.start - fixed.end).total_seconds(),
                    (fixed.start - d.end).total_seconds(),
                )
                if fixed.overlaps(d) or gap < rest:
                    model.add(x[d.duty_id] == 0)
                    eligible_ids.discard(d.duty_id)
    for a, b in chain.from_iterable(
        combinations(group, 2) for group in candidates_by_person.values()
    ):
        ca, cb = contract_for(snapshot, a), contract_for(snapshot, b)
        rest = max(ca.rest_seconds if ca else 0, cb.rest_seconds if cb else 0)
        gap = max((a.start - b.end).total_seconds(), (b.start - a.end).total_seconds())
        if a.overlaps(b) or gap < rest:
            model.add(x[a.duty_id] + x[b.duty_id] <= 1)
    for c in snapshot.contracts:
        terms = [
            sum(
                int(
                    (
                        min(w.end, snapshot.period.end)
                        - max(w.start, snapshot.period.start)
                    ).total_seconds()
                )
                for w in d.work
                if w.overlaps(snapshot.period)
            )
            * x[d.duty_id]
            for d in duties
            if contract_for(snapshot, d) == c
        ]
        if c.overlaps(snapshot.period):
            fixed_volume = sum(
                int(
                    (
                        min(w.end, snapshot.period.end)
                        - max(w.start, snapshot.period.start)
                    ).total_seconds()
                )
                for d in local_fixed
                if contract_for(snapshot, d) == c
                for w in d.work
                if w.overlaps(snapshot.period)
            )
            model.add(sum(terms) + fixed_volume >= c.period_min_seconds)
            model.add(sum(terms) + fixed_volume <= c.period_max_seconds)
            available_upper = sum(
                d.work_seconds
                for d in duties
                if d.duty_id in eligible_ids
                and contract_for(snapshot, d) == c
                and d.overlaps(snapshot.period)
            )
            if available_upper + fixed_volume < c.period_min_seconds:
                structural_diagnostics.append(
                    f"Contract {c.revision_id}: candidate upper bound is below required minimum"
                )
    # Calendar workload constraints are compiled independently from validator arithmetic.
    zone = ZoneInfo("Asia/Tokyo")
    for person in snapshot.people:
        own = [d for d in duties if d.person_id == person.person_id]
        fixed_duties = [d for d in snapshot.history if d.person_id == person.person_id]
        contracts = [c for c in snapshot.contracts if c.person_id == person.person_id]
        # Monthly variable hours allow scheduled days above 8h; their limits are
        # checked by the validator (proposals that break them are cut), not here.
        variable_hours = isinstance(snapshot, SolverSnapshotV2) and any(
            e.working_time_system in ("monthly_variable", "annual_variable", "flex")
            for e in snapshot.employments
            if e.person_id == person.person_id
        )
        simple_v2 = (
            isinstance(snapshot, SolverSnapshotV2)
            and not snapshot.agreements
            and not variable_hours
        )
        if (
            not isinstance(snapshot, SolverSnapshotV2)
            and not any(c.overtime_agreement_id for c in contracts)
        ) or simple_v2:
            employment_by_duty = {}
            week_starts = {snapshot.week_start}
            if isinstance(snapshot, SolverSnapshotV2):
                employment_by_id = {e.revision_id: e for e in snapshot.employments}
                employment_by_duty = {
                    t.duty_id: employment_by_id[t.employment_revision_id]
                    for t in snapshot.work_terms
                }
                week_starts = {
                    e.week_start
                    for e in snapshot.employments
                    if e.person_id == person.person_id and e.activity == "employment"
                }
            for origin in week_starts:
                day_terms = defaultdict(list)
                week_terms = defaultdict(list)
                known_day: dict[date, int] = defaultdict(int)
                known_week: dict[date, int] = defaultdict(int)
                for d in (*own, *fixed_duties):
                    employment = employment_by_duty.get(d.duty_id)
                    if employment and employment.activity == "nonemployment":
                        continue
                    day = d.start.astimezone(zone).date()
                    week = day - timedelta(days=(day.weekday() - origin) % 7)
                    holiday = (
                        d.statutory_holiday
                        if not employment
                        else any(
                            work_day in employment.statutory_holidays
                            for work_day in working_days(d)
                        )
                    )
                    if d.duty_id in x:
                        if holiday:
                            model.add(x[d.duty_id] == 0)
                            eligible_ids.discard(d.duty_id)
                        day_terms[day].append(d.work_seconds * x[d.duty_id])
                        week_terms[week].append(d.work_seconds * x[d.duty_id])
                    else:
                        known_day[day] += d.work_seconds
                        known_week[week] += d.work_seconds
                        if holiday:
                            model.add(False)
                for day in set(day_terms) | set(known_day):
                    model.add(sum(day_terms[day]) + known_day[day] <= 8 * 3600)
                for week in set(week_terms) | set(known_week):
                    model.add(sum(week_terms[week]) + known_week[week] <= 40 * 3600)
        if (
            variable_hours
            and isinstance(snapshot, SolverSnapshotV2)
            and not snapshot.agreements
        ):
            _variable_hour_limits(
                model, snapshot, person.person_id, own, fixed_duties, x, eligible_ids
            )
        if isinstance(snapshot, SolverSnapshotV2):
            _calendar_and_flex_limits(
                model, snapshot, person.person_id, own, fixed_duties, x, eligible_ids
            )
        if not contracts:
            continue
        days_to_variables = defaultdict(list)
        for d in own:
            for day in working_days(d):
                days_to_variables[day].append(x[d.duty_id])
        known_days = (
            set().union(*(working_days(d) for d in fixed_duties))
            if fixed_duties
            else set()
        )
        working: dict[date, cp_model.IntVar | int] = {}
        for day, variables in days_to_variables.items():
            flag = model.new_bool_var(f"working_{person.person_id}_{day}")
            if day in known_days:
                model.add(flag == 1)
            else:
                model.add_max_equality(flag, variables)
            working[day] = flag
        history_limit = max(c.max_consecutive_days for c in contracts)
        day = snapshot.period.start.astimezone(zone).date() - timedelta(
            days=history_limit
        )
        last = snapshot.horizon.end.astimezone(zone).date()
        while day < last:
            # Resolve the restriction at the final day of each run. An expired
            # tighter contract must not constrain the whole future horizon.
            day_start = datetime.combine(day, datetime.min.time(), zone)
            active = [c for c in contracts if c.start <= day_start < c.end]
            if active:
                limit = min(c.max_consecutive_days for c in active)
                consecutive_terms = [
                    working.get(
                        day - timedelta(days=i),
                        int(day - timedelta(days=i) in known_days),
                    )
                    for i in range(limit + 1)
                ]
                model.add(sum(consecutive_terms) <= limit)
            if (
                not isinstance(snapshot, SolverSnapshotV2)
                and day.weekday() == snapshot.week_start
                and day + timedelta(days=7) <= last
            ):
                model.add(
                    sum(
                        working.get(
                            day + timedelta(days=i),
                            int(day + timedelta(days=i) in known_days),
                        )
                        for i in range(7)
                    )
                    <= 6
                )
            day += timedelta(days=1)
    for demand in snapshot.demands:
        points = {demand.start, demand.end}
        matching = [
            d
            for d in (*duties, *local_fixed)
            if d.task == demand.task and d.location == demand.location
        ]
        for d in matching:
            for w in d.work:
                if w.overlaps(demand):
                    points.update((max(w.start, demand.start), min(w.end, demand.end)))
        from shift_scheduler.validation.planning import capability_boundaries

        points.update(capability_boundaries(snapshot.capabilities, matching, demand))
        ordered = sorted(points)
        for segment_start, segment_end in zip(ordered, ordered[1:], strict=False):
            span = Interval(start=segment_start, end=segment_end)
            eligible = [d for d in matching if any(w.contains(span) for w in d.work)]
            model.add(sum(x.get(d.duty_id, 1) for d in eligible) >= demand.minimum)
            possible = {
                d.person_id
                for d in eligible
                if d.duty_id in eligible_ids or d in local_fixed
            }
            if len(possible) < demand.minimum:
                # People on flextime are never assigned a timed duty; say so, since the
                # staffing then has to come from people on other working-time systems.
                flex_only = sorted(
                    {
                        d.person_id
                        for d in eligible
                        if d.person_id not in possible
                        and any(
                            e.working_time_system == "flex"
                            and e.person_id == d.person_id
                            and e.contains(d)
                            for e in getattr(snapshot, "employments", ())
                        )
                    }
                )
                structural_diagnostics.append(
                    f"Demand {demand.demand_id} at {segment_start.isoformat()}: at most {len(possible)} eligible people, requires {demand.minimum}"
                    + (
                        f"; {len(flex_only)} on flextime cannot take timed duties"
                        if flex_only
                        else ""
                    )
                )
            balance = []
            for d in eligible:
                caps = [
                    cap
                    for cap in snapshot.capabilities
                    if cap.person_id == d.person_id
                    and cap.task == d.task
                    and cap.location == d.location
                    and cap.contains(span)
                    and verified(cap.evidence, segment_end)
                ]
                coefficient = (
                    -1
                    if any(cap.supervision_required for cap in caps)
                    else max((cap.supervisor_capacity for cap in caps), default=0)
                )
                balance.append(coefficient * x.get(d.duty_id, 1))
            model.add(sum(balance) >= 0)
    previous = set(snapshot.previous_duty_ids)
    # Only published duty identities contribute to change cost. New-month assignments
    # are not penalized as changes merely because no previous schedule exists.
    changes = (
        (sum(1 - x[i] for i in previous) + sum(x[i] for i in x if i not in previous))
        if previous
        else 0
    )
    max_rank = max((p.rank for p in snapshot.preferences), default=1)
    preference_cost = sum(
        (max_rank - p.rank + 1) * x[d.duty_id]
        for p in snapshot.preferences
        for d in duties
        if p.person_id == d.person_id and any(w.overlaps(p) for w in d.work)
    )
    # Normalized burden by contract volume and eligible opportunities; integer ratios.
    normalized: list[cp_model.IntVar] = []
    max_ratio = 0
    # V3 has its own exact night/holiday objectives. Do not retain unused V1
    # division constraints: they add cost and impose an unrelated support envelope.
    for person in () if isinstance(snapshot, SolverSnapshotV3) else snapshot.people:
        own = [d for d in duties if d.person_id == person.person_id]
        if not own:
            continue
        from shift_scheduler.optimizer.fairness import capped_opportunity

        # Legacy opportunity is not clipped to the period (lookahead duties count),
        # so revisions within the whole horizon count as well.
        cap = capped_opportunity(
            snapshot.contracts,
            person.person_id,
            snapshot.horizon,
            [d for d in own if d.duty_id in eligible_ids],
            lambda d: [(w.start, w.end) for w in d.work],
        )
        spans = sorted(
            (w for d in own if d.duty_id in eligible_ids for w in d.work),
            key=lambda w: w.start,
        )
        opportunity = 0
        covered_until = None
        for span in spans:
            begin = max(span.start, covered_until) if covered_until else span.start
            opportunity += max(0, int((span.end - begin).total_seconds()))
            covered_until = max(covered_until, span.end) if covered_until else span.end
        exposure = min(cap, opportunity)
        if not exposure:
            continue
        historical = sum(
            b.seconds
            for b in snapshot.burden_history
            if b.person_id == person.person_id
        )
        history_exposure = sum(
            b.eligible_seconds
            for b in snapshot.burden_history
            if b.person_id == person.person_id
        )
        denominator = max(1, exposure + history_exposure)
        numerator = sum(d.work_seconds * x[d.duty_id] for d in own) + historical
        upper = 10000 * (opportunity + historical) // denominator + 1
        max_ratio = max(max_ratio, upper)
        ratio = model.new_int_var(0, upper, f"burden_{len(normalized)}")
        total = model.new_int_var(
            0, 10000 * (opportunity + historical), f"burden_total_{len(normalized)}"
        )
        model.add(total == 10000 * numerator)
        model.add_division_equality(ratio, total, denominator)
        normalized.append(ratio)
    deviations: list[cp_model.IntVar] = []
    for ratio_a, ratio_b in combinations(normalized, 2):
        delta = model.new_int_var(0, max_ratio, f"dev_{len(deviations)}")
        model.add_abs_equality(delta, ratio_a - ratio_b)
        deviations.append(delta)
    # Among equally fair plans prefer less unnecessary work; fairness remains lexically prior.
    total_possible = sum(d.work_seconds for d in duties)
    fairness = sum(deviations) * (total_possible + 1) + sum(
        d.work_seconds * x[d.duty_id] for d in duties
    )
    objectives = [changes, preference_cost, fairness]
    deferred_fairness = isinstance(snapshot, SolverSnapshotV3)
    if isinstance(snapshot, SolverSnapshotV3):
        common["fairness_revision"] = "eligible-night-holiday-v3"
        common["objective_encoding"] = {
            "kind": "not_started",
            "order": "changes, preferences, fairness",
        }
        # Exact rate digits are functional auxiliary variables, not mandatory
        # scheduling rules. Introduce them only after the higher priorities are
        # proved and fixed, so they cannot prevent finding a lawful incumbent.
        objectives = [changes, preference_cost]
    model_error = model.validate()
    if model_error:
        return SolveResult(status="MODEL_INVALID", diagnostics=(model_error,), **common)
    values: list[int] = []
    bounds: list[float] = []
    proven = 0
    incumbent: Proposal | None = None
    report = None
    status: SolveStatus = "UNKNOWN"
    stage_times: dict[str, float] = {"model_build": time.monotonic() - start}
    for level, objective in enumerate(objectives):
        model.minimize(objective)
        while True:
            remaining = budget_seconds - (time.monotonic() - start)
            if cancelled():
                return SolveResult(
                    status="CANCELLED",
                    elapsed_seconds=time.monotonic() - start,
                    **common,
                )
            if remaining <= 0:
                status = "FEASIBLE" if incumbent else "UNKNOWN"
                break
            solver = cp_model.CpSolver()
            solver.parameters.max_time_in_seconds = remaining
            solver.parameters.num_search_workers = search_workers
            solver.parameters.random_seed = seed
            stage_started = time.monotonic()
            result = solver.solve(model)
            stage_times[f"solve_{level}"] = (
                stage_times.get(f"solve_{level}", 0) + time.monotonic() - stage_started
            )
            status = cast(SolveStatus, solver.status_name(result))
            if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                break
            candidate = Proposal(
                duty_ids=tuple(d.duty_id for d in duties if solver.value(x[d.duty_id])),
                leave_ids=tuple(a.allocation_id for a in snapshot.leaves),
            )
            stage_started = time.monotonic()
            checked = validate(snapshot, candidate)
            stage_times["independent_validation"] = (
                stage_times.get("independent_validation", 0)
                + time.monotonic()
                - stage_started
            )
            if not checked.publishable:
                if any(f.status != "violation" for f in checked.findings):
                    return SolveResult(
                        status="BLOCKED",
                        validation=checked,
                        diagnostics=tuple(f.message for f in checked.findings),
                        elapsed_seconds=time.monotonic() - start,
                        **common,
                    )
                # Exclude this exact invalid assignment only. Do not infer that a
                # superset/subset also violates a non-monotone independent rule.
                selected = set(candidate.duty_ids)
                model.add(sum(1 - v if i in selected else v for i, v in x.items()) >= 1)
                continue
            incumbent, report = candidate, checked
            value = int(solver.value(objective))
            values.append(value)
            bounds.append(solver.best_objective_bound)
            if result == cp_model.OPTIMAL:
                proven += 1
                model.add(objective == value)
            break
        if status != "OPTIMAL":
            break
        if deferred_fairness and level == 1:
            from shift_scheduler.optimizer.fairness import (
                objectives as burden_objectives,
            )

            stage_started = time.monotonic()
            try:
                encoding: dict[str, Any] = {}
                objectives.extend(
                    burden_objectives(
                        # deferred_fairness is only set for V3 snapshots
                        model,
                        cast(SolverSnapshotV3, snapshot),
                        duties,
                        x,
                        eligible_ids,
                        encoding,
                    )
                )
                common["objective_encoding"] = encoding
            except ValueError as error:
                return SolveResult(
                    status="MODEL_INVALID", diagnostics=(str(error),), **common
                )
            stage_times["fairness_build"] = time.monotonic() - stage_started
            deferred_fairness = False
            model_error = model.validate()
            if model_error:
                return SolveResult(
                    status="MODEL_INVALID", diagnostics=(model_error,), **common
                )
        if incumbent:
            model.clear_hints()  # type: ignore[no-untyped-call]  # OR-Tools leaves it unannotated
            chosen = set(incumbent.duty_ids)
            for identity, variable in x.items():
                model.add_hint(variable, int(identity in chosen))
    if cancelled():
        status = "CANCELLED"
    if incumbent and status not in ("OPTIMAL", "CANCELLED"):
        status = "FEASIBLE"
    return SolveResult(
        status=status,
        proposal=incumbent,
        validation=report,
        objective_by_level=tuple(values),
        best_bound_by_level=tuple(bounds),
        proven_levels=proven,
        elapsed_seconds=time.monotonic() - start,
        stage_seconds=stage_times,
        diagnostics=(
            tuple(structural_diagnostics[:100])
            if status == "INFEASIBLE" and structural_diagnostics
            else (
                (
                    "Joint mandatory constraints are inconsistent; no unique/minimal conflict core is claimed",
                )
                if status == "INFEASIBLE"
                else ()
            )
        ),
        **common,
    )
