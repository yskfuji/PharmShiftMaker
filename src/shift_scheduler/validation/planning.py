"""Independent interval arithmetic over original input, not CP-SAT coefficients.

Supported initial policy: Japanese general working time, calendar-month agreements,
weekly calendar-day holidays. Unimplemented legal variants are explicitly blocked.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from shift_scheduler.domain.compliance import SolverSnapshotV2
from shift_scheduler.domain.contract_segments import ContractResolution
from shift_scheduler.domain.planning import (
    Capability,
    ContractRevision,
    Duty,
    Evidence,
    Finding,
    FindingStatus,
    Interval,
    Proposal,
    SolverSnapshot,
    ValidationReport,
    content_hash,
)

JST = ZoneInfo("Asia/Tokyo")
RULES = (
    "input.evidence",
    "contract.effective",
    "capability",
    "dispatch",
    "overlap",
    "rest",
    "break",
    "contract.volume",
    "work.general",
    "holiday.weekly",
    "consecutive",
    "coverage",
    "supervision",
    "restriction",
    "leave",
    "fixed",
)


def verified(evidence: Evidence | None, until: datetime) -> bool:
    return bool(
        evidence
        and evidence.status == "verified"
        and (evidence.valid_until is None or evidence.valid_until >= until)
    )


def capability_boundaries(
    capabilities: Iterable[Capability], duties: Iterable[Duty], demand: Interval
) -> set[datetime]:
    """Capability record starts/ends strictly inside the demand, for these duties."""
    keys = {(d.person_id, d.task, d.location) for d in duties}
    return {
        t
        for c in capabilities
        if (c.person_id, c.task, c.location) in keys
        for t in (c.start, c.end)
        if demand.start < t < demand.end
    }


CONTRACT_MESSAGES = {
    "no_effective_contract": "No single effective contract covers entire duty",
    "contract_coverage_partial": "Contract revisions do not cover the whole duty",
    "contract_revision_gap": "Gap between contract revisions within duty",
    "contract_revision_incompatible": "Contract revisions within duty differ in employer, place, engagement or regime",
}


def contract_resolution(snapshot: SolverSnapshot, duty: Duty) -> ContractResolution:
    from shift_scheduler.domain.contract_segments import resolve_contract

    return resolve_contract(
        snapshot.contracts, duty.relationship_id, duty, duty.person_id
    )


def contract_for(snapshot: SolverSnapshot, duty: Duty) -> ContractRevision | None:
    """The governing revision (in effect at the duty start), or None with a reason."""
    return contract_resolution(snapshot, duty).governing


def working_days(duty: Duty) -> set[date]:
    days: set[date] = set()
    for work in duty.work:
        start = work.start.astimezone(JST).date()
        end = (work.end - timedelta(seconds=1)).astimezone(JST).date()
        while start <= end:
            days.add(start)
            start += timedelta(days=1)
    return days


def input_findings(snapshot: SolverSnapshot) -> list[Finding]:
    errors: list[Finding] = []

    def add(rule: str, message: str, state: FindingStatus = "unverified") -> None:
        errors.append(Finding(rule_id=rule, status=state, message=message))

    # Days are calendar days in Japan time (昭63.1.1基発1号; statutory holidays are
    # calendar days). Rules count whole days, so the planned period and the checked
    # context must start and end at local midnight, written with the +09:00 offset.
    for name, instant in (
        ("period start", snapshot.period.start),
        ("period end", snapshot.period.end),
        ("context start", snapshot.context.start),
        ("context end", snapshot.context.end),
    ):
        if (
            instant.utcoffset() != timedelta(hours=9)
            or instant.astimezone(JST).time() != time()
        ):
            add(
                "period.boundary",
                f"The {name} must be midnight in Japan time (+09:00)",
                "unsupported",
            )
    if not verified(snapshot.policy_evidence, snapshot.period.end):
        add(
            "input.evidence",
            "Facility rules have not been verified for the whole period",
        )
    if snapshot.unresolved_requests:
        add(
            "leave.pending",
            "Unresolved statutory leave requests require a documented decision",
        )
    if snapshot.reservation_credits and not snapshot.replaces_publication_id:
        add(
            "leave.credit",
            "Reservation credit requires an authoritative publication reference",
        )
    if snapshot.lookahead_days and not snapshot.lookahead_demand_confirmed:
        add(
            "lookahead",
            "Lookahead demand, including declared zero demand, has not been reconciled",
        )
    if not snapshot.history_complete:
        add("history", "Prior work and fixed future duties have not been reconciled")
    for burden in snapshot.burden_history:
        if not verified(burden.eligibility_evidence, snapshot.period.end):
            add(
                "fairness.history",
                "Historical eligible opportunities, excluding protected leave, require verified evidence",
            )
    if not snapshot.candidate_catalog_complete:
        add("catalog", "Allowed duty catalog completeness has not been verified")
    for c in snapshot.contracts:
        if not verified(c.evidence, min(c.end, snapshot.period.end)) or not verified(
            c.regime_evidence, min(c.end, snapshot.period.end)
        ):
            add("contract.evidence", f"Unverified contract/regime: {c.revision_id}")
        employments = [
            e
            for e in getattr(snapshot, "employments", ())
            if e.person_id == c.person_id
            and e.activity == "employment"
            and e.overlaps(c)
        ]
        if (
            c.regime == "variable"
            and employments
            and all(
                e.working_time_system in ("monthly_variable", "annual_variable")
                for e in employments
            )
        ):
            pass  # variable hours of up to one month or one year: accounted by work_accounting
        elif (
            c.regime == "flex"
            and employments
            and all(e.working_time_system == "flex" for e in employments)
        ):
            pass  # flextime: settled from actual work by work_accounting; no timed duty is assigned
        elif c.regime != "general":
            add(
                "regime",
                f"Regime requires an independently verified adapter: {c.regime}",
                "unsupported",
            )
        elif any(e.working_time_system != "standard" for e in employments):
            add(
                "regime",
                f"Contract regime and employment working-time system differ: {c.revision_id}",
            )
        if not c.external_work_confirmed:
            add(
                "external_work",
                f"External work declaration not reconciled: {c.person_id}",
            )
    for demand in snapshot.demands:
        if not verified(demand.evidence, demand.end):
            add("demand.evidence", f"Unverified required staffing: {demand.demand_id}")
    # Start-of-week and previous duty context cannot silently disappear at month end.
    earliest = snapshot.period.start.astimezone(JST).date() - timedelta(days=7)
    if snapshot.context.start.astimezone(JST).date() > earliest:
        add(
            "history",
            "At least the preceding seven days of reconciled context are required",
        )
    for agreement in snapshot.overtime_agreements:
        if not verified(agreement.evidence, snapshot.period.end):
            add("agreement", "Overtime agreement has not been verified")
        year_end = date(agreement.year_start.year + 1, agreement.year_start.month, 1)
        if not (
            agreement.year_start <= snapshot.period.start.astimezone(JST).date()
            and (snapshot.period.end - timedelta(seconds=1)).astimezone(JST).date()
            < year_end
        ):
            add(
                "agreement.period",
                "Planning period is not covered by the agreement year",
            )
        if agreement.special_clause and not verified(
            agreement.special_invocation_evidence, snapshot.period.end
        ):
            add(
                "agreement.special",
                "Special clause invocation and procedure have not been verified",
            )
        if agreement.special_clause and agreement.monthly_limit_seconds >= 100 * 3600:
            # Labour Standards Act Art. 36(6)(ii): under 100h; stored 100h stays readable.
            add(
                "agreement.special",
                "Special-clause monthly limit must be below 100h",
                "violation",
            )
        needed = min(
            agreement.year_start,
            snapshot.period.start.astimezone(JST).date() - timedelta(days=186),
        )
        if snapshot.context.start.astimezone(JST).date() > needed:
            add(
                "agreement.history",
                "Agreement-year and rolling six-month history are required",
            )
    if snapshot.overtime_agreements and any(
        d.source == "external" for d in snapshot.history
    ):
        add(
            "external.overtime",
            "Multiple-employer overtime allocation requires verified contract-order/accounting adapter",
            "unsupported",
        )
    for c in snapshot.contracts:
        if (
            not isinstance(snapshot, SolverSnapshotV2)
            and c.overtime_agreement_id
            and not any(
                a.agreement_id == c.overtime_agreement_id
                and a.employer_id == c.employer_id
                for a in snapshot.overtime_agreements
            )
        ):
            add(
                "agreement.employer",
                "Contract agreement is absent or belongs to another employer",
            )
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.validation.leave_accounting import account_leave
        from shift_scheduler.validation.work_accounting import (
            input_findings as work_inputs,
        )

        errors.extend(work_inputs(snapshot))
        errors.extend(
            account_leave(snapshot, snapshot.period.start.astimezone(JST).date())[
                "findings"
            ]
        )
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

    if isinstance(snapshot, SolverSnapshotV3):
        from shift_scheduler.validation.v3_inputs import input_findings as v3_inputs

        errors.extend(v3_inputs(snapshot))
    return errors


def validate(snapshot: SolverSnapshot, proposal: Proposal) -> ValidationReport:
    findings = input_findings(snapshot)

    def fail(
        rule: str,
        message: str,
        *subjects: str,
        state: FindingStatus = "violation",
    ) -> None:
        findings.append(
            Finding(
                rule_id=rule, status=state, message=message, subjects=tuple(subjects)
            )
        )

    by_id = {d.duty_id: d for d in snapshot.candidates}
    if not set(proposal.duty_ids) <= by_id.keys():
        fail("input.reference", "Unknown duty ID")
    selected = [by_id[i] for i in proposal.duty_ids if i in by_id]
    all_duties = [*snapshot.history, *selected]
    leaves = {a.allocation_id: a for a in snapshot.leaves}
    if set(proposal.leave_ids) != set(leaves):
        fail(
            "leave",
            "Confirmed leave decisions must be carried into the proposal exactly once",
        )
    grants = {g.grant_id: g for g in snapshot.grants}
    reserved: dict[str, int] = defaultdict(int)
    for allocation in snapshot.leaves:
        grant = grants.get(allocation.grant_id)
        if not grant or grant.person_id != allocation.person_id:
            fail(
                "leave.reference",
                "Unknown or mismatched grant",
                allocation.allocation_id,
            )
            continue
        if not verified(grant.evidence, allocation.end) or not verified(
            allocation.decision, allocation.end
        ):
            fail(
                "leave.evidence",
                "Leave grant/decision unverified",
                allocation.allocation_id,
                state="unverified",
            )
        start_date = allocation.start.astimezone(JST).date()
        end_date = (allocation.end - timedelta(seconds=1)).astimezone(JST).date()
        if grant.unit == "second" and allocation.amount != allocation.seconds:
            fail(
                "leave.unit",
                "Time-based leave amount must equal the explicitly requested interval in seconds",
                allocation.allocation_id,
            )
        if grant.unit == "second":
            fail(
                "leave.time_adapter",
                "Hourly annual leave agreement, day conversion and annual cap adapter are not yet verified",
                allocation.allocation_id,
                state="unsupported",
            )
        if grant.unit == "day" and (
            allocation.start.astimezone(JST).time() != time()
            or allocation.end.astimezone(JST).time() != time()
            or allocation.seconds != allocation.amount * 86400
        ):
            fail(
                "leave.unit",
                "Day-based allocation needs explicit whole calendar days; half-day conversion requires a separate adapter",
                allocation.allocation_id,
            )
        if start_date < grant.granted_on or end_date >= grant.expires_on:
            fail(
                "leave.validity",
                "Leave outside grant validity",
                allocation.allocation_id,
            )
        reserved[grant.grant_id] += allocation.amount
        for duty in all_duties:
            if duty.person_id == allocation.person_id and any(
                w.overlaps(allocation) for w in duty.work
            ):
                fail("leave.work", "Work overlaps confirmed leave", duty.duty_id)
    for grant_id, amount in reserved.items():
        g = grants[grant_id]
        credit = sum(
            a.amount
            for a in snapshot.reservation_credits
            if a.grant_id == grant_id and a.person_id == g.person_id
        )
        if credit > g.reserved:
            fail(
                "leave.credit",
                "Replacement credit exceeds authoritative reservations",
                grant_id,
            )
        if amount + g.reserved - credit + g.consumed > g.amount:
            fail("leave.balance", "Insufficient unreserved leave", grant_id)

    volume: dict[str, int] = defaultdict(int)
    local_fixed = [
        d
        for d in snapshot.history
        if d.source != "external" and snapshot.horizon.overlaps(d)
    ]
    for d in [*selected, *local_fixed]:
        resolution = contract_resolution(snapshot, d)
        contract = resolution.governing
        if contract is None:
            assert resolution.reason is not None  # set whenever governing is None
            fail(
                "contract.effective",
                CONTRACT_MESSAGES[resolution.reason],
                d.duty_id,
            )
            continue
        volume[contract.revision_id] += sum(
            int(
                (
                    min(w.end, snapshot.period.end)
                    - max(w.start, snapshot.period.start)
                ).total_seconds()
            )
            for w in d.work
            if w.overlaps(snapshot.period)
        )
        if d.kind not in contract.allowed_kinds or any(
            day.weekday() not in contract.allowed_weekdays for day in working_days(d)
        ):
            fail(
                "contract.availability", "Duty outside contract availability", d.duty_id
            )
        from shift_scheduler.domain.contract_segments import dispatch_tasks_for

        if contract.engagement == "agency" and (
            not verified(contract.dispatch_evidence, d.end)
            or d.task not in dispatch_tasks_for(resolution)
        ):
            fail(
                "dispatch",
                "Dispatch task/place/period eligibility not verified",
                d.duty_id,
                state="unverified",
            )
        from shift_scheduler.domain.capability_coverage import capability_covers

        if not capability_covers(
            snapshot.capabilities, d.person_id, d.task, d.location, d, verified
        ):
            fail("capability", "No verified capability covers duty", d.duty_id)
        for restriction in snapshot.restrictions:
            if restriction.person_id == d.person_id and restriction.overlaps(d):
                if not verified(restriction.evidence, d.end):
                    fail(
                        "restriction.evidence",
                        "Restriction applicability unverified",
                        d.duty_id,
                        state="unverified",
                    )
                if (
                    not restriction.prohibited_kinds
                    or d.kind in restriction.prohibited_kinds
                ):
                    fail(
                        "restriction",
                        "Duty conflicts with protected restriction",
                        d.duty_id,
                    )
        # Break must be inside working duty, not a nominal period tacked on after work.
        usable_break = sum(
            b.seconds for b in d.breaks if d.start < b.start and b.end < d.end
        )
        needed = (
            3600
            if d.work_seconds > 8 * 3600
            else 2700 if d.work_seconds > 6 * 3600 else 0
        )
        if usable_break < needed:
            fail("break", "Insufficient in-duty rest break", d.duty_id)
    for c in snapshot.contracts:
        if (
            c.overlaps(snapshot.period)
            and not c.period_min_seconds
            <= volume[c.revision_id]
            <= c.period_max_seconds
        ):
            fail(
                "contract.volume",
                "Contract planning-period working time bounds violated",
                c.revision_id,
            )
    for d in snapshot.candidates:
        if d.fixed and d.duty_id not in proposal.duty_ids:
            fail("fixed", "Fixed duty removed", d.duty_id)

    by_person: dict[str, list[Duty]] = defaultdict(list)
    for d in all_duties:
        by_person[d.person_id].append(d)
    for person, duties in by_person.items():
        duties.sort(key=lambda d: d.start)
        for a, b in zip(duties, duties[1:], strict=False):
            if a.overlaps(b):
                fail(
                    "overlap",
                    "Duties overlap across employment relationships",
                    a.duty_id,
                    b.duty_id,
                )
            ca, cb = contract_for(snapshot, a), contract_for(snapshot, b)
            rest = max(ca.rest_seconds if ca else 0, cb.rest_seconds if cb else 0)
            if (b.start - a.end).total_seconds() < rest:
                fail("rest", "Insufficient inter-duty rest", a.duty_id, b.duty_id)
        days = sorted(set().union(*(working_days(d) for d in duties)))
        run = 0
        previous = None
        for day in days:
            run = run + 1 if previous and day == previous + timedelta(days=1) else 1
            at = datetime.combine(day, time(), JST)
            active = [
                c
                for c in snapshot.contracts
                if c.person_id == person and c.start <= at < c.end
            ]
            if active and run > min(c.max_consecutive_days for c in active):
                fail("consecutive", "Maximum consecutive days exceeded", person)
            previous = day
        day_set = set(days)
        week = snapshot.period.start.astimezone(JST).date()
        week -= timedelta(days=(week.weekday() - snapshot.week_start) % 7)
        while week + timedelta(days=7) <= snapshot.horizon.end.astimezone(JST).date():
            if not isinstance(snapshot, SolverSnapshotV2) and all(
                week + timedelta(days=i) in day_set for i in range(7)
            ):
                fail(
                    "holiday.weekly",
                    "No full calendar holiday in statutory week",
                    person,
                )
            week += timedelta(days=7)
        if not isinstance(snapshot, SolverSnapshotV2):
            findings.extend(_general_work_findings(snapshot, person, duties))
    if isinstance(snapshot, SolverSnapshotV2):
        from shift_scheduler.validation.leave_accounting import account_leave
        from shift_scheduler.validation.work_accounting import account_work

        findings.extend(account_work(snapshot, all_duties)["findings"])
        findings.extend(
            account_leave(
                snapshot, snapshot.period.start.astimezone(JST).date(), all_duties
            )["findings"]
        )

    # Split at every actual work boundary. A multi-skilled worker counts once per segment.
    for demand in snapshot.demands:
        boundaries = {demand.start, demand.end}
        matching = [
            d
            for d in [*selected, *local_fixed]
            if d.task == demand.task and d.location == demand.location
        ]
        for duty in matching:
            for w in duty.work:
                if w.overlaps(demand):
                    boundaries.update(
                        (max(w.start, demand.start), min(w.end, demand.end))
                    )
        # Also split where a capability record is renewed, so every segment lies
        # within one record and supervision is judged on it (never skipped).
        boundaries.update(
            capability_boundaries(snapshot.capabilities, matching, demand)
        )
        points = sorted(boundaries)
        for start, end in zip(points, points[1:], strict=False):
            segment = Interval(start=start, end=end)
            covering = [d for d in matching if any(w.contains(segment) for w in d.work)]
            if len({d.person_id for d in covering}) < demand.minimum:
                fail(
                    "coverage",
                    f"Required staffing missing at {start.isoformat()}",
                    demand.demand_id,
                )
            supervised = 0
            capacity = 0
            for d in covering:
                caps = [
                    c
                    for c in snapshot.capabilities
                    if c.person_id == d.person_id
                    and c.task == d.task
                    and c.location == d.location
                    and c.contains(segment)
                    and verified(c.evidence, end)
                ]
                if caps:
                    supervised += int(any(c.supervision_required for c in caps))
                    if not any(c.supervision_required for c in caps):
                        capacity += max(c.supervisor_capacity for c in caps)
            if supervised > capacity:
                fail(
                    "supervision",
                    "Insufficient supervision at required location/time",
                    demand.demand_id,
                )
    return ValidationReport(
        input_hash=snapshot.input_hash,
        proposal_hash=content_hash(proposal.model_dump(mode="json")),
        findings=tuple(findings),
        checked_rules=RULES
        + (
            ("work.v2.input", "work.v2", "leave.v2")
            if isinstance(snapshot, SolverSnapshotV2)
            else ()
        ),
    )


def _general_work_findings(
    snapshot: SolverSnapshot, person: str, duties: list[Duty]
) -> list[Finding]:
    """Daily excess plus non-duplicated weekly excess; midnight is not a reset."""
    errors: list[Finding] = []

    def fail(message: str, state: FindingStatus = "violation") -> None:
        errors.append(
            Finding(
                rule_id="work.general",
                status=state,
                message=message,
                subjects=(person,),
            )
        )

    by_day: dict[date, int] = defaultdict(int)
    holiday: dict[date, int] = defaultdict(int)
    employers = set()
    agreement_ids = set()
    for d in duties:
        c = contract_for(snapshot, d)
        if c:
            employers.add(c.employer_id)
            if c.overtime_agreement_id:
                agreement_ids.add(c.overtime_agreement_id)
        day = d.start.astimezone(JST).date()
        (holiday if d.statutory_holiday else by_day)[day] += d.work_seconds
    agreements = [
        a for a in snapshot.overtime_agreements if a.agreement_id in agreement_ids
    ]
    if agreement_ids - {a.agreement_id for a in agreements}:
        fail("Missing referenced overtime agreement", "unverified")
    if len(employers) > 1 and agreements:
        fail(
            "Multiple-employer overtime allocation adapter not implemented",
            "unsupported",
        )
    daily_excess = {day: max(0, seconds - 8 * 3600) for day, seconds in by_day.items()}
    weeks: dict[date, list[date]] = defaultdict(list)
    for day in sorted(by_day):
        weeks[day - timedelta(days=(day.weekday() - snapshot.week_start) % 7)].append(
            day
        )
    overtime: dict[date, int] = defaultdict(int, daily_excess)
    for days in weeks.values():
        running = 0
        for day in days:
            ordinary = min(by_day[day], 8 * 3600)
            extra = max(0, running + ordinary - 40 * 3600) - max(0, running - 40 * 3600)
            overtime[day] += extra
            running += ordinary
    if not agreements:
        if any(overtime.values()) or any(holiday.values()):
            fail("Overtime/statutory holiday work requires verified agreement")
        return errors
    if len(agreements) != 1:
        fail(
            "Multiple agreement revisions within context require dedicated accounting",
            "unsupported",
        )
        return errors
    agreement = agreements[0]
    if any(
        value > agreement.daily_overtime_limit_seconds
        for value in daily_excess.values()
    ):
        fail("Agreement daily overtime limit exceeded")
    if any(holiday.values()) and not agreement.holiday_work_permitted:
        fail("Agreement does not permit statutory holiday work")
    if any(
        d.start.astimezone(JST).date()
        != (d.end - timedelta(seconds=1)).astimezone(JST).date()
        for d in duties
    ):
        fail(
            "Cross-midnight overtime/holiday attribution requires a verified holiday-calendar adapter",
            "unsupported",
        )
    monthly: dict[tuple[int, int], int] = defaultdict(int)
    combined: dict[tuple[int, int], int] = defaultdict(int)
    for day in set(overtime) | set(holiday):
        monthly[(day.year, day.month)] += overtime[day]
        combined[(day.year, day.month)] += overtime[day] + holiday[day]
    year_end = date(agreement.year_start.year + 1, agreement.year_start.month, 1)
    annual = sum(
        amount
        for day, amount in overtime.items()
        if agreement.year_start <= day < year_end
    )
    if annual > agreement.annual_limit_seconds:
        fail("Agreement-year overtime cap exceeded")
    excess_months = 0
    for (year, month), amount in monthly.items():
        if agreement.year_start <= date(year, month, 1) < year_end:
            excess_months += int(amount > 45 * 3600)
            if amount > agreement.monthly_limit_seconds:
                fail("Agreement-month overtime cap exceeded")
    if excess_months > 6:
        fail("More than six months above ordinary monthly overtime cap")
    for key, total in list(combined.items()):
        if total >= 100 * 3600:
            fail("Overtime plus statutory holiday work must be below 100 hours")
        index = key[0] * 12 + key[1] - 1
        for n in range(2, 7):
            keys = [((index - i) // 12, (index - i) % 12 + 1) for i in range(n)]
            if sum(combined.get(k, 0) for k in keys) > n * 80 * 3600:
                fail("Rolling overtime plus holiday average exceeds 80 hours")
    return errors
