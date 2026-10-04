"""Exact rational exposure rates; overflow is reported, never silently rounded."""

from collections.abc import Callable, Collection, Iterable, Sequence
from datetime import datetime, time, timedelta
from math import gcd, lcm
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from shift_scheduler.domain.planning import ContractRevision, Duty, Interval
from shift_scheduler.validation.work_accounting import month_boundary

if TYPE_CHECKING:
    from shift_scheduler.domain.compliance import Employment, SolverSnapshotV2
    from shift_scheduler.optimizer.exact_objectives import Rate

JST = ZoneInfo("Asia/Tokyo")
Span = tuple[datetime, datetime]


def burden_spans(duty: Duty, kind: str, holidays: Collection[Any]) -> list[Span]:
    spans: list[Span] = []
    for work in duty.work:
        day = work.start.astimezone(JST).date()
        last = work.end.astimezone(JST).date()
        while day <= last:
            zero = datetime.combine(day, time(), JST)
            windows = (
                [(zero, zero + timedelta(days=1))]
                if kind == "holiday" and day in holidays
                else (
                    [
                        (zero, zero + timedelta(hours=5)),
                        (zero + timedelta(hours=22), zero + timedelta(days=1)),
                    ]
                    if kind == "night"
                    else []
                )
            )
            for begin, end in windows:
                lo, hi = max(begin, work.start), min(end, work.end)
                if lo < hi:
                    spans.append((lo, hi))
            day += timedelta(days=1)
    return spans


def union_seconds(spans: Iterable[Span]) -> int:
    seconds = 0
    until: datetime | None = None
    for start, end in sorted(spans):
        begin = max(start, until) if until else start
        seconds += max(0, int((end - begin).total_seconds()))
        until = max(until, end) if until else end
    return seconds


def revision_burden_spans(
    duty: Duty, kind: str, revisions: Iterable["Employment"]
) -> list[Span]:
    """Burden spans with each part of the duty judged by its own employment revision.

    Statutory holidays are calendar days (昭23.4.5基発535号); the part of a duty
    worked on a later revision's holiday is holiday work of that revision.
    """
    spans: list[Span] = []
    for revision in revisions:
        work = tuple(
            w.model_copy(
                update={
                    "start": max(w.start, revision.start),
                    "end": min(w.end, revision.end),
                }
            )
            for w in duty.work
            if w.overlaps(revision)
        )
        spans.extend(
            burden_spans(
                duty.model_copy(update={"work": work}),
                kind,
                set(revision.statutory_holidays),
            )
        )
    return spans


def capped_opportunity(
    contracts: Sequence[ContractRevision],
    person_id: str,
    period: Interval,
    duties: Iterable[Duty],
    spans_of: Callable[[Duty], Iterable[Span]],
) -> int:
    """Attainable exposure: sum over contract revisions of min(cap, own opportunity).

    Each revision's period_max_seconds is a separate hard limit, so the sum of
    per-revision minima is the attainable maximum. A duty belongs to the
    revision in effect at its start (same rule as contract_for). Revisions
    without any opportunity add nothing.
    """
    from shift_scheduler.domain.contract_segments import resolve_contract

    by_revision: dict[str, list[Span]] = {}
    for duty in duties:
        governing = resolve_contract(
            contracts, duty.relationship_id, duty, duty.person_id
        ).governing
        if governing is not None:
            by_revision.setdefault(governing.revision_id, []).extend(spans_of(duty))
    return sum(
        min(c.period_max_seconds, union_seconds(by_revision.get(c.revision_id, [])))
        for c in contracts
        if c.person_id == person_id and c.overlaps(period)
    )


def objectives(
    model: Any,
    snapshot: "SolverSnapshotV2",
    duties: Sequence[Duty],
    variables: dict[str, Any],
    eligible_ids: Collection[str],
    encoding: dict[str, Any] | None = None,
) -> tuple[Any, ...]:
    employment = {e.revision_id: e for e in snapshot.employments}
    terms = {t.duty_id: t for t in snapshot.work_terms}

    def effective_spans(duty: Duty, kind: str) -> list[Span]:
        term = terms[duty.duty_id]
        return revision_burden_spans(
            duty,
            kind,
            [
                employment[key]
                for key in (
                    term.employment_revision_ids or (term.employment_revision_id,)
                )
            ],
        )

    cutoff = month_boundary(snapshot.period.start.astimezone(JST).date(), -12)
    rates: list[Rate] = []
    for kind in ("night", "holiday"):
        for person in snapshot.people:
            own = [d for d in duties if d.person_id == person.person_id]
            spans = {
                d.duty_id: [
                    (max(a, snapshot.period.start), min(b, snapshot.period.end))
                    for a, b in effective_spans(d, kind)
                    if a < snapshot.period.end and snapshot.period.start < b
                ]
                for d in own
            }
            opportunity = union_seconds(
                [s for d in own if d.duty_id in eligible_ids for s in spans[d.duty_id]]
            )

            def spans_of(d: Duty, spans: dict[str, list[Span]] = spans) -> list[Span]:
                return spans[d.duty_id]

            cap = capped_opportunity(
                snapshot.contracts,
                person.person_id,
                snapshot.period,
                [d for d in own if d.duty_id in eligible_ids],
                spans_of,
            )
            from shift_scheduler.domain.compliance_v3 import BurdenV3

            historical = [
                h
                for h in snapshot.burden_history
                if isinstance(h, BurdenV3)
                and h.person_id == person.person_id
                and h.kind == kind
                and cutoff <= h.period_start
                and h.period_end <= snapshot.period.start.astimezone(JST).date()
            ]
            denominator = min(cap, opportunity) + sum(
                h.eligible_seconds for h in historical
            )
            if not denominator:
                continue
            coefficients = {
                d.duty_id: sum(
                    int((b - a).total_seconds()) for a, b in spans[d.duty_id]
                )
                for d in own
            }
            previous = sum(h.seconds for h in historical)
            divisor = gcd(denominator, previous)
            for c in coefficients.values():
                divisor = gcd(divisor, c)
            divisor = max(1, divisor)
            rates.append(
                (
                    kind,
                    denominator // divisor,
                    previous // divisor,
                    {key: value // divisor for key, value in coefficients.items()},
                )
            )
    common = lcm(*(denominator for _, denominator, _, _ in rates)) if rates else 1
    upper = max(
        (
            (previous + sum(coefficients.values())) * (common // denominator)
            for _, denominator, previous, coefficients in rates
        ),
        default=0,
    )
    if upper * (len(rates) + 1) ** 2 > 2**60:
        from shift_scheduler.optimizer.exact_objectives import rational_objectives

        return rational_objectives(
            model,
            rates,
            variables,
            common,
            upper,
            encoding if encoding is not None else {},
        )
    if encoding is not None:
        encoding.update(
            kind="scaled_integer",
            common_denominator=str(common),
            order="changes, preferences, maximum, deviation",
        )
    normalized: list[tuple[str, Any]] = []
    for index, (kind, denominator, previous, coefficients) in enumerate(rates):
        value = model.new_int_var(0, upper, f"{kind}_rate_{index}")
        model.add(
            value
            == (previous + sum(c * variables[key] for key, c in coefficients.items()))
            * (common // denominator)
        )
        normalized.append((kind, value))
    maximum = model.new_int_var(0, upper, "maximum_burden_rate")
    if normalized:
        model.add_max_equality(maximum, [r for _, r in normalized])
    else:
        model.add(maximum == 0)
    differences: list[Any] = []
    for i, (kind, left) in enumerate(normalized):
        for other_kind, right in normalized[i + 1 :]:
            if other_kind != kind:
                continue
            delta = model.new_int_var(0, upper, f"burden_delta_{len(differences)}")
            model.add_abs_equality(delta, left - right)
            differences.append(delta)
    return maximum, sum(differences)
