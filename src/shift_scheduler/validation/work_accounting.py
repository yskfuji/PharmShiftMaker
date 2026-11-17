"""Independent, explainable general-regime accounting (MHLW 0901-3, sections 3-5)."""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from shift_scheduler.domain.compliance import SolverSnapshotV2
from shift_scheduler.domain.compliance_v3 import period_end
from shift_scheduler.domain.planning import Duty, Finding, FindingStatus, Interval

JST = ZoneInfo("Asia/Tokyo")


def same_establishment(left: Any, right: Any) -> bool:
    """V2 remains employer-scoped; V3 never infers a site from an employer."""
    return left.employer_id == right.employer_id and getattr(
        left, "establishment_id", None
    ) == getattr(right, "establishment_id", None)


def month_boundary(anchor: date, offset: int) -> date:
    index = anchor.year * 12 + anchor.month - 1 + offset
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(anchor.day, calendar.monthrange(year, month)[1]))


def month_index(anchor: date, day: date) -> int:
    index = (day.year - anchor.year) * 12 + day.month - anchor.month
    return index - int(day < month_boundary(anchor, index))


def variable_period(anchor: date, days: int | None, day: date) -> tuple[date, date]:
    """The variable period containing `day` (Art. 32-2: any period of up to one month).

    Calendar months from the anchor day when no length is given, otherwise
    consecutive periods of `days` days counted from the anchor (e.g. four weeks).
    """
    if days is None:
        index = month_index(anchor, day)
        return month_boundary(anchor, index), month_boundary(anchor, index + 1)
    begin = anchor + timedelta(days=days * ((day - anchor).days // days))
    return begin, begin + timedelta(days=days)


def verified(evidence: Any, until: datetime) -> bool:
    return bool(
        evidence
        and evidence.status == "verified"
        and evidence.verified_by
        and (evidence.valid_until is None or evidence.valid_until >= until)
    )


def input_findings(snapshot: SolverSnapshotV2) -> list[Finding]:
    result = []

    def fail(
        message: str, state: Literal["violation", "unverified"] = "unverified"
    ) -> None:
        result.append(Finding(rule_id="work.v2.input", status=state, message=message))

    for e in snapshot.employments:
        if (
            not verified(e.declaration, min(e.end, snapshot.horizon.end))
            or not e.calendar_confirmed
        ):
            fail(
                f"Employment declaration or holiday calendar unverified: {e.revision_id}"
            )
        if (
            e.activity == "employment"
            and e.holiday_system == "four_week"
            and e.four_week_start
        ):
            # At least four statutory holidays in every four-week window counted from
            # the start day that overlaps the planned period and lookahead. The
            # designation is data of its own, so windows reaching outside the context
            # are still judged on the listed dates.
            if e.four_week_start > e.start.astimezone(JST).date():
                fail(
                    f"Flexible holiday start day is after the employment start: {e.revision_id}"
                )
            first_day = max(e.start, snapshot.period.start).astimezone(JST).date()
            last = min(e.end, snapshot.horizon.end).astimezone(JST).date()
            window = e.four_week_start + timedelta(
                days=28 * ((first_day - e.four_week_start).days // 28)
            )
            while window < last:
                if (
                    sum(
                        window <= day < window + timedelta(days=28)
                        for day in e.statutory_holidays
                    )
                    < 4
                ):
                    fail(
                        f"Fewer than four statutory holidays in the four weeks from {window}: {e.revision_id}"
                    )
                    break
                window += timedelta(days=28)
        elif e.activity == "employment":
            first_day = max(e.start, snapshot.context.start).astimezone(JST).date()
            last = min(e.end, snapshot.context.end).astimezone(JST).date()
            week = first_day + timedelta(days=(e.week_start - first_day.weekday()) % 7)
            while week + timedelta(days=7) <= last:
                if not any(
                    week <= day < week + timedelta(days=7)
                    for day in e.statutory_holidays
                ):
                    fail(
                        f"Employer weekly statutory holiday designation missing: {e.revision_id} {week}"
                    )
                    break
                week += timedelta(days=7)
        if e.agreement_id and not any(
            a.agreement_id == e.agreement_id and same_establishment(a, e)
            for a in snapshot.agreements
        ):
            fail(f"Missing employer-specific agreement: {e.revision_id}")
        if e.working_time_system == "monthly_variable" and not verified(
            e.variable_evidence, min(e.end, snapshot.horizon.end)
        ):
            fail(f"Monthly variable hours evidence unverified: {e.revision_id}")
        if e.working_time_system == "monthly_variable" and e.variable_anchor:
            # The schedule of a whole variable period is fixed before it starts, and
            # its frame covers every day of it: the checked context must start at the
            # first period's start and the horizon must reach the last period's end.
            anchor, length = e.variable_anchor, e.variable_period_days
            first_period = variable_period(
                anchor, length, snapshot.period.start.astimezone(JST).date()
            )[0]
            last_day = (
                (snapshot.period.end - timedelta(seconds=1)).astimezone(JST).date()
            )
            last_period_end = variable_period(anchor, length, last_day)[1]
            if (
                snapshot.context.start.astimezone(JST).date() > first_period
                or snapshot.horizon.end.astimezone(JST).date() < last_period_end
            ):
                fail(
                    f"Monthly variable period {first_period}..{last_period_end} is not fully covered "
                    f"by the input: {e.revision_id}"
                )
        if e.working_time_system == "annual_variable" and e.overlaps(snapshot.horizon):
            cal = next(
                (
                    c
                    for c in getattr(snapshot, "annual_calendars", ())
                    if c.calendar_id == e.annual_calendar_id
                ),
                None,
            )
            if cal is None:
                result.append(
                    Finding(
                        rule_id="work.v2.input",
                        status="unsupported",
                        message=(
                            f"One-year variable working hours need version-3 inputs with their calendar: {e.revision_id}"
                        ),
                    )
                )
            else:
                until = min(e.end, snapshot.horizon.end)
                if not verified(cal.evidence, until) or any(
                    s.fixed_on is not None and not verified(s.consent, until)
                    for s in cal.segments
                ):
                    fail(
                        f"One-year variable calendar agreement or segment consent unverified: {cal.calendar_id}"
                    )
                if any(day in cal.scheduled() for day in e.statutory_holidays):
                    fail(
                        f"One-year variable calendar schedules work on a statutory holiday: {e.revision_id}",
                        "violation",
                    )
                # Every planned date must be fixed day by day, and the input must hold the
                # work since the period began (its frame counts from the first day).
                plan_first = max(e.start, snapshot.period.start).astimezone(JST).date()
                plan_last = (
                    (min(e.end, snapshot.period.end) - timedelta(seconds=1))
                    .astimezone(JST)
                    .date()
                )
                if plan_first <= plan_last and not (
                    cal.start <= plan_first and plan_last < cal.fixed_end
                ):
                    fail(
                        f"Planned dates {plan_first}..{plan_last} are outside the fixed part of the one-year calendar "
                        f"{cal.calendar_id}"
                    )
                if snapshot.context.start.astimezone(JST).date() > cal.start:
                    fail(
                        f"The one-year period from {cal.start} is not fully in the input: {e.revision_id}"
                    )
        if e.working_time_system == "flex" and e.overlaps(snapshot.horizon):
            assert (
                e.flex_anchor is not None and e.flex_months is not None
            )  # Employment validator
            if not verified(e.variable_evidence, min(e.end, snapshot.horizon.end)):
                fail(f"Flextime work rules or agreement unverified: {e.revision_id}")
            # The settlement counts every hour from the period's first day.
            period_day = max(e.start, snapshot.period.start).astimezone(JST).date()
            settlement_start = flex_period(e.flex_anchor, e.flex_months, period_day)[0]
            if snapshot.context.start.astimezone(JST).date() > max(
                settlement_start, e.start.astimezone(JST).date()
            ):
                fail(
                    f"The flextime settlement period from {settlement_start} is not fully in the input: "
                    f"{e.revision_id}"
                )
            _flex_adoption_findings(snapshot, e, fail)
    for c in snapshot.contracts:
        if (
            c.regime == "flex"
            and c.period_min_seconds > 0
            and c.overlaps(snapshot.horizon)
        ):
            # No timed duty is assigned under flextime, so a planned minimum cannot be met.
            fail(
                f"A flextime contract cannot require planned minimum hours: {c.revision_id}",
                "violation",
            )
    checked_calendars = {
        e.annual_calendar_id
        for e in snapshot.employments
        if e.annual_calendar_id and e.overlaps(snapshot.horizon)
    }
    for cal in getattr(snapshot, "annual_calendars", ()):
        if cal.calendar_id in checked_calendars:
            for problem in annual_calendar_problems(cal):
                fail(
                    f"One-year variable calendar {cal.calendar_id}: {problem}; the arrangement does not apply",
                    "violation",
                )
    for a in snapshot.agreements:
        if not verified(a.evidence, min(a.end, snapshot.horizon.end)):
            fail(f"Agreement evidence missing: {a.agreement_id}")
        if a.special_clause and not verified(
            a.invocation_evidence, min(a.end, snapshot.horizon.end)
        ):
            fail(f"Special clause invocation missing: {a.agreement_id}")
        if a.special_clause and a.monthly_limit_seconds >= 100 * 3600:
            fail(
                f"Special-clause monthly limit must be below 100h: {a.agreement_id}",
                "violation",
            )
        needed = min(
            a.year_start,
            month_boundary(
                a.month_anchor,
                month_index(
                    a.month_anchor, snapshot.period.start.astimezone(JST).date()
                )
                - 5,
            ),
        )
        if snapshot.context.start.astimezone(JST).date() > needed:
            fail(f"Agreement-year/rolling-six-month history missing: {a.agreement_id}")
    for p in snapshot.people:
        own = [
            e
            for e in snapshot.employments
            if e.person_id == p.person_id and e.activity == "employment"
        ]
        if any(e.contract_order is None for e in own):
            fail(f"Contract order is unconfirmed: {p.person_id}")
        for i, first in enumerate(own):
            for b in own[i + 1 :]:
                if (
                    first.overlaps(b)
                    and first.employer_id != b.employer_id
                    and first.contract_order == b.contract_order
                ):
                    fail(f"Contract order is ambiguous: {p.person_id}")
                if first.overlaps(b) and first.method != b.method:
                    fail(
                        f"Mixed accounting methods need a verified transition: {p.person_id}"
                    )
    relationships = defaultdict(list)
    for e in snapshot.employments:
        relationships[(e.person_id, e.relationship_id)].append(e)
    for revisions in relationships.values():
        ordered = sorted(revisions, key=lambda e: (e.start, e.end))
        for before, after in zip(ordered, ordered[1:], strict=False):
            if (before.week_start, before.method) == (after.week_start, after.method):
                continue
            reviewed = [
                t
                for t in getattr(snapshot, "accounting_transitions", ())
                if (t.before_revision_id, t.after_revision_id)
                == (before.revision_id, after.revision_id)
                and verified(t.evidence, min(after.end, snapshot.horizon.end))
            ]
            if len(reviewed) != 1 or before.end != after.start:
                fail(
                    f"Accounting change needs an effective, reviewed transition: {after.revision_id}"
                )
            elif (
                before.week_start != after.week_start
                and reviewed[0].calculation_basis != "preserve_overlapping_full_weeks"
            ):
                fail(
                    f"Week-origin transition must preserve overlapping full weeks: {after.revision_id}"
                )
    for m in snapshot.management_models:
        active = [
            e
            for e in snapshot.employments
            if e.person_id == m.person_id
            and e.activity == "employment"
            and e.overlaps(m)
        ]
        first_orders = {
            e.contract_order
            for e in active
            if e.employer_id == m.first_employer and e.contract_order is not None
        }
        second_orders = {
            e.contract_order
            for e in active
            if e.employer_id == m.second_employer and e.contract_order is not None
        }
        if (
            len(first_orders) != 1
            or len(second_orders) != 1
            or not max(first_orders, default=0) < min(second_orders, default=0)
        ):
            fail(
                f"Management A/B identities do not match confirmed contract order: {m.model_id}"
            )
        if not all(
            verified(e, min(m.end, snapshot.horizon.end))
            for e in (m.first_consent, m.second_consent, m.notification)
        ):
            fail(f"Management-model consent/notification missing: {m.model_id}")
        if m.first_month_limit_seconds + m.second_month_limit_seconds >= 100 * 3600:
            fail(
                f"Management-model combined monthly limit must be below 100h: {m.model_id}"
            )
        # The model must also keep a multi-month average of 80h or less
        # (基発0901第3号). With the same limits every month, that holds only
        # when the combined monthly limit is 80h or less.
        elif m.first_month_limit_seconds + m.second_month_limit_seconds > 80 * 3600:
            fail(
                f"Management-model combined monthly limit must keep the multi-month average within 80h: {m.model_id}"
            )
    return result


def _pieces(snapshot: SolverSnapshotV2, duties: list[Duty]) -> list[dict[str, Any]]:
    terms = {t.duty_id: t for t in snapshot.work_terms}
    employment = {e.revision_id: e for e in snapshot.employments}
    rows: list[dict[str, Any]] = []
    for d in duties:
        term = terms[d.duty_id]
        revisions = [
            employment[key]
            for key in (term.employment_revision_ids or (term.employment_revision_id,))
        ]
        for work in d.work:
            points = {work.start, work.end}
            for revision in revisions:
                if work.start < revision.start < work.end:
                    points.add(revision.start)
                if work.start < revision.end < work.end:
                    points.add(revision.end)
            for s in term.scheduled_work:
                if s.overlaps(work):
                    points.update((max(s.start, work.start), min(s.end, work.end)))
            midnight = datetime.combine(
                work.start.astimezone(JST).date() + timedelta(days=1), time(), JST
            )
            while midnight < work.end:
                points.add(midnight)
                midnight += timedelta(days=1)
            ordered = sorted(points)
            for start, end in zip(ordered, ordered[1:], strict=False):
                interval = Interval(start=start, end=end)
                e = next(e for e in revisions if e.contains(interval))
                rows.append(
                    {
                        "duty_id": d.duty_id,
                        "employment": e,
                        "start": start,
                        "end": end,
                        "day": d.start.astimezone(JST).date(),
                        "calendar_day": start.astimezone(JST).date(),
                        "seconds": interval.seconds,
                        "scheduled": any(
                            s.contains(interval) for s in term.scheduled_work
                        ),
                        "holiday": start.astimezone(JST).date() in e.statutory_holidays,
                        "source": d.source,
                    }
                )
    return rows


@dataclass(frozen=True)
class OutsideEmployment:
    """Another employer's work taken from a REVIEWED outside declaration.

    Only the fields the attribution needs. The other employer applies its own 36
    agreement to its own overtime (基発0901第3号); here the hours only count in the
    person's combined totals and in contract-order attribution.
    """

    revision_id: str
    relationship_id: str
    person_id: str
    employer_id: str
    establishment_id: str
    contract_order: int
    week_start: int
    start: datetime
    end: datetime
    activity: str = "employment"
    method: str = "standard"
    agreement_id: str | None = None
    statutory_holidays: tuple[date, ...] = ()


def _variable_schedules(
    rows: list[dict[str, Any]], anchor: date, days: int | None = None
) -> dict[tuple[date, date], int]:
    """Scheduled seconds per variable period (the schedule must fit the frame)."""
    totals: dict[tuple[date, date], int] = defaultdict(int)
    for r in rows:
        if r["scheduled"] and not r["holiday"]:
            totals[variable_period(anchor, days, r["day"])] += r["seconds"]
    return totals


def _usable_declaration(snapshot: SolverSnapshotV2, d: Any) -> bool:
    return (
        d.status == "REVIEWED"
        and d.activity == "employment"
        and d.contract_order is not None
        and verified(d.review_evidence, min(d.end, snapshot.horizon.end))
    )


def _outside_rows(
    snapshot: SolverSnapshotV2, person_id: str, week_start: int
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for d in getattr(snapshot, "outside_declarations", ()):
        if (
            d.person_id != person_id
            or not d.overlaps(snapshot.context)
            or not _usable_declaration(snapshot, d)
        ):
            continue
        e = OutsideEmployment(
            revision_id="outside:" + d.declaration_id,
            relationship_id="outside:" + d.declaration_id,
            person_id=d.person_id,
            employer_id=d.employer_id,
            establishment_id=d.establishment_id,
            contract_order=d.contract_order,
            week_start=week_start,
            start=d.start,
            end=d.end,
        )
        # The other employer's statutory-holiday work counts as its work beyond the schedule.
        for scheduled, pieces in (
            (True, d.scheduled_work),
            (False, (*d.additional_work, *d.other_holiday_work)),
        ):
            for piece in pieces:
                points = {piece.start, piece.end}
                midnight = datetime.combine(
                    piece.start.astimezone(JST).date() + timedelta(days=1), time(), JST
                )
                while midnight < piece.end:
                    points.add(midnight)
                    midnight += timedelta(days=1)
                ordered = sorted(points)
                for start, end in zip(ordered, ordered[1:], strict=False):
                    rows.append(
                        {
                            "duty_id": f"outside:{d.declaration_id}:{piece.start.isoformat()}",
                            "employment": e,
                            "start": start,
                            "end": end,
                            # A continuous piece belongs to the day it started (昭63.1.1基発1号).
                            "day": piece.start.astimezone(JST).date(),
                            "calendar_day": start.astimezone(JST).date(),
                            "seconds": int((end - start).total_seconds()),
                            "scheduled": scheduled,
                            "holiday": False,
                        }
                    )
    return rows


def _allocate_variable(
    rows: list[dict[str, Any]],
    week_start: int,
    anchor: date,
    length: int | None = None,
    scheduled_first: bool = False,
) -> list[dict[str, Any]]:
    """One-month variable working hours (Art. 32-2; 昭63.1.1基発1号), one employer.

    Overtime, in the order the work happened (with `scheduled_first`, scheduled
    portions before extras: the other reading for the sites of one employer):
    - day: beyond the scheduled hours when they exceed 8h, otherwise beyond 8h;
    - week (weeks cut at period boundaries): beyond the scheduled hours when they
      exceed 40h, otherwise beyond 40h, excluding what the day already counted;
    - period: beyond the legal frame 40h x calendar days / 7 (whole seconds,
      rounded down, so the frame is never overstated), excluding the above.
    """

    def period_of(day: date) -> tuple[date, date]:
        return variable_period(anchor, length, day)

    def week_of(day: date) -> tuple[date, date]:
        begin = day - timedelta(days=(day.weekday() - week_start) % 7)
        return max(begin, period_of(day)[0]), period_of(day)[0]

    scheduled_day: dict[date, int] = defaultdict(int)
    scheduled_week: dict[tuple[date, date], int] = defaultdict(int)
    for r in rows:
        if r["scheduled"] and not r["holiday"]:
            scheduled_day[r["day"]] += r["seconds"]
            scheduled_week[week_of(r["day"])] += r["seconds"]
    days: dict[date, int] = defaultdict(int)
    weeks: dict[tuple[date, date], int] = defaultdict(int)
    periods: dict[date, int] = defaultdict(int)
    result = []
    order = sorted(
        rows,
        key=lambda r: (
            0 if scheduled_first and r["scheduled"] else 1 if scheduled_first else 0,
            r["start"],
            r["duty_id"],
        ),
    )
    for row in order:
        day, seconds = row["day"], row["seconds"]
        daily = weekly = period = 0
        if not row["holiday"]:
            day_limit = max(28800, scheduled_day[day])
            daily = max(0, days[day] + seconds - day_limit) - max(
                0, days[day] - day_limit
            )
            days[day] += seconds
            ordinary = seconds - daily
            week = week_of(day)
            week_limit = max(144000, scheduled_week[week])
            weekly = max(0, weeks[week] + ordinary - week_limit) - max(
                0, weeks[week] - week_limit
            )
            weeks[week] += ordinary
            remainder = ordinary - weekly
            begin, end = period_of(day)
            frame = 144000 * (end - begin).days // 7
            period = max(0, periods[begin] + remainder - frame) - max(
                0, periods[begin] - frame
            )
            periods[begin] += remainder
        result.append(
            {
                **row,
                "daily_overtime": daily,
                "weekly_overtime": weekly,
                "period_overtime": period,
                "overtime": daily + weekly + period,
                "holiday_seconds": seconds if row["holiday"] else 0,
            }
        )
    return result


def _add_months(day: date, months: int) -> date:
    """Same day `months` later, clamped to the month's last day (settlement months
    counted from a flextime anchor; the calendars use period_end)."""
    year, month = divmod(day.month - 1 + months, 12)
    year, month = day.year + year, month + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def annual_calendar_problems(cal: Any) -> list[str]:
    """Statutory limits of an agreed one-year calendar (Art. 32-4(3), Regulations Art. 12-4).

    Checked on the fixed parts day by day, and on the open segments by their agreed
    working days and total hours. Weeks are counted from the calendar's week start
    and cut at the period's ends; a week that reaches an open segment is checked on
    its fixed days only (the rest is checked when the segment is fixed).
    """
    problems: list[str] = []
    scheduled = cal.scheduled()
    open_segments = [s for s in cal.segments if s.fixed_on is None]
    days = cal.calendar_days
    longer_than_three_months = cal.end > period_end(cal.start, 3)
    for day, seconds in sorted(scheduled.items()):
        if seconds > 10 * 3600:
            problems.append(f"More than 10 hours scheduled on {day}")
    for segment in open_segments:
        if (
            segment.working_days > (segment.end - segment.start).days
            or segment.total_seconds > segment.working_days * 10 * 3600
        ):
            problems.append(
                f"Open segment from {segment.start} cannot hold its agreed days and hours"
            )
    total = sum(scheduled.values()) + sum(s.total_seconds for s in open_segments)
    if total > 144000 * days // 7:
        problems.append(
            "Scheduled hours exceed the frame of 40 hours a week on average"
        )
    if longer_than_three_months:
        # 280 days a year; for shorter periods 280 x days / 365 rounded down. A
        # one-year period has 280 days also in a leap year (平11.1.29基発45号).
        limit = 280 if cal.end == period_end(cal.start, 12) else 280 * days // 365
        if len(scheduled) + sum(s.working_days for s in open_segments) > limit:
            problems.append(f"More than {limit} working days in the period")
    week = cal.start - timedelta(days=(cal.start.weekday() - cal.week_start) % 7)
    heavy: list[date] = []
    run = 0
    while week < cal.fixed_end:
        first = max(week, cal.start)
        hours = sum(
            scheduled.get(first + timedelta(days=i), 0)
            for i in range((min(week + timedelta(days=7), cal.fixed_end) - first).days)
        )
        if hours > 52 * 3600:
            problems.append(f"More than 52 hours scheduled in the week from {first}")
        if longer_than_three_months:
            if hours > 48 * 3600:
                run += 1
                heavy.append(first)
                if run > 3:
                    problems.append(
                        f"More than three consecutive weeks above 48 hours up to {first}"
                    )
            else:
                run = 0
        week += timedelta(days=7)
    if longer_than_three_months:
        # Each three months from the start: at most three weeks above 48 hours,
        # counted in the division where the week begins (平11.1.29基発45号).
        division = 0
        while period_end(cal.start, 3 * division) < cal.end:
            begin, end = period_end(cal.start, 3 * division), period_end(
                cal.start, 3 * (division + 1)
            )
            if sum(begin <= w < end for w in heavy) > 3:
                problems.append(
                    f"More than three weeks above 48 hours in the three months from {begin}"
                )
            division += 1
    for special_period in cal.special_periods:
        # 則12条の4第5項: in a special period one rest day is kept in every week.
        week = special_period.start - timedelta(
            days=(special_period.start.weekday() - cal.week_start) % 7
        )
        while week < min(special_period.end, cal.fixed_end):
            span = [
                week + timedelta(days=i)
                for i in range(7)
                if cal.start <= week + timedelta(days=i) < min(cal.end, cal.fixed_end)
            ]
            if span and all(day in scheduled for day in span) and len(span) == 7:
                problems.append(
                    f"No rest day in the week from {week} of a special period"
                )
            week += timedelta(days=7)
    streak: list[date] = []
    for offset in range((cal.fixed_end - cal.start).days + 1):
        day = cal.start + timedelta(days=offset)
        if day in scheduled:
            streak.append(day)
            continue
        if streak:
            special = any(
                p.start <= streak[0] and streak[-1] < p.end for p in cal.special_periods
            )
            # Special periods: one rest day a week, so at most 12 days in a row.
            if len(streak) > (12 if special else 6):
                problems.append(
                    f"{len(streak)} consecutive working days from {streak[0]}"
                )
        streak = []
    return problems


def _allocate_annual(
    rows: list[dict[str, Any]],
    calendars: list[Any],
    week_start: int,
    scheduled_first: bool = False,
) -> list[dict[str, Any]]:
    """One-year variable working hours (Art. 32-4; 平6.1.4基発1号), in the order worked.

    - day: beyond the calendar's hours when they exceed 8h, otherwise beyond 8h;
    - week (cut at the period's ends): beyond the calendar's week when it exceeds
      40h, otherwise beyond 40h, excluding what the day already counted;
    - period: beyond 40h x calendar days / 7 (rounded down to whole seconds),
      excluding the above.
    Cutting weeks at the period's ends has no official statement; it mirrors the
    one-month arrangement and is recorded as an interpretation.
    """

    def calendar_of(day: date) -> Any:
        return next(c for c in calendars if c.start <= day < c.end)

    def week_of(day: date) -> tuple[date, date]:
        c = calendar_of(day)
        begin = day - timedelta(days=(day.weekday() - week_start) % 7)
        return max(begin, c.start), min(begin + timedelta(days=7), c.end)

    scheduled = {
        day: seconds for c in calendars for day, seconds in c.scheduled().items()
    }
    days: dict[date, int] = defaultdict(int)
    weeks: dict[tuple[date, date], int] = defaultdict(int)
    periods: dict[date, int] = defaultdict(int)
    result = []
    order = sorted(
        rows,
        key=lambda r: (
            0 if scheduled_first and r["scheduled"] else 1 if scheduled_first else 0,
            r["start"],
            r["duty_id"],
        ),
    )
    for row in order:
        day, seconds = row["day"], row["seconds"]
        daily = weekly = period = 0
        if not row["holiday"]:
            day_limit = max(28800, scheduled.get(day, 0))
            daily = max(0, days[day] + seconds - day_limit) - max(
                0, days[day] - day_limit
            )
            days[day] += seconds
            ordinary = seconds - daily
            week = week_of(day)
            week_scheduled = sum(
                scheduled.get(week[0] + timedelta(days=i), 0)
                for i in range((week[1] - week[0]).days)
            )
            week_limit = max(144000, week_scheduled)
            weekly = max(0, weeks[week] + ordinary - week_limit) - max(
                0, weeks[week] - week_limit
            )
            weeks[week] += ordinary
            remainder = ordinary - weekly
            c = calendar_of(day)
            frame = 144000 * c.calendar_days // 7
            period = max(0, periods[c.start] + remainder - frame) - max(
                0, periods[c.start] - frame
            )
            periods[c.start] += remainder
        result.append(
            {
                **row,
                "daily_overtime": daily,
                "weekly_overtime": weekly,
                "period_overtime": period,
                "overtime": daily + weekly + period,
                "holiday_seconds": seconds if row["holiday"] else 0,
            }
        )
    return result


def flex_cuts(anchor: date, months: int, day: date) -> list[date]:
    """Month boundaries of the settlement period containing the day, counted from
    the anchor (so a 31st anchor gives Apr 30, May 31, Jun 30, Jul 31)."""
    k = ((day.year - anchor.year) * 12 + day.month - anchor.month) // months
    while _add_months(anchor, k * months) > day:
        k -= 1
    while _add_months(anchor, (k + 1) * months) <= day:
        k += 1
    return [_add_months(anchor, k * months + i) for i in range(months + 1)]


def flex_period(anchor: date, months: int, day: date) -> tuple[date, date]:
    """The settlement period (`months` months from the anchor) that contains the day."""
    cuts = flex_cuts(anchor, months, day)
    return cuts[0], cuts[-1]


def flex_frame(e: Any, begin: date, end: date) -> int:
    """Settlement frame: 40h x days / 7, or 8h x scheduled days under the full
    two-day weekend rule (Art. 32-3(3)); whole seconds, rounded down."""
    if not e.flex_full_two_day_weekend:
        return 144000 * (end - begin).days // 7
    rest = set(e.flex_other_rest_days) | set(e.statutory_holidays)
    days = sum(
        1
        for i in range((end - begin).days)
        if (begin + timedelta(days=i)).weekday() not in e.flex_rest_weekdays
        and begin + timedelta(days=i) not in rest
    )
    return 8 * 3600 * days


def _allocate_flex(
    rows: list[dict[str, Any]], e: Any
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Flextime settled from the work done (Art. 32-3; 平30.9.7基発0907第1号 第1の7).

    Up to one month: the hours beyond the frame. Longer settlement periods, each
    month from the start (the last may be shorter): (a) hours beyond 50h x days / 7
    are that month's overtime; (b) the hours beyond the frame less (a) are added to
    the final month. Statutory holiday work is counted apart. There is no daily or
    weekly stage. Returns the rows and a summary per settlement period.
    """
    assert (
        e.flex_anchor is not None and e.flex_months is not None
    )  # Employment validator
    anchor, months = e.flex_anchor, e.flex_months
    months_cum: dict[date, int] = defaultdict(int)
    ordinary_cum: dict[date, int] = defaultdict(int)
    attributed: dict[date, int] = defaultdict(int)
    worked: dict[date, int] = defaultdict(int)
    monthly: dict[date, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    result = []
    for row in sorted(rows, key=lambda r: (r["start"], r["duty_id"])):
        day, seconds = row["calendar_day"], row["seconds"]
        cuts = flex_cuts(anchor, months, day)
        begin, end = cuts[0], cuts[-1]
        month_overtime = period_overtime = 0
        if not row["holiday"]:
            worked[begin] += seconds
            final_start = begin
            if months > 1:
                index = next(i for i in range(months) if day < cuts[i + 1])
                first, last = cuts[index], cuts[index + 1]
                final_start = cuts[-2]
                limit = 50 * 3600 * (last - first).days // 7
                month_overtime = max(0, months_cum[first] + seconds - limit) - max(
                    0, months_cum[first] - limit
                )
                months_cum[first] += seconds
                monthly[begin][first] += month_overtime
            ordinary_cum[begin] += seconds - month_overtime
            if day >= final_start:
                # The final month takes the whole excess so far, including what was
                # already beyond the frame before it began.
                excess = max(0, ordinary_cum[begin] - flex_frame(e, begin, end))
                period_overtime = excess - attributed[begin]
                attributed[begin] = excess
        result.append(
            {
                **row,
                "daily_overtime": 0,
                "weekly_overtime": 0,
                "period_overtime": period_overtime,
                "overtime": month_overtime + period_overtime,
                "holiday_seconds": seconds if row["holiday"] else 0,
            }
        )
    summaries = []
    for begin in sorted(worked):
        end = flex_period(anchor, months, begin)[1]
        frame = flex_frame(e, begin, end)
        excess = max(0, ordinary_cum[begin] - frame)
        summaries.append(
            {
                "start": begin.isoformat(),
                "end": end.isoformat(),
                "frame_seconds": frame,
                "worked_seconds": worked[begin],
                "monthly_overtime_seconds": {
                    k.isoformat(): v for k, v in sorted(monthly[begin].items())
                },
                "final_month_overtime_seconds": attributed[begin],
                "unattributed_seconds": excess - attributed[begin],
            }
        )
    return result, summaries


def _allocate(
    rows: list[dict[str, Any]], week_start: int, time_order: bool = False
) -> list[dict[str, Any]]:
    """Scheduled portions in contract order, then extras in occurrence order.

    Contract order ranks employers (基発0901第3号). The sites of one employer have
    no order between them, so their scheduled portions follow the time worked; the
    employer's earliest contract order ranks the whole employer. (That within-employer
    reading is an interpretation recorded for HR/legal review.)
    Weekly excess only consumes portions not already attributed to daily excess.
    With `time_order`, every portion is taken in the order worked: the other
    reading for the sites of one employer, which has no official statement either.
    """
    employer_order: dict[str, int] = {}
    for r in rows:
        e = r["employment"]
        if e.contract_order is not None:
            employer_order[e.employer_id] = min(
                e.contract_order, employer_order.get(e.employer_id, e.contract_order)
            )
    order = sorted(
        rows,
        key=lambda r: (
            (r["start"], r["duty_id"])
            if time_order
            else (
                0 if r["scheduled"] else 1,
                (
                    employer_order.get(r["employment"].employer_id, 0)
                    if r["scheduled"]
                    else 0
                ),
                r["start"],
                r["duty_id"],
            )
        ),
    )
    days: dict[date, int] = defaultdict(int)
    weeks: dict[date, int] = defaultdict(int)
    result = []
    for row in order:
        day, seconds = row["day"], row["seconds"]
        daily = weekly = 0
        if not row["holiday"]:
            daily = max(0, days[day] + seconds - 28800) - max(0, days[day] - 28800)
            days[day] += seconds
            ordinary = seconds - daily
            week = day - timedelta(days=(day.weekday() - week_start) % 7)
            weekly = max(0, weeks[week] + ordinary - 144000) - max(
                0, weeks[week] - 144000
            )
            weeks[week] += ordinary
        result.append(
            {
                **row,
                "daily_overtime": daily,
                "weekly_overtime": weekly,
                "overtime": daily + weekly,
                "holiday_seconds": seconds if row["holiday"] else 0,
            }
        )
    return result


def _site_decision(
    snapshot: SolverSnapshotV2, employer: str, rows: list[dict[str, Any]]
) -> Any:
    """The verified decision for this employer that covers all its checked work, if any."""
    if not rows:
        return None
    first, last = min(r["start"] for r in rows), max(r["end"] for r in rows)
    covering = [
        d
        for d in getattr(snapshot, "site_attribution_decisions", ())
        if d.employer_id == employer
        and d.start <= first
        and last <= d.end
        and verified(d.evidence, min(d.end, snapshot.horizon.end))
    ]
    return covering[0] if len(covering) == 1 else None


def _flex_adoption_findings(snapshot: SolverSnapshotV2, e: Any, fail: Any) -> None:
    """Flextime is off unless the facility adopted it (work rules and agreement,
    Art. 32-3; 則12条の3) and a second administrator confirmed the adoption and the
    person's enrolment. Withdrawn records count as absent."""
    until = min(e.end, snapshot.horizon.end)
    adoptions = {
        a.adoption_id: a
        for a in getattr(snapshot, "flex_adoptions", ())
        if a.status == "confirmed"
    }
    covering = []
    for n in getattr(snapshot, "flex_enrollments", ()):
        adoption = adoptions.get(n.adoption_id)
        if (
            n.status == "confirmed"
            and adoption is not None
            and n.person_id == e.person_id
            and (adoption.employer_id, adoption.establishment_id)
            == (e.employer_id, getattr(e, "establishment_id", None))
            and n.start <= e.start
            and until <= adoption.end
        ):
            covering.append(adoption)
    if not covering:
        fail(
            f"Flextime is not adopted for this person: no confirmed facility adoption and enrolment cover "
            f"{e.revision_id}"
        )
        return
    adoption = covering[0]
    agreed = (
        adoption.settlement_anchor,
        adoption.settlement_months,
        adoption.total_hours_rule == "full_two_day_weekend",
        adoption.rest_weekdays,
        adoption.other_rest_days,
    )
    if (
        e.flex_anchor,
        e.flex_months,
        e.flex_full_two_day_weekend,
        e.flex_rest_weekdays,
        e.flex_other_rest_days,
    ) != agreed:
        fail(
            f"Flextime settlement terms differ from the confirmed adoption {adoption.adoption_id}: "
            f"{e.revision_id}",
            "violation",
        )
    for evidence in (
        adoption.work_rules_evidence,
        adoption.agreement_evidence,
        *((adoption.filing.evidence,) if adoption.filing else ()),
    ):
        if not verified(evidence, until):
            fail(
                f"Flextime adoption work rules, agreement or filing unverified: {adoption.adoption_id}"
            )
            break
    if (
        adoption.filing
        and adoption.filing.filed_on > adoption.start.astimezone(JST).date()
    ):
        fail(
            f"The flextime agreement was filed after the adoption started: {adoption.adoption_id}",
            "violation",
        )


def account_work(snapshot: SolverSnapshotV2, duties: list[Duty]) -> dict[str, Any]:
    findings = input_findings(snapshot)
    rows = _pieces(snapshot, duties)
    trace: list[dict[str, Any]] = []
    agreement_totals: list[dict[str, Any]] = []
    settlements: list[dict[str, Any]] = []

    def fail(message: str, subject: str, state: FindingStatus = "violation") -> None:
        findings.append(
            Finding(
                rule_id="work.v2", status=state, message=message, subjects=(subject,)
            )
        )

    for person in snapshot.people:
        if any(
            e.person_id == person.person_id
            and e.activity == "employment"
            and e.contract_order is None
            for e in snapshot.employments
        ):
            # No guessed attribution or zero-hour substitute for an unknown order.
            continue
        own = [
            r
            for r in rows
            if r["employment"].person_id == person.person_id
            and r["employment"].activity == "employment"
        ]
        # Only declarations that overlap the checked context matter here.
        declarations = [
            d
            for d in getattr(snapshot, "outside_declarations", ())
            if d.person_id == person.person_id
            and d.status != "WITHDRAWN"
            and d.overlaps(snapshot.context)
        ]
        own_employments = [
            e
            for e in snapshot.employments
            if e.person_id == person.person_id and e.activity == "employment"
        ]
        own_employers = {e.employer_id for e in own_employments}
        for d in declarations:
            problems = []
            if d.status in {"SUBMITTED", "RETURNED"}:
                problems.append(
                    "Outside work declaration is not reviewed; combined hours are unverified"
                )
            elif d.activity != "employment":
                continue
            elif d.contract_order is None:
                problems.append(
                    "Outside employment declaration lacks the contract order"
                )
            elif not verified(d.review_evidence, min(d.end, snapshot.horizon.end)):
                problems.append(
                    "Outside declaration review has expired or is unverified"
                )
            if d.employer_id in own_employers:
                problems.append("Outside declaration names the person's own employer")
            findings.extend(
                Finding(
                    rule_id="work.v2",
                    status="unverified",
                    message=message,
                    subjects=(d.declaration_id, person.person_id),
                )
                for message in problems
            )
        # Contract order ranks employers; an equal order between employers, or one
        # employer's orders interleaving with another's, cannot be attributed safely.
        orders: dict[str, set[int]] = defaultdict(set)
        for e in own_employments:
            if e.contract_order is not None:
                orders[e.employer_id].add(e.contract_order)
        for d in declarations:
            if _usable_declaration(snapshot, d):
                orders[d.employer_id].add(d.contract_order)
        spans = sorted((min(v), max(v), k) for k, v in orders.items())
        for (_, high, first), (next_low, _, second) in zip(
            spans, spans[1:], strict=False
        ):
            if next_low <= high:
                fail(
                    f"Contract orders of {first} and {second} are equal or interleave; attribution needs review",
                    person.person_id,
                    "unverified",
                )
        if declarations and own_employments:
            # The observer's week: the person's earliest own employment.
            first_own = min(own_employments, key=lambda e: (e.start, e.revision_id))
            own += _outside_rows(snapshot, person.person_id, first_own.week_start)
        observers: dict[int, list[dict[str, Any]]] = {}
        employments_by_id = {e.revision_id: e for e in snapshot.employments}

        def transition_origins(
            observer: Any,
            row: dict[str, Any],
            employments: dict[str, Any] = employments_by_id,
            person_id: str = person.person_id,
        ) -> set[int]:
            origins = {observer.week_start}
            for transition in getattr(snapshot, "accounting_transitions", ()):
                if transition.calculation_basis != "preserve_overlapping_full_weeks":
                    continue
                before = employments[transition.before_revision_id]
                after = employments[transition.after_revision_id]
                if (
                    after.person_id != person_id
                    or after.relationship_id != observer.relationship_id
                    or before.week_start == after.week_start
                ):
                    continue
                last_old_day = (
                    (before.end - timedelta(seconds=1)).astimezone(JST).date()
                )
                old_week_start = last_old_day - timedelta(
                    days=(last_old_day.weekday() - before.week_start) % 7
                )
                old_week_end = old_week_start + timedelta(days=7)
                if (
                    before.end <= row["start"]
                    and old_week_start <= row["day"] < old_week_end
                ):
                    origins.add(before.week_start)
            return origins

        def union_allocation(
            index: dict[int, dict[tuple[str, datetime], dict[str, Any]]],
            origins: set[int],
            row: dict[str, Any],
        ) -> dict[str, Any]:
            values = [index[o][row["duty_id"], row["start"]] for o in origins]
            chosen = max(values, key=lambda allocation: allocation["weekly_overtime"])
            # Daily excess is origin-independent; weekly portions are nested
            # tails of the same remaining interval, hence max rather than sum.
            return {**chosen, "checked_week_origins": sorted(origins)}

        variable = [
            e
            for e in snapshot.employments
            if e.person_id == person.person_id
            and e.activity == "employment"
            and e.working_time_system == "monthly_variable"
        ]
        if variable:
            employers = {
                e.employer_id
                for e in snapshot.employments
                if e.person_id == person.person_id and e.activity == "employment"
            }
            anchors = {
                (e.variable_anchor, e.variable_period_days, e.week_start)
                for e in variable
            }
            if (
                len(employers) > 1
                or declarations
                or len(anchors) > 1
                or len(variable)
                != len(
                    [
                        e
                        for e in snapshot.employments
                        if e.person_id == person.person_id
                        and e.activity == "employment"
                    ]
                )
            ):
                fail(
                    "Monthly variable hours with another employer, a mixed system or several periods "
                    "are not supported",
                    person.person_id,
                    "unsupported",
                )
                continue
            ((anchor, length, variable_week),) = anchors
            assert anchor is not None  # Employment validator
            observers[variable_week] = _allocate_variable(
                own, variable_week, anchor, length
            )
            for (begin, end), total in _variable_schedules(own, anchor, length).items():
                if total > 144000 * (end - begin).days // 7:
                    # The arrangement no longer meets Art. 32-2; the 8h/40h rules apply.
                    fail(
                        f"Scheduled hours exceed the monthly variable frame from {begin}; "
                        "the variable arrangement does not apply",
                        person.person_id,
                    )
        flex = [
            e
            for e in snapshot.employments
            if e.person_id == person.person_id
            and e.activity == "employment"
            and e.working_time_system == "flex"
        ]
        if flex:
            all_employments = [
                e
                for e in snapshot.employments
                if e.person_id == person.person_id and e.activity == "employment"
            ]
            # A switch between standard hours and flextime on the first day of a
            # settlement period: the standard revisions are counted by the 8h/40h rules
            # before and after, the flextime ones settled in between (an adoption starts
            # on its settlement anchor and ends at a later settlement period start, so
            # no settlement period is cut).
            assert (
                flex[0].flex_anchor is not None and flex[0].flex_months is not None
            )  # Employment validator
            flex_anchor, flex_months = flex[0].flex_anchor, flex[0].flex_months
            flex_start, flex_end = min(e.start for e in flex), max(e.end for e in flex)
            others = [e for e in all_employments if e.working_time_system != "flex"]
            earlier = [e for e in others if e.end <= flex_start]
            later = [e for e in others if e.start >= flex_end]

            def settlement_boundary(
                at: datetime, anchor: date = flex_anchor, months: int = flex_months
            ) -> bool:
                day = at.astimezone(JST).date()
                return (
                    at == datetime.combine(day, time(), JST)
                    and flex_period(anchor, months, day)[0] == day
                )

            switch = bool(others) and (
                len(earlier) + len(later) == len(others)
                and all(e.working_time_system == "standard" for e in others)
                and len({e.week_start for e in all_employments}) == 1
                and len({getattr(e, "establishment_id", None) for e in all_employments})
                == 1
                and (not earlier or settlement_boundary(flex_start))
                and (not later or settlement_boundary(flex_end))
            )
            if (
                len({e.employer_id for e in all_employments}) > 1
                or declarations
                or (others and not switch)
                or len(
                    {
                        (
                            e.flex_anchor,
                            e.flex_months,
                            e.flex_full_two_day_weekend,
                            e.flex_rest_weekdays,
                            e.flex_other_rest_days,
                            e.week_start,
                        )
                        for e in flex
                    }
                )
                > 1
            ):
                fail(
                    "Flextime with another employer, a mixed system or changed settlement terms is not supported",
                    person.person_id,
                    "unsupported",
                )
                continue
            flex_own = [r for r in own if r["employment"].working_time_system == "flex"]
            if any(r.get("source") != "actual" for r in flex_own):
                # The worker sets start and end times (平30.9.7基発0907第1号).
                fail(
                    "Flextime workers set their own start and end times; no timed duty can be planned",
                    person.person_id,
                    "violation",
                )
            flex_rows, periods = _allocate_flex(flex_own, flex[0])
            week = flex[0].week_start
            standard_rows = _allocate(
                [r for r in own if r["employment"].working_time_system != "flex"], week
            )
            observers[week] = standard_rows + flex_rows
            # No official statement covers a week split between the two systems; its
            # standard days are counted alone against 40h, for HR/legal review.
            for direction, at, used in (
                ("to", flex_start, bool(earlier)),
                ("from", flex_end, bool(later)),
            ):
                switch_day = at.astimezone(JST).date()
                week_first = switch_day - timedelta(
                    days=(switch_day.weekday() - week) % 7
                )
                if (
                    used
                    and week_first != switch_day
                    and any(
                        week_first <= r["day"] < week_first + timedelta(days=7)
                        for r in standard_rows
                    )
                ):
                    fail(
                        f"The week of the switch {direction} flextime on {switch_day} is split; its standard-hours days are "
                        "counted without the flextime days; HR/legal review required",
                        person.person_id,
                        "unverified",
                    )
            for summary in periods:
                end = date.fromisoformat(summary["end"])
                settlements.append(
                    {"person_id": person.person_id, "kind": "flextime", **summary}
                )
                # A person who left before the final month is settled as a part below.
                employed_to_end = any(e.end.astimezone(JST).date() >= end for e in flex)
                if (
                    summary["unattributed_seconds"]
                    and employed_to_end
                    and snapshot.horizon.end.astimezone(JST).date() >= end
                ):
                    fail(
                        "Flextime settlement overtime has no work in the final month to be attributed to",
                        person.person_id,
                        "unverified",
                    )
            for e in flex:
                # Joining or leaving within a settlement period longer than one month
                # (Art. 32-3-2): hours above the 40h-a-week average of the worked part,
                # less overtime already counted, are paid as overtime.
                assert e.flex_anchor is not None and e.flex_months is not None
                if e.flex_months == 1:
                    continue
                for summary in periods:
                    begin = max(
                        e.start.astimezone(JST).date(),
                        date.fromisoformat(summary["start"]),
                    )
                    end = min(
                        e.end.astimezone(JST).date(), date.fromisoformat(summary["end"])
                    )
                    if (
                        begin >= end
                        or (begin.isoformat(), end.isoformat())
                        == (summary["start"], summary["end"])
                        or snapshot.horizon.end.astimezone(JST).date() < end
                    ):
                        continue
                    part = [
                        r
                        for r in flex_rows
                        if r["employment"] is e
                        and begin <= r["calendar_day"] < end
                        and not r["holiday"]
                    ]
                    worked = sum(r["seconds"] for r in part)
                    counted = sum(r["overtime"] for r in part)
                    frame = 144000 * (end - begin).days // 7
                    settlements.append(
                        {
                            "person_id": person.person_id,
                            "kind": "flextime_part",
                            "employment_revision": e.revision_id,
                            "start": begin.isoformat(),
                            "end": end.isoformat(),
                            "worked_seconds": worked,
                            "overtime_counted_seconds": counted,
                            "frame_seconds": frame,
                            "settlement_seconds": max(0, worked - counted - frame),
                        }
                    )
        annual = [
            e
            for e in snapshot.employments
            if e.person_id == person.person_id
            and e.activity == "employment"
            and e.working_time_system == "annual_variable"
        ]
        annual_calendars: list[Any] = []
        if annual:
            all_employments = [
                e
                for e in snapshot.employments
                if e.person_id == person.person_id and e.activity == "employment"
            ]
            if (
                len({e.employer_id for e in all_employments}) > 1
                or declarations
                or len(annual) != len(all_employments)
                or len({e.week_start for e in annual}) > 1
            ):
                fail(
                    "One-year variable hours with another employer or a mixed system are not supported",
                    person.person_id,
                    "unsupported",
                )
                continue
            names = {e.annual_calendar_id for e in annual}
            annual_calendars = sorted(
                (
                    c
                    for c in getattr(snapshot, "annual_calendars", ())
                    if c.calendar_id in names
                ),
                key=lambda c: c.start,
            )
            if len(annual_calendars) != len(names):
                continue  # reported by input_findings
            if any(
                a.end > b.start
                for a, b in zip(annual_calendars, annual_calendars[1:], strict=False)
            ):
                fail(
                    "One-year variable calendars of one person overlap",
                    person.person_id,
                    "unsupported",
                )
                continue
            if any(
                not any(c.start <= r["day"] < c.end for c in annual_calendars)
                for r in own
            ):
                fail(
                    "Work outside the one-year variable period cannot be accounted",
                    person.person_id,
                    "unverified",
                )
                continue
            observers[annual[0].week_start] = _allocate_annual(
                own, annual_calendars, annual[0].week_start
            )
        for e in (e for e in snapshot.employments if e.person_id == person.person_id):
            if e.week_start not in observers:
                observers[e.week_start] = _allocate(own, e.week_start)
        # One employer, several sites: no official statement fixes which site's 36
        # agreement bears the overtime (scheduled first, or in the order worked).
        # When the two readings attribute it differently, HR/legal must decide.
        site_sets: dict[str, set[Any]] = defaultdict(set)
        for r in own:
            if not isinstance(r["employment"], OutsideEmployment):
                site_sets[r["employment"].employer_id].add(
                    getattr(r["employment"], "establishment_id", None)
                )
        # Flextime has no schedule, so only the order worked exists as a reading.
        multi_site = (
            set()
            if flex
            else {employer for employer, found in site_sets.items() if len(found) > 1}
        )
        applied: dict[str, str] = {}  # employer -> decision used for its attribution
        decided = {
            employer: _site_decision(
                snapshot,
                employer,
                [r for r in own if r["employment"].employer_id == employer],
            )
            for employer in multi_site
        }
        if multi_site and len({r["employment"].employer_id for r in own}) > 1:
            # With another employer the between-employer order (基発0901第3号) fixes
            # scheduled portions first; an order-worked reading within one employer
            # is then undefined, so extra hours at its sites are referred as such.
            for employer in sorted(multi_site):
                decision = decided[employer]
                if decision is not None and decision.reading == "scheduled_first":
                    applied[employer] = decision.decision_id
                elif (
                    decision is not None
                    and decision.reading == "time_order"
                    and any(
                        not r["scheduled"]
                        for r in own
                        if r["employment"].employer_id == employer
                    )
                ):
                    # Without extra hours both readings coincide; with them, an
                    # order-worked reading next to another employer is undefined.
                    fail(
                        "An order-worked attribution between the sites of one employer is not supported "
                        f"alongside another employer: {decision.decision_id}",
                        person.person_id,
                        "unsupported",
                    )
                elif decision is None and any(
                    not r["scheduled"]
                    for r in own
                    if r["employment"].employer_id == employer
                ):
                    fail(
                        "Overtime attribution between the sites of one employer alongside another employer "
                        "has no computed alternative reading; HR/legal review required",
                        person.person_id,
                        "unverified",
                    )
        elif multi_site and decided[next(iter(multi_site))] is not None:
            # A verified HR/legal decision selects the reading; the chosen allocation
            # replaces the default one (variable hours default to the order worked).
            decision = decided[next(iter(multi_site))]
            assert decision is not None
            applied[decision.employer_id] = decision.decision_id
            for week in list(observers):
                if variable:
                    assert anchor is not None  # Employment validator
                    observers[week] = _allocate_variable(
                        own,
                        week,
                        anchor,
                        length,
                        scheduled_first=decision.reading == "scheduled_first",
                    )
                elif annual_calendars:
                    observers[week] = _allocate_annual(
                        own,
                        annual_calendars,
                        week,
                        scheduled_first=decision.reading == "scheduled_first",
                    )
                else:
                    observers[week] = _allocate(
                        own, week, time_order=decision.reading == "time_order"
                    )
        elif multi_site:

            def by_site(reading: list[dict[str, Any]]) -> dict[Any, tuple[int, int]]:
                # Keyed as the agreement limits are summed: daily excess by duty day,
                # monthly/annual overtime by calendar day.
                totals: dict[Any, tuple[int, int]] = {}
                for r in reading:
                    key = (
                        getattr(r["employment"], "establishment_id", None),
                        r["day"],
                        r["calendar_day"],
                    )
                    daily, overtime = totals.get(key, (0, 0))
                    totals[key] = (
                        daily + r["daily_overtime"],
                        overtime + r["overtime"],
                    )
                return {k: v for k, v in totals.items() if v != (0, 0)}

            for week, reading in observers.items():
                if variable:
                    assert anchor is not None  # Employment validator
                    other = _allocate_variable(
                        own, week, anchor, length, scheduled_first=True
                    )
                elif annual_calendars:
                    other = _allocate_annual(
                        own, annual_calendars, week, scheduled_first=True
                    )
                else:
                    other = _allocate(own, week, time_order=True)
                if by_site(reading) != by_site(other):
                    fail(
                        "Overtime attribution between the sites of one employer depends on the counting "
                        "order (scheduled first or order worked); HR/legal review required",
                        person.person_id,
                        "unverified",
                    )
                    break
        observer_index = {
            week: {(r["duty_id"], r["start"]): r for r in allocated}
            for week, allocated in observers.items()
        }
        first_employer_allocations = {}
        effective: list[dict[str, Any]] = []
        for row in own:
            e = row["employment"]
            calculated = union_allocation(
                observer_index, transition_origins(e, row), row
            )
            if e.method == "management":
                employer_ids = {
                    other.employer_id
                    for other in snapshot.employments
                    if other.person_id == person.person_id
                    and other.activity == "employment"
                    and other.start <= row["start"] < other.end
                } | {
                    d.employer_id
                    for d in declarations
                    if _usable_declaration(snapshot, d)
                    and d.start <= row["start"] < d.end
                }
                models = [
                    m
                    for m in snapshot.management_models
                    if m.person_id == person.person_id
                    and m.start <= row["start"]
                    and row["end"] <= m.end
                ]
                if len(models) != 1:
                    fail(
                        "Management model missing or ambiguous",
                        person.person_id,
                        "unverified",
                    )
                    continue
                m = models[0]
                if (
                    not employer_ids <= {m.first_employer, m.second_employer}
                    or m.first_employer == m.second_employer
                ):
                    fail(
                        "Management model supports the verified A/B pair only",
                        person.person_id,
                        "unsupported",
                    )
                    continue
                if e.employer_id == m.second_employer:
                    calculated = {
                        **calculated,
                        "overtime": 0 if row["holiday"] else row["seconds"],
                        "daily_overtime": 0 if row["holiday"] else row["seconds"],
                        "weekly_overtime": 0,
                    }
                else:
                    origins = transition_origins(e, row)
                    for origin in origins:
                        key = (m.first_employer, origin)
                        if key not in first_employer_allocations:
                            a_only = _allocate(
                                [
                                    r
                                    for r in own
                                    if r["employment"].employer_id == m.first_employer
                                ],
                                origin,
                            )
                            first_employer_allocations[key] = {
                                (r["duty_id"], r["start"]): r for r in a_only
                            }
                    calculated = union_allocation(
                        {
                            origin: first_employer_allocations[m.first_employer, origin]
                            for origin in origins
                        },
                        origins,
                        row,
                    )
            effective.append(calculated)
        # Check each effective agreement revision, while totals span revisions of the same year.
        for row in effective:
            e = row["employment"]
            applicable = [
                a
                for a in snapshot.agreements
                if a.agreement_id == e.agreement_id
                and a.start <= row["start"]
                and row["end"] <= a.end
                and same_establishment(a, e)
            ]
            if isinstance(e, OutsideEmployment):
                continue  # the other employer's own agreement governs its overtime
            if row["overtime"] or row["holiday_seconds"]:
                if len(applicable) != 1:
                    fail(
                        "Overtime/holiday work lacks an effective employer agreement",
                        row["duty_id"],
                    )
                elif (
                    row["holiday_seconds"] and not applicable[0].holiday_work_permitted
                ):
                    fail(
                        "Agreement does not permit statutory holiday work",
                        row["duty_id"],
                    )
        for a in snapshot.agreements:
            own_rows = [r for r in effective if same_establishment(r["employment"], a)]
            if not own_rows:
                continue
            monthly: dict[int, int] = defaultdict(int)
            combined: dict[int, int] = defaultdict(int)
            daily: dict[date, int] = defaultdict(int)
            for r in own_rows:
                monthly[month_index(a.month_anchor, r["calendar_day"])] += r["overtime"]
                if a.start <= r["start"] < a.end:
                    daily[r["day"]] += r["daily_overtime"]
            # Resolve the observer from the agreement's effective interval, never
            # from the first historical duty or from any old management-method row.
            # A change inside the same agreement remains explicitly unverified
            # until its transition basis can be represented without guessing.
            applicable_employments = [
                e
                for e in snapshot.employments
                if e.person_id == person.person_id
                and e.activity == "employment"
                and same_establishment(e, a)
                and e.overlaps(a)
            ]
            observer_configs = {
                (e.week_start, e.method) for e in applicable_employments
            }
            if not observer_configs:
                fail(
                    "Agreement observer transition is missing or ambiguous",
                    a.agreement_id,
                    "unverified",
                )
                continue
            first_observer = min(
                applicable_employments, key=lambda e: (e.start, e.revision_id)
            )
            last_observer = max(
                applicable_employments, key=lambda e: (e.end, e.revision_id)
            )
            observer_week, observer_method = (
                first_observer.week_start,
                first_observer.method,
            )
            # Retain attribution under already effective management-model periods.
            # Standard periods use this observer's week origin, including the full
            # lookback; slicing the input at the revision would reset accumulated work.
            effective_index = {(r["duty_id"], r["start"]): r for r in effective}
            combined_rows = []
            observer_windows = []
            for r in own:
                active_observers = [
                    e for e in applicable_employments if e.start <= r["start"] < e.end
                ]
                if not active_observers and r["start"] < first_observer.start:
                    active_observers = [first_observer]
                if not active_observers and r["start"] >= last_observer.end:
                    active_observers = [last_observer]
                configs = {(e.week_start, e.method) for e in active_observers}
                if len(configs) != 1:
                    fail(
                        "Agreement observer transition is missing or ambiguous",
                        a.agreement_id,
                        "unverified",
                    )
                    continue
                active_week, active_method = next(iter(configs))
                origins = set().union(
                    *(transition_origins(e, r) for e in active_observers)
                )
                allocated = union_allocation(observer_index, origins, r)
                historical = [
                    e
                    for e in snapshot.employments
                    if e.person_id == person.person_id
                    and e.activity == "employment"
                    and same_establishment(e, a)
                    and e.start <= r["start"] < e.end
                ]
                methods = {e.method for e in historical} or {active_method}
                if len(methods) != 1:
                    fail(
                        "Historical observer method is ambiguous",
                        a.agreement_id,
                        "unverified",
                    )
                    continue
                if "management" in methods:
                    attributed = effective_index.get((r["duty_id"], r["start"]))
                    if attributed is None:
                        fail(
                            "Historical management attribution is unavailable",
                            a.agreement_id,
                            "unverified",
                        )
                        continue
                    combined_rows.append(attributed)
                else:
                    combined_rows.append(allocated)
                observer_windows.append(
                    {
                        "duty_id": r["duty_id"],
                        "start": r["start"].isoformat(),
                        "week_start": active_week,
                        "checked_week_origins": sorted(origins),
                        "method": next(iter(methods)),
                    }
                )
            for r in combined_rows:
                combined[month_index(a.month_anchor, r["calendar_day"])] += (
                    r["overtime"] + r["holiday_seconds"]
                )
            # One-year variable hours over more than three months: 42h a month and
            # 320h a year (Art. 36(4)); a special clause may exceed 42h in at most
            # six months (Art. 36(5)). 平30.12.28基発1228第15号 第2問3.
            long_annual = any(
                e.working_time_system == "annual_variable"
                and any(
                    c.calendar_id == e.annual_calendar_id
                    and c.end > period_end(c.start, 3)
                    for c in getattr(snapshot, "annual_calendars", ())
                )
                for e in applicable_employments
            )
            month_limit = (
                a.monthly_limit_seconds
                if a.special_clause or not long_annual
                else min(a.monthly_limit_seconds, 42 * 3600)
            )
            year_limit = (
                a.annual_limit_seconds
                if a.special_clause or not long_annual
                else min(a.annual_limit_seconds, 320 * 3600)
            )
            principle = (42 if long_annual else 45) * 3600
            suffix = " (one-year variable hours: 42h/320h)" if long_annual else ""
            if any(v > a.daily_limit_seconds for v in daily.values()):
                fail("Daily agreement limit exceeded", a.agreement_id)
            relevant = [
                i
                for i in monthly
                if month_boundary(a.month_anchor, i) < a.end.astimezone(JST).date()
                and month_boundary(a.month_anchor, i + 1)
                > a.start.astimezone(JST).date()
            ]
            if any(monthly[i] > month_limit for i in relevant):
                fail("Monthly agreement limit exceeded" + suffix, a.agreement_id)
            year_end = month_boundary(a.year_start, 12)
            yearly = sum(
                r["overtime"]
                for r in own_rows
                if a.year_start <= r["calendar_day"] < year_end
            )
            if yearly > year_limit:
                fail("Annual agreement limit exceeded" + suffix, a.agreement_id)
            if (
                sum(
                    monthly[i] > principle
                    for i in monthly
                    if a.year_start <= month_boundary(a.month_anchor, i) < year_end
                )
                > 6
            ):
                fail(
                    f"More than six months exceed {principle // 3600} hours",
                    a.agreement_id,
                )
            combined_relevant = [
                i
                for i in combined
                if month_boundary(a.month_anchor, i) < a.end.astimezone(JST).date()
                and month_boundary(a.month_anchor, i + 1)
                > a.start.astimezone(JST).date()
            ]
            agreement_totals.append(
                {
                    "person_id": person.person_id,
                    "agreement_id": a.agreement_id,
                    "employer_id": a.employer_id,
                    "establishment_id": getattr(a, "establishment_id", None),
                    "effective_start": a.start.isoformat(),
                    "effective_end": a.end.isoformat(),
                    "observer_week_start": (
                        observer_week if len(observer_configs) == 1 else None
                    ),
                    "observer_method": (
                        observer_method
                        if len(observer_configs) == 1
                        else "effective_transitions"
                    ),
                    "observer_windows": observer_windows,
                    "employment_revisions": sorted(
                        e.revision_id for e in applicable_employments
                    ),
                    "annual_overtime_seconds": yearly,
                    "months": [
                        {
                            "start": month_boundary(a.month_anchor, i).isoformat(),
                            "end": month_boundary(a.month_anchor, i + 1).isoformat(),
                            "site_overtime_seconds": monthly.get(i, 0),
                            "combined_overtime_holiday_seconds": combined.get(i, 0),
                            "rolling_sums_seconds": {
                                str(n): sum(
                                    combined.get(j, 0) for j in range(i - n + 1, i + 1)
                                )
                                for n in range(2, 7)
                            },
                        }
                        for i in sorted(set(relevant) | set(combined_relevant))
                    ],
                }
            )
            for i in combined_relevant:
                value = combined[i]
                if value >= 100 * 3600 or any(
                    sum(combined.get(j, 0) for j in range(i - n + 1, i + 1))
                    > n * 80 * 3600
                    for n in range(2, 7)
                ):
                    fail(
                        "Combined overtime/holiday 100h or rolling 80h cap exceeded",
                        a.agreement_id,
                    )
        for m in (
            m for m in snapshot.management_models if m.person_id == person.person_id
        ):
            monthly_pair: dict[tuple[str, int], int] = defaultdict(int)
            for r in effective:
                if m.start <= r["start"] < m.end:
                    employer = r["employment"].employer_id
                    monthly_pair[
                        (employer, month_index(m.month_anchor, r["calendar_day"]))
                    ] += (
                        r["seconds"]
                        if employer == m.second_employer
                        else r["overtime"] + r["holiday_seconds"]
                    )
            for (employer, _), value in monthly_pair.items():
                limit = (
                    m.first_month_limit_seconds
                    if employer == m.first_employer
                    else m.second_month_limit_seconds
                )
                if value > limit:
                    fail("Management-model employer limit exceeded", m.model_id)
        for e in annual:
            # Joining or leaving within the period (Art. 32-4-2): hours above the
            # 40h-a-week average of the worked part, less overtime already counted,
            # are paid as overtime. Reported for payroll once that part is in the input.
            for cal in annual_calendars:
                begin = max(e.start.astimezone(JST).date(), cal.start)
                end = min(e.end.astimezone(JST).date(), cal.end)
                if begin >= end or (begin, end) == (cal.start, cal.end):
                    continue
                if snapshot.horizon.end.astimezone(JST).date() < end:
                    continue
                part = [
                    r
                    for r in effective
                    if r["employment"] is e
                    and begin <= r["day"] < end
                    and not r["holiday"]
                ]
                worked = sum(r["seconds"] for r in part)
                counted = sum(r["overtime"] for r in part)
                frame = 144000 * (end - begin).days // 7
                settlements.append(
                    {
                        "person_id": person.person_id,
                        "kind": "one_year_variable",
                        "employment_revision": e.revision_id,
                        "calendar_id": cal.calendar_id,
                        "start": begin.isoformat(),
                        "end": end.isoformat(),
                        "worked_seconds": worked,
                        "overtime_counted_seconds": counted,
                        "frame_seconds": frame,
                        "settlement_seconds": max(0, worked - counted - frame),
                    }
                )
        for r in effective:
            e = r["employment"]
            trace.append(
                {
                    "person_id": person.person_id,
                    "employer_id": e.employer_id,
                    **(
                        {"establishment_id": e.establishment_id}
                        if hasattr(e, "establishment_id")
                        else {}
                    ),
                    "duty_id": r["duty_id"],
                    "date": r["calendar_day"].isoformat(),
                    "start": r["start"].isoformat(),
                    "end": r["end"].isoformat(),
                    "scheduled": r["scheduled"],
                    "method": e.method,
                    "work_seconds": r["seconds"],
                    "overtime_seconds": r["overtime"],
                    "daily_overtime_seconds": r["daily_overtime"],
                    "weekly_overtime_seconds": r["weekly_overtime"],
                    "period_overtime_seconds": r.get("period_overtime", 0),
                    "holiday_seconds": r["holiday_seconds"],
                    "employment_revision": e.revision_id,
                    "checked_week_origins": r.get(
                        "checked_week_origins", [e.week_start]
                    ),
                    **(
                        {"site_attribution_decision": applied[e.employer_id]}
                        if e.employer_id in applied
                        else {}
                    ),
                }
            )
    return {
        "input_hash": snapshot.input_hash,
        "rule_revision": snapshot.rule_revision,
        "source": "MHLW-2020-0901-3",
        "trace": trace,
        "agreement_totals": agreement_totals,
        **({"settlements": settlements} if settlements else {}),
        "nonemployment_seconds": sum(
            r["seconds"] for r in rows if r["employment"].activity == "nonemployment"
        ),
        "findings": findings,
    }
