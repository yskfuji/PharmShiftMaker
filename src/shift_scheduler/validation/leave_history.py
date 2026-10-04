"""Projection of immutable HR evidence; never fabricates or removes actual leave."""

from collections.abc import Iterable
from datetime import date, datetime
from typing import Any, Literal

from shift_scheduler.domain.compliance import LeaveRecord
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import Finding
from shift_scheduler.validation.work_accounting import verified


def chronological_events(
    events: Iterable[LeaveRecord],
) -> tuple[list[LeaveRecord], list[tuple[str, str]]]:
    """Order by effective date and causal links, independent of import order.

    Conversions are opening-of-day actions. A linked compensation cannot precede
    its source; invalid or cyclic chains remain explicit reconciliation findings.
    """
    pending = {event.event_id: event for event in events}
    source = dict(pending)
    ordered: list[LeaveRecord] = []
    problems: list[tuple[str, str]] = []
    for event in events:
        parent = (
            source.get(event.related_event_id)
            if event.related_event_id is not None
            else None
        )
        if parent and parent.effective_on > event.effective_on:
            problems.append(
                ("Compensation precedes its source effective date", event.event_id)
            )
    while pending:
        ready = [e for e in pending.values() if e.related_event_id not in pending]
        if not ready:
            problems.extend(
                ("Cyclic leave event references", key) for key in sorted(pending)
            )
            ordered.extend(pending[key] for key in sorted(pending))
            break
        event = min(
            ready, key=lambda e: (e.effective_on, e.kind != "conversion", e.event_id)
        )
        ordered.append(event)
        del pending[event.event_id]
    return ordered, problems


def project_ledger(
    snapshot: SolverSnapshotV3, effective_at: date | None, known_at: datetime | None
) -> tuple[SolverSnapshotV3, list[Finding], list[dict[str, Any]]]:
    recordings = {(r.object_kind, r.object_id): r for r in snapshot.ledger_recordings}
    findings: list[Finding] = []
    trace: list[dict[str, Any]] = []

    def fail(message: str, identity: str, *related: str) -> None:
        findings.append(
            Finding(
                rule_id="leave.v3.history",
                status="unverified",
                message=message,
                subjects=(identity, *related),
            )
        )

    def visible(kind: Literal["leave_account", "leave_record"], identity: str) -> bool:
        if known_at is None:
            return True
        record = recordings.get((kind, identity))
        if record is None or not verified(record.evidence, record.recorded_at):
            fail("Original ledger recording time is not verified", identity)
            return False
        return record.recorded_at <= known_at

    accounts = {
        a.account_id: a
        for a in snapshot.leave_accounts
        if visible("leave_account", a.account_id)
        and (effective_at is None or a.granted_on <= effective_at)
    }
    for identity, account in list(accounts.items()):
        base = recordings.get(("leave_account", identity))
        changes = sorted(
            (
                a
                for a in snapshot.grant_amendments
                if a.account_id == identity
                and (known_at is None or a.recorded_at <= known_at)
            ),
            key=lambda a: a.external_revision,
        )
        revision = base.external_revision if base else 1
        previous_time = base.recorded_at if base else None
        applied: list[Any] = []
        for change in changes:
            if (
                base is None
                or change.external_event_id != base.external_event_id
                or change.supersedes_revision != revision
                or (previous_time is not None and change.recorded_at < previous_time)
                or not verified(change.evidence, change.recorded_at)
            ):
                fail(
                    "Grant correction chain or evidence is not verified",
                    change.amendment_id,
                )
                break
            revision, previous_time = change.external_revision, change.recorded_at
            if change.effective_on < account.granted_on:
                fail(
                    "Grant correction precedes the original grant", change.amendment_id
                )
                continue
            if effective_at is not None and change.effective_on > effective_at:
                continue
            applied.append(change)
        # A later revision supersedes the grant from its own effective date onward,
        # also when it takes effect before an earlier revision (a retroactive HR
        # correction): on each date the amount is that of the highest revision
        # already in effect. The replay receives one step per change of amount, so
        # the balance between the dates follows the latest HR statement.
        current_days, current_statutory = account.granted_days, account.statutory_days
        for day in sorted({c.effective_on for c in applied}):
            winner = max(
                (c for c in applied if c.effective_on <= day),
                key=lambda c: c.external_revision,
            )
            if (winner.granted_days, winner.statutory_days) == (
                current_days,
                current_statutory,
            ):
                continue
            trace.append(
                {
                    "amendment_id": winner.amendment_id,
                    "person_id": account.person_id,
                    "account_id": identity,
                    "previous_days": current_days,
                    "corrected_days": winner.granted_days,
                    "effective_on": day.isoformat(),
                    "recorded_at": winner.recorded_at.isoformat(),
                    "reason": winner.reason,
                }
            )
            current_days, current_statutory = winner.granted_days, winner.statutory_days
        if applied:
            accounts[identity] = account.model_copy(
                update={
                    "granted_days": current_days,
                    "statutory_days": current_statutory,
                }
            )
    events = []
    for original in snapshot.leave_records:
        if (
            not visible("leave_record", original.event_id)
            or original.account_id not in accounts
        ):
            continue
        event: LeaveRecord | None = original
        base = recordings.get(("leave_record", original.event_id))
        revision = base.external_revision if base else 1
        previous_time = base.recorded_at if base else None
        corrections = sorted(
            (
                a
                for a in snapshot.leave_amendments
                if a.event_id == original.event_id
                and (known_at is None or a.recorded_at <= known_at)
            ),
            key=lambda a: a.external_revision,
        )
        for correction in corrections:
            if (
                base is None
                or correction.external_event_id != base.external_event_id
                or correction.supersedes_revision != revision
                or (
                    previous_time is not None and correction.recorded_at < previous_time
                )
                or not verified(correction.evidence, correction.recorded_at)
            ):
                fail(
                    "Leave correction chain or evidence is not verified",
                    correction.amendment_id,
                )
                break
            revision, previous_time = (
                correction.external_revision,
                correction.recorded_at,
            )
            trace.append(
                {
                    "amendment_id": correction.amendment_id,
                    "person_id": correction.person_id,
                    "event_id": original.event_id,
                    "account_id": original.account_id,
                    "recorded_at": correction.recorded_at.isoformat(),
                    "reason": correction.reason,
                    "previous_event": event.model_dump(mode="json") if event else None,
                    "corrected_event": (
                        correction.replacement.model_dump(mode="json")
                        if correction.replacement
                        else None
                    ),
                }
            )
            event = correction.replacement
        if event and (effective_at is None or event.effective_on <= effective_at):
            events.append(event)
    events, ordering_problems = chronological_events(events)
    for message, identity in ordering_problems:
        fail(message, identity)
    projected = snapshot.model_copy(
        update={
            "leave_accounts": tuple(accounts.values()),
            "leave_records": tuple(events),
            "leave_obligations": tuple(
                o
                for o in snapshot.leave_obligations
                if any(g in accounts for g in o.qualifying_grant_ids)
            ),
        }
    )
    return projected, findings, trace
