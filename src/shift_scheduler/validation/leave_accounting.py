"""Event replay with exact day fractions; elapsed duty seconds are not leave days."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime, time
from fractions import Fraction
from typing import TYPE_CHECKING, Any, cast
from zoneinfo import ZoneInfo

from shift_scheduler.domain.compliance import LeaveRecord, SolverSnapshotV2
from shift_scheduler.domain.planning import Duty, Finding, FindingStatus
from shift_scheduler.validation.work_accounting import month_boundary, verified

if TYPE_CHECKING:
    from shift_scheduler.domain.compliance_v3 import LeaveObligationV3

JST = ZoneInfo("Asia/Tokyo")


def _fraction(value: Fraction) -> dict[str, int]:
    return {"numerator": value.numerator, "denominator": value.denominator}


def _account_leave(
    snapshot: SolverSnapshotV2,
    as_of: date,
    duties: list[Duty] | None = None,
    *,
    grant_changes: Sequence[dict[str, Any]] = (),
) -> dict[str, Any]:
    accounts = {a.account_id: a for a in snapshot.leave_accounts}
    employment = {e.revision_id: e for e in snapshot.employments}
    duty_employers = {
        t.duty_id: employment[t.employment_revision_id].employer_id
        for t in snapshot.work_terms
    }
    policies = {p.policy_id: p for p in snapshot.leave_policies}
    remaining = {key: Fraction(a.granted_days) for key, a in accounts.items()}
    for change in grant_changes:
        remaining[change["account_id"]] -= (
            change["corrected_days"] - change["previous_days"]
        )
    reservations: dict[str, Fraction] = defaultdict(Fraction)
    used: dict[str, Fraction] = defaultdict(Fraction)
    hourly: dict[tuple[str, str, date], Fraction] = defaultdict(Fraction)
    original: dict[str, LeaveRecord] = {}
    amounts: dict[str, Fraction] = {}
    discharged: dict[str, Fraction] = defaultdict(Fraction)
    findings: list[Finding] = []
    trace: list[dict[str, Any]] = []

    def fail(message: str, subject: str, state: FindingStatus = "violation") -> None:
        findings.append(
            Finding(
                rule_id="leave.v2", status=state, message=message, subjects=(subject,)
            )
        )

    for account in accounts.values():
        if (
            account.granted_on >= account.expires_on
            or account.statutory_days > account.granted_days
        ):
            fail("Invalid grant bounds", account.account_id)
        elif account.statutory_days and account.expires_on < two_years_after(
            account.granted_on
        ):
            # Statutory leave cannot expire before two years (Labour Standards
            # Act Art. 115); the imported HR value is kept and referred to HR.
            fail(
                "Statutory leave expires earlier than two years after grant",
                account.account_id,
                "unverified",
            )
        if not verified(
            account.evidence, datetime.combine(account.granted_on, time(), JST)
        ):
            fail("Unverified external HR grant", account.account_id, "unverified")
    # Two statutory grants to one person and employer on the same date are only
    # plausible as members of one documented grant cycle; otherwise the import
    # may be duplicated and entitlement would be counted twice.
    same_day: dict[tuple[str, str, date], list[Any]] = {}
    for account in accounts.values():
        if account.statutory_days:
            same_day.setdefault(
                (account.person_id, account.employer_id, account.granted_on), []
            ).append(account)
    for group in same_day.values():
        cycle_ids = {a.grant_cycle_id for a in group}
        if len(group) > 1 and (None in cycle_ids or len(cycle_ids) > 1):
            for account in group:
                fail(
                    "Duplicate statutory grant base date outside one grant cycle",
                    account.account_id,
                    "unverified",
                )
    # Preserve causal event order within each day, interleaving grant changes at
    # their effective date instead of applying the final grant before conversion.
    # Items are LeaveRecord (action 1) or grant-change trace dicts (action 0).
    replay: list[tuple[date, int, int, Any]] = [
        (event.effective_on, 1, i, event)
        for i, event in enumerate(snapshot.leave_records)
    ]
    replay += [
        (date.fromisoformat(c["effective_on"]), 0, i, c)
        for i, c in enumerate(grant_changes)
    ]
    replay.sort(key=lambda item: item[:3])
    for _, action, _, event in replay:
        if action == 0:
            key = event["account_id"]
            remaining[key] += event["corrected_days"] - event["previous_days"]
            if remaining[key] < reservations[key]:
                fail(
                    "Grant correction leaves acquired/reserved leave underfunded",
                    event["amendment_id"],
                )
            continue
        a, p = accounts.get(event.account_id), policies.get(event.policy_id)
        if (
            not a
            or not p
            or (a.person_id, a.employer_id) != (p.person_id, p.employer_id)
        ):
            fail("Unknown/mismatched leave account or policy", event.event_id)
            continue
        when = datetime.combine(event.effective_on, time(), JST)
        if not verified(event.evidence, when) or not verified(p.evidence, when):
            fail("Unverified leave decision/policy", event.event_id, "unverified")
        if not (p.start <= when < p.end):
            fail("Leave policy is not effective", event.event_id)
        value = Fraction(
            event.quantity,
            (
                1
                if event.unit == "day"
                else 2 if event.unit == "half_day" else p.hours_per_day
            ),
        )
        if event.unit == "half_day" and not p.half_day_enabled:
            fail("Half-day leave has not been agreed", event.event_id)
        if event.unit == "hour" and (
            not p.hourly_enabled or event.quantity % p.hourly_quantum
        ):
            fail("Hourly leave agreement/quantum missing", event.event_id)
        if event.kind in {"reserve", "take"}:
            if event.unit in {"day", "half_day"} and event.quantity != 1:
                fail(
                    "One day/half-day event must identify exactly one affected workday",
                    event.event_id,
                )
            if (
                event.interval
                and event.interval.start.astimezone(JST).date() != event.effective_on
            ):
                fail("Leave interval and affected workday differ", event.event_id)
            if not (a.granted_on <= event.effective_on < a.expires_on):
                fail("Leave outside grant validity", event.event_id)
            if event.interval is None:
                fail("Leave requires explicit affected work interval", event.event_id)
            elif (
                event.unit == "hour" and event.interval.seconds != event.quantity * 3600
            ):
                fail(
                    "Hourly leave interval does not equal requested hours",
                    event.event_id,
                )
        if event.kind == "reserve":
            reservations[event.account_id] += value
        elif event.kind in {"release", "take", "reverse"}:
            linked = original.get(event.related_event_id or "")
            expected = "take" if event.kind == "reverse" else "reserve"
            # Imported actual leave can be taken without a planning reservation.
            if (
                linked is None
                and event.kind == "take"
                and event.related_event_id is None
            ):
                pass
            elif (
                linked is None
                or linked.kind != expected
                or linked.account_id != event.account_id
                or linked.unit != event.unit
                or linked.policy_id != event.policy_id
            ):
                fail(
                    "Leave event does not reference the matching reservation/actual",
                    event.event_id,
                )
                continue
            else:
                if event.kind == "take" and (
                    event.interval != linked.interval
                    or event.effective_on != linked.effective_on
                    or event.quantity != linked.quantity
                ):
                    fail(
                        "Actual leave must match its reservation; release and rebook changed intervals",
                        event.event_id,
                    )
                    continue
                discharged[linked.event_id] += value
                if discharged[linked.event_id] > amounts[linked.event_id]:
                    fail(
                        "Referenced leave has already been consumed/reversed",
                        event.event_id,
                    )
                if event.kind in {"release", "take"}:
                    reservations[event.account_id] -= value
            if event.kind == "take":
                remaining[event.account_id] -= value
                used[event.account_id] += value
            elif event.kind == "reverse":
                remaining[event.account_id] += value
                used[event.account_id] -= value
        elif event.kind == "expire":
            if event.effective_on < a.expires_on or reservations[event.account_id]:
                fail("Cannot expire a valid or reserved grant", event.event_id)
            remaining[event.account_id] -= value
        elif event.kind == "conversion":
            old, new = event.conversion_old_hours, event.conversion_new_hours
            prior_policies = [
                prior
                for prior in policies.values()
                if prior.person_id == p.person_id
                and prior.employer_id == p.employer_id
                and prior.end == p.start
                and prior.hours_per_day == old
            ]
            if (
                not old
                or new != p.hours_per_day
                or reservations[event.account_id]
                or len(prior_policies) != 1
                or when != p.start
            ):
                fail(
                    "Conversion requires explicit old/new hours and reconciled reservations",
                    event.event_id,
                )
                continue
            balance = remaining[event.account_id]
            if balance < 0:
                fail(
                    "Negative balance requires HR reconciliation before conversion",
                    event.event_id,
                )
                continue
            full_days = balance.numerator // balance.denominator
            residual = balance - full_days
            converted = math.ceil(residual * new)
            if event.quantity != converted or event.unit != "hour":
                fail(
                    "Conversion does not match ceil(residual days * new hours/day)",
                    event.event_id,
                )
                continue
            remaining[event.account_id] = Fraction(full_days) + Fraction(converted, new)
            trace.append(
                {
                    "event_id": event.event_id,
                    "before": _fraction(balance),
                    "after": _fraction(remaining[event.account_id]),
                    "formula": "whole_days + ceil(residual_days * new_hours_per_day) / new_hours_per_day",
                    "source": "MHLW-2009-1005-1",
                    "old_hours": old,
                    "new_hours": new,
                }
            )
        original[event.event_id] = event
        amounts[event.event_id] = value
        if (
            remaining[event.account_id] < reservations[event.account_id]
            or reservations[event.account_id] < 0
            or used[event.account_id] < 0
        ):
            fail("Leave balance/reservation invariant violated", event.event_id)
    # Live reservations and actuals both occupy time, but only actuals count toward five days.
    live: list[LeaveRecord] = []
    for key, event in original.items():
        if event.kind in {"reserve", "take"} and amounts[key] > discharged[key]:
            live.append(event)
            p, a = policies[event.policy_id], accounts[event.account_id]
            if event.unit == "hour":
                year = p.hourly_year_start
                if not year <= event.effective_on < month_boundary(year, 12):
                    fail(
                        "Hourly leave falls outside the policy accounting year",
                        event.event_id,
                    )
                hourly[(a.person_id, a.employer_id, year)] += (
                    amounts[key] - discharged[key]
                )
            if (
                event.interval
                and duties
                and any(
                    d.person_id == a.person_id
                    and duty_employers.get(d.duty_id) == a.employer_id
                    and any(w.overlaps(event.interval) for w in d.work)
                    for d in duties
                )
            ):
                fail("Work overlaps unreleased leave", event.event_id)
    daily_leave: dict[tuple[str, str, date], Fraction] = defaultdict(Fraction)
    for event in live:
        owner = accounts[event.account_id]
        daily_leave[(owner.person_id, owner.employer_id, event.effective_on)] += (
            amounts[event.event_id] - discharged[event.event_id]
        )
    for (person, employer, day), amount in daily_leave.items():
        if amount > 1:
            fail(
                "Leave exceeds one equivalent workday for the same employer/date",
                f"{person}/{employer}/{day}",
            )
    for i, event in enumerate(live):
        for other in live[i + 1 :]:
            a, b = accounts[event.account_id], accounts[other.account_id]
            if (
                (a.person_id, a.employer_id) == (b.person_id, b.employer_id)
                and event.interval
                and other.interval
                and event.interval.overlaps(other.interval)
            ):
                fail(
                    "Live leave intervals overlap within the same employer",
                    event.event_id,
                )
    for p in policies.values():
        if (
            hourly[(p.person_id, p.employer_id, p.hourly_year_start)]
            > p.hourly_cap_days
        ):
            fail("Hourly annual-leave yearly cap exceeded", p.policy_id)
    obligations = []
    obligation_calculations = []
    for obligation in snapshot.leave_obligations:
        grants = [accounts.get(g) for g in obligation.qualifying_grant_ids]
        if (
            not grants
            or any(
                g is None
                or (g.person_id, g.employer_id)
                != (obligation.person_id, obligation.employer_id)
                for g in grants
            )
            or sum(g.statutory_days for g in grants if g) < 10
            or obligation.start >= obligation.end
            or not verified(
                obligation.evidence, datetime.combine(obligation.start, time(), JST)
            )
        ):
            fail(
                "Obligation eligibility/window unverified",
                obligation.obligation_id,
                "unverified",
            )
            continue
        credit_start = obligation.start
        if hasattr(obligation, "method"):
            from shift_scheduler.validation.leave_obligations import obligation_window

            try:
                _, credit_start, calculation = obligation_window(
                    cast(
                        "LeaveObligationV3", obligation
                    ),  # only V3 obligations have a method
                    [g for g in grants if g],  # None was refused above
                    datetime.combine(obligation.end, time(), JST),
                )
                obligation_calculations.append(
                    {"obligation_id": obligation.obligation_id, **calculation}
                )
            except ValueError as error:
                fail(str(error), obligation.obligation_id, "unverified")
                continue
        else:
            months = (
                (obligation.end.year - obligation.start.year) * 12
                + obligation.end.month
                - obligation.start.month
            )
            if (
                months < 12
                or months > 24
                or month_boundary(obligation.start, months) != obligation.end
            ):
                fail(
                    "Obligation window requires independently checked nonstandard proration",
                    obligation.obligation_id,
                    "unsupported",
                )
                continue
            minimum_half_days = math.ceil(Fraction(months * 10, 12))
            if obligation.required_half_days < minimum_half_days:
                fail(
                    "Five-day obligation cannot be reduced below the verified window's statutory minimum",
                    obligation.obligation_id,
                )
                continue
        taken = Fraction(0)
        for event in live:
            a = accounts[event.account_id]
            if (
                event.kind == "take"
                and event.unit != "hour"
                and a.person_id == obligation.person_id
                and a.employer_id == obligation.employer_id
                and credit_start <= event.effective_on < obligation.end
                and (
                    event.effective_on >= obligation.start
                    or event.account_id in obligation.qualifying_grant_ids
                )
                and event.effective_on <= as_of
            ):
                taken += (amounts[event.event_id] - discharged[event.event_id]) * 2
        required = obligation.required_half_days
        obligations.append(
            {
                "obligation_id": obligation.obligation_id,
                "person_id": obligation.person_id,
                "required_half_days": required,
                "taken_half_days": int(taken),
                "status": (
                    "fulfilled"
                    if taken >= required
                    else "overdue" if as_of >= obligation.end else "at_risk"
                ),
                "remaining_half_days": max(0, required - int(taken)),
                "end": obligation.end.isoformat(),
            }
        )
    # Unclassified qualifying grants must never silently disappear from five-day monitoring.
    classified = {g for o in snapshot.leave_obligations for g in o.qualifying_grant_ids}
    cycles: dict[tuple[str, str, str], list[Any]] = defaultdict(list)
    for a in accounts.values():
        if a.grant_cycle_id:
            cycles[(a.person_id, a.employer_id, a.grant_cycle_id)].append(a)
    for members in cycles.values():
        if sum(a.statutory_days for a in members) >= 10 and any(
            a.account_id not in classified for a in members
        ):
            fail(
                "Split qualifying grant cycle lacks a consolidated obligation window",
                members[0].account_id,
                "unverified",
            )
    for a in accounts.values():
        if a.statutory_days >= 10 and a.account_id not in classified:
            fail(
                "Qualifying grant lacks a verified obligation window",
                a.account_id,
                "unverified",
            )
    for i, window in enumerate(snapshot.leave_obligations):
        for other_window in snapshot.leave_obligations[i + 1 :]:
            if (
                (window.person_id, window.employer_id)
                == (other_window.person_id, other_window.employer_id)
                and window.start < other_window.end
                and other_window.start < window.end
                and not (
                    getattr(window, "method", None) == "separate"
                    and getattr(other_window, "method", None) == "separate"
                    and set(window.qualifying_grant_ids).isdisjoint(
                        other_window.qualifying_grant_ids
                    )
                )
            ):
                fail(
                    "Overlapping obligation windows require a consolidated verified window",
                    window.obligation_id,
                    "unverified",
                )
    return {
        "as_of": as_of.isoformat(),
        "balance_basis": "all_events_in_fixed_snapshot; as_of controls grant availability and obligation status",
        "input_hash": snapshot.input_hash,
        "rule_revision": snapshot.rule_revision,
        "balances": [
            {
                "account_id": key,
                "remaining_days": _fraction(value),
                "reserved_days": _fraction(reservations[key]),
                "unreserved_days": _fraction(value - reservations[key]),
                "available_days": (
                    _fraction(value - reservations[key])
                    if accounts[key].granted_on <= as_of < accounts[key].expires_on
                    else _fraction(Fraction(0))
                ),
                "availability_status": (
                    "not_yet_granted"
                    if as_of < accounts[key].granted_on
                    else "expired" if as_of >= accounts[key].expires_on else "active"
                ),
                "person_id": accounts[key].person_id,
                "expired": as_of >= accounts[key].expires_on,
            }
            for key, value in remaining.items()
        ],
        "obligations": obligations,
        "obligation_calculations": obligation_calculations,
        "conversion_trace": trace,
        "findings": findings,
        "live_intervals": [
            {
                "person_id": accounts[e.account_id].person_id,
                "employer_id": accounts[e.account_id].employer_id,
                "interval": e.interval.model_dump(mode="json"),
            }
            for e in live
            if e.interval
        ],
    }


def account_leave(
    snapshot: SolverSnapshotV2,
    as_of: date,
    duties: list[Duty] | None = None,
    *,
    effective_at: date | None = None,
    known_at: datetime | None = None,
) -> dict[str, Any]:
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

    if not isinstance(snapshot, SolverSnapshotV3):
        if effective_at is not None or known_at is not None:
            raise ValueError("Historical ledger queries require V3 recording evidence")
        return _account_leave(snapshot, as_of, duties)
    from shift_scheduler.validation.leave_history import project_ledger

    projected, findings, amendments = project_ledger(snapshot, effective_at, known_at)
    result = _account_leave(
        projected,
        as_of,
        duties,
        grant_changes=[c for c in amendments if "corrected_days" in c],
    )
    result["input_hash"] = snapshot.input_hash
    result["balance_basis"] = (
        "effective_and_recorded_time"
        if effective_at or known_at
        else "all_events_with_grant_amendments"
    )
    result["effective_at"] = effective_at.isoformat() if effective_at else None
    result["known_at"] = known_at.isoformat() if known_at else None
    result["amendment_trace"] = amendments
    result["findings"] = findings + result["findings"]
    result["requires_hr_reconciliation"] = any(
        r["unreserved_days"]["numerator"] < 0 for r in result["balances"]
    ) or bool(result["findings"])
    return result


def two_years_after(granted_on: date) -> date:
    """First day on which statutory leave may expire (exclusive end date)."""
    try:
        return granted_on.replace(year=granted_on.year + 2)
    except ValueError:  # 29 February
        return date(granted_on.year + 2, 3, 1)
