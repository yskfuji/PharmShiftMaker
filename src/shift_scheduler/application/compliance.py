"""Typed administrative records and immutable snapshots; all writes use CAS and audit."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from shift_scheduler.application.planning import Conflict, emit
from shift_scheduler.db.compliance_models import ComplianceEntity, ComplianceRevision
from shift_scheduler.db.planning_models import PlanningInput, PlanningScope
from shift_scheduler.domain.administration import (
    CapabilityAmendment,
    EmployerRecord,
    ScopeSetting,
)
from shift_scheduler.domain.compliance import (
    Agreement,
    Employment,
    LeaveAccount,
    LeaveObligation,
    LeavePolicy,
    LeaveRecord,
    ManagementModel,
    SolverSnapshotV2,
    WorkTerms,
)
from shift_scheduler.domain.compliance_v3 import (
    AccountingTransition,
    AgreementV3,
    AnnualCalendar,
    EmploymentV3,
    Establishment,
    FlexAdoption,
    FlexEnrollment,
    GrantAmendment,
    LeaveAmendment,
    LeaveObligationV3,
    LedgerRecording,
    OutsideDeclaration,
    RuleDecision,
    RuleReview,
    SiteAttributionDecision,
)
from shift_scheduler.domain.planning import (
    Capability,
    ContractRevision,
    Demand,
    Person,
    Value,
    content_hash,
)
from shift_scheduler.validation.leave_accounting import account_leave

JST = ZoneInfo("Asia/Tokyo")

ADMIN_SCHEMAS: dict[str, tuple[type[Value], str, str]] = {
    "employer": (EmployerRecord, "employer_id", "employers"),
    "capability_amendment": (
        CapabilityAmendment,
        "amendment_id",
        "capability_amendments",
    ),
    # Written only by the scope-setting route (ideal_workflows.set_absence_consent),
    # which does not invalidate planning inputs.
    "scope_setting": (ScopeSetting, "setting_id", "scope_settings"),
}

V3_SCHEMAS: dict[str, tuple[type[Value], str, str]] = {
    "accounting_transition": (
        AccountingTransition,
        "transition_id",
        "accounting_transitions",
    ),
    "establishment": (Establishment, "establishment_id", "establishments"),
    "ledger_recording": (LedgerRecording, "recording_id", "ledger_recordings"),
    "grant_amendment": (GrantAmendment, "amendment_id", "grant_amendments"),
    "leave_amendment": (LeaveAmendment, "amendment_id", "leave_amendments"),
    "rule_review": (RuleReview, "review_id", "rule_reviews"),
    "rule_decision": (RuleDecision, "decision_id", "rule_decisions"),
    "site_attribution_decision": (
        SiteAttributionDecision,
        "decision_id",
        "site_attribution_decisions",
    ),
    "annual_calendar": (AnnualCalendar, "calendar_id", "annual_calendars"),
    # Written only by the flextime adoption routes (two administrators).
    "flex_adoption": (FlexAdoption, "adoption_id", "flex_adoptions"),
    "flex_enrollment": (FlexEnrollment, "enrollment_id", "flex_enrollments"),
}

# Records a department's generic record route must not write: they have their own
# ordered, two-person routes (application/flex_adoption.py).
PROCEDURE_ONLY = frozenset({"flex_adoption", "flex_enrollment"})
# Workflow settings: written only by their own route (no input invalidation).
SETTING_ONLY = frozenset({"scope_setting"})

SCHEMAS: dict[str, tuple[type[Value], str, str]] = {
    "demand": (Demand, "demand_id", "demands"),
    "person": (Person, "person_id", "people"),
    "contract": (ContractRevision, "revision_id", "contracts"),
    "capability": (Capability, "person_id", "capabilities"),
    "employment": (Employment, "revision_id", "employments"),
    "work_terms": (WorkTerms, "duty_id", "work_terms"),
    "agreement": (Agreement, "agreement_id", "agreements"),
    "management_model": (ManagementModel, "model_id", "management_models"),
    "leave_policy": (LeavePolicy, "policy_id", "leave_policies"),
    "leave_account": (LeaveAccount, "account_id", "leave_accounts"),
    "leave_record": (LeaveRecord, "event_id", "leave_records"),
    "leave_obligation": (LeaveObligation, "obligation_id", "leave_obligations"),
}

SCHEMAS.update(V3_SCHEMAS)
SCHEMAS.update(ADMIN_SCHEMAS)
SCHEMAS["outside_declaration"] = (
    OutsideDeclaration,
    "declaration_id",
    "outside_declarations",
)


def entity_key(scope: str, kind: str, identity: str) -> str:
    # Annual leave is shared across departments of the same facility.
    owner = (
        scope.split("/")[0]
        if kind
        in {
            "leave_account",
            "leave_record",
            "ledger_recording",
            "grant_amendment",
            "leave_amendment",
            # A flextime adoption applies to the whole facility's establishment.
            "flex_adoption",
            "flex_enrollment",
        }
        else scope
    )
    return content_hash([owner, kind, identity])


def demand_identity(period: Any, demand_id: str) -> str:
    """Demand IDs belong to a planning window, unlike lifelong staff identities."""
    return content_hash([period, demand_id])


def save_entity(
    session: Session,
    scope: str,
    kind: str,
    payload: dict[str, Any],
    expected: int,
    actor: str,
    *,
    invalidate: bool = True,
    demand_period: dict[str, Any] | None = None,
) -> ComplianceEntity:
    if kind not in SCHEMAS:
        raise ValueError("Unsupported administrative record type")
    model, field, _ = SCHEMAS[kind]
    if kind == "employment" and "establishment_id" in payload:
        model = EmploymentV3
    if kind == "agreement" and "establishment_id" in payload:
        model = AgreementV3
    if kind == "leave_obligation" and "method" in payload:
        model = LeaveObligationV3
    parsed: Any = model.model_validate(payload)  # the checks below dispatch on `kind`
    value = parsed.model_dump(mode="json")
    if kind in {
        "grant_amendment",
        "leave_amendment",
        "ledger_recording",
    } and parsed.recorded_at > datetime.now(ZoneInfo("Asia/Tokyo")):
        raise ValueError(
            "A future recording timestamp cannot be asserted as observed evidence"
        )
    if (
        kind == "leave_amendment"
        and parsed.replacement
        and parsed.replacement.kind == "take"
        and parsed.replacement.effective_on
        > datetime.now(ZoneInfo("Asia/Tokyo")).date()
    ):
        raise ValueError("Future leave cannot be recorded as actual attainment")
    if (
        kind == "leave_record"
        and value["kind"] == "take"
        and value["effective_on"]
        > datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat()
    ):
        raise ValueError("Future leave cannot be recorded as actual attainment")
    if kind == "capability_amendment":
        target = session.get(
            ComplianceEntity, entity_key(scope, "capability", parsed.target_hash)
        )
        if not target or target.person_id != parsed.person_id:
            raise ValueError(
                "Capability original is missing or belongs to another person"
            )
        original = Capability.model_validate(target.payload)
        if not original.start <= parsed.effective_at <= original.end:
            raise ValueError("Capability amendment is outside the original interval")
    identity = str(value[field])
    if kind == "demand":
        if demand_period is None:
            raise ValueError("A verified planning period is required for demand edits")
        identity = demand_identity(demand_period, identity)
    if kind == "capability":
        identity = content_hash(value)
    key = entity_key(scope, kind, identity)
    row = session.get(ComplianceEntity, key)
    if row and row.revision != expected:
        raise Conflict("Administrative record revision mismatch")
    if row and row.person_id != value.get("person_id"):
        raise Conflict("An existing record cannot be reassigned to another person")
    if (
        kind == "agreement"
        and parsed.monthly_limit_seconds >= 100 * 3600
        and not (
            row
            and row.payload.get("monthly_limit_seconds") == parsed.monthly_limit_seconds
        )
    ):
        # A new 100h limit is refused. A stored one stays readable and editable in
        # other fields (e.g. closing it); validation keeps reporting it as a violation.
        raise ValueError("Special-clause monthly limit must be below 100 hours")
    if row and row.payload == value:
        return row
    if row:
        if kind == "capability_amendment":
            raise Conflict("Capability amendments are immutable; append a new event")
        if kind == "leave_policy" and any(
            row.payload.get(field) != value.get(field)
            for field in value
            if field not in {"end", "evidence"}
        ):
            raise Conflict(
                "Changed leave conversion rules require a new policy identity"
            )
        if kind in {
            "leave_record",
            "ledger_recording",
            "grant_amendment",
            "leave_amendment",
        }:
            raise Conflict("Leave events are immutable; append a compensating event")
        if kind == "leave_account":
            raise Conflict(
                "Grant identity/quantity is immutable; reconcile a correction"
            )
        changed = session.execute(
            update(ComplianceEntity)
            .where(ComplianceEntity.key == key, ComplianceEntity.revision == expected)
            .values(payload=value, revision=expected + 1)
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise Conflict("Administrative record changed concurrently")
        session.refresh(row)
    else:
        if expected:
            raise Conflict("Administrative record revision mismatch")
        row = ComplianceEntity(
            key=key,
            scope_id=scope,
            kind=kind,
            entity_id=identity,
            person_id=value.get("person_id"),
            revision=1,
            payload=value,
        )
        session.add(row)
        session.flush()
    session.add(
        ComplianceRevision(
            key=content_hash([key, row.revision]),
            entity_key=key,
            revision=row.revision,
            payload=value,
            actor=actor,
        )
    )
    if invalidate:
        facility = scope.split("/")[0] + "/"
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id.startswith(facility))
            .values(data_revision=PlanningScope.data_revision + 1)
        )
    emit(
        session,
        scope,
        actor,
        "compliance." + kind,
        {"key": key, "revision": row.revision},
    )
    return row


def capability_projection(
    session: Session, scope: str, values: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], set[str]]:
    originals: dict[str, Any] = {}
    variants: set[Any] = set()
    projected: list[dict[str, Any]] = []
    amendments = session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.scope_id == scope,
            ComplianceEntity.kind == "capability_amendment",
        )
    ).all()
    for row in amendments:
        amendment = CapabilityAmendment.model_validate(row.payload)
        target = session.get(
            ComplianceEntity, entity_key(scope, "capability", amendment.target_hash)
        )
        if target is None:
            raise Conflict("Capability amendment original is missing")
        cap = Capability.model_validate(target.payload)
        original, ends = originals.setdefault(amendment.target_hash, (cap, []))
        ends.append(amendment.effective_at)
    for identity, (cap, ends) in originals.items():
        variants.add(identity)
        for end in ends:
            if cap.start < end:
                variants.add(
                    content_hash(
                        cap.model_copy(update={"end": end}).model_dump(mode="json")
                    )
                )
        end = min(ends)
        if cap.start < end:
            projected.append(
                cap.model_copy(update={"end": end}).model_dump(mode="json")
            )
    result = [raw for raw in values if content_hash(raw) not in variants] + projected
    unique = {content_hash(raw): raw for raw in result}
    return list(unique.values()), {content_hash(raw) for raw in projected}


def register_snapshot(
    session: Session, snapshot: SolverSnapshotV2, actor: str, *, reserve: bool = False
) -> None:
    scope = snapshot.facility_id + "/" + snapshot.department_id
    caps = [v.model_dump(mode="json") for v in snapshot.capabilities]
    current_caps, derived_caps = capability_projection(session, scope, caps)
    if {content_hash(v) for v in current_caps} != {content_hash(v) for v in caps}:
        raise Conflict(
            "Input omits authoritative qualification withdrawal; refresh input"
        )
    # Reconcile the shared leave ledger before accepting any planning-period input.
    for kind, (_model, field, collection) in SCHEMAS.items():
        for value in getattr(snapshot, collection, ()):
            payload = value.model_dump(mode="json")
            if kind == "capability" and content_hash(payload) in derived_caps:
                continue  # A projected interval is not a second qualification original.
            identity = (
                content_hash(payload) if kind == "capability" else str(payload[field])
            )
            if kind == "demand":
                identity = demand_identity(
                    snapshot.period.model_dump(mode="json"), identity
                )
            if kind in PROCEDURE_ONLY:
                # Flextime adoption and enrolment are created and confirmed only by two
                # administrators (application/flex_adoption.py); an input may carry the
                # stored records but never create, confirm or change one.
                stored = session.scalars(
                    select(ComplianceEntity).where(
                        ComplianceEntity.kind == kind,
                        ComplianceEntity.entity_id == identity,
                        ComplianceEntity.scope_id.startswith(
                            snapshot.facility_id + "/"
                        ),
                    )
                ).all()
                if not any(row.payload == payload for row in stored):
                    raise Conflict(
                        "Flextime adoption or enrolment changed since this input; refresh the input"
                        if stored
                        else "Flextime adoptions and enrolments are registered through the facility settings"
                    )
                continue
            if kind == "outside_declaration":
                # Declarations enter only through the dedicated self-service and review
                # workflow, possibly from another department of the facility; an input
                # may carry them but never create or change one.
                stored = session.scalars(
                    select(ComplianceEntity).where(
                        ComplianceEntity.kind == kind,
                        ComplianceEntity.entity_id == identity,
                        ComplianceEntity.scope_id.startswith(
                            snapshot.facility_id + "/"
                        ),
                    )
                ).all()
                if not any(row.payload == payload for row in stored):
                    raise Conflict(
                        "Outside declarations are registered through the declaration workflow"
                    )
                continue
            existing = session.get(ComplianceEntity, entity_key(scope, kind, identity))
            if existing and existing.payload != payload:
                raise Conflict(f"Authoritative {kind} differs; refresh the input")
            if (
                kind == "leave_record"
                and payload["kind"] == "reserve"
                and not existing
                and (
                    not reserve
                    or not value.interval
                    or not snapshot.period.contains(value.interval)
                )
            ):
                continue
            save_entity(
                session,
                scope,
                kind,
                payload,
                existing.revision if existing else 0,
                actor,
                invalidate=False,
                demand_period=(
                    snapshot.period.model_dump(mode="json")
                    if kind == "demand"
                    else None
                ),
            )
    account_ids = {a.account_id for a in snapshot.leave_accounts}
    supplied = {e.event_id for e in snapshot.leave_records}
    for event in session.scalars(
        select(ComplianceEntity).where(ComplianceEntity.kind == "leave_record")
    ):
        if (
            event.scope_id.split("/")[0] == snapshot.facility_id
            and event.payload["account_id"] in account_ids
            and event.entity_id not in supplied
        ):
            raise Conflict("Input omits authoritative cross-period leave events")
    # A caller cannot bypass a corrected grant/actual by submitting an older
    # snapshot containing the original objects but omitting their corrections.
    supplied_changes = {
        "grant_amendment": {
            a.amendment_id for a in getattr(snapshot, "grant_amendments", ())
        },
        "leave_amendment": {
            a.amendment_id for a in getattr(snapshot, "leave_amendments", ())
        },
        "ledger_recording": {
            a.recording_id for a in getattr(snapshot, "ledger_recordings", ())
        },
    }
    for record in session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.kind.in_(supplied_changes),
            ComplianceEntity.scope_id.startswith(snapshot.facility_id + "/"),
        )
    ):
        value = record.payload
        relevant = (
            value.get("account_id") in account_ids
            if record.kind == "grant_amendment"
            else (
                value.get("event_id") in supplied
                if record.kind == "leave_amendment"
                else value.get("object_id")
                in (
                    account_ids
                    if value.get("object_kind") == "leave_account"
                    else supplied
                )
            )
        )
        if relevant and record.entity_id not in supplied_changes[record.kind]:
            raise Conflict(
                "Input omits authoritative leave corrections or recording evidence"
            )
    report = account_leave(snapshot, snapshot.period.start.astimezone(JST).date())
    if report["findings"]:
        raise ValueError(
            "Leave ledger did not reconcile: "
            + "; ".join(f.message for f in report["findings"])
        )


def overlay(session: Session, scope: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Explicit refresh; old immutable inputs retain their original contents and hash."""
    result = dict(payload)
    facility = scope.split("/")[0]
    person_ids = {p["person_id"] for p in payload["people"]}
    records = session.scalars(
        select(ComplianceEntity)
        .where(ComplianceEntity.scope_id.startswith(facility + "/"))
        .order_by(ComplianceEntity.created_at, ComplianceEntity.key)
    ).all()
    for kind, (_, field, collection) in SCHEMAS.items():
        if kind in ADMIN_SCHEMAS:
            continue
        if kind == "outside_declaration" and payload.get("schema_version") != 3:
            continue  # counted only by V3 accounting
        if kind in V3_SCHEMAS and payload.get("schema_version") != 3:
            continue
        if kind in {"person", "contract", "capability"}:
            relevant = [r for r in records if r.kind == kind and r.scope_id == scope]
        else:
            relevant = [
                r
                for r in records
                if r.kind == kind and (r.scope_id == scope or r.person_id in person_ids)
            ]
        if kind == "demand":
            relevant = [
                r
                for r in relevant
                if r.scope_id == scope
                and r.entity_id
                == demand_identity(payload["period"], r.payload["demand_id"])
            ]
        if kind == "leave_record":
            accounts = {a["account_id"] for a in result.get("leave_accounts", [])}
            relevant = [
                r
                for r in records
                if r.kind == kind and r.payload["account_id"] in accounts
            ]
        if kind == "ledger_recording":
            accounts = {a["account_id"] for a in result.get("leave_accounts", [])}
            events = {e["event_id"] for e in result.get("leave_records", [])}
            relevant = [
                r
                for r in records
                if r.kind == kind
                and r.payload["object_id"]
                in (accounts if r.payload["object_kind"] == "leave_account" else events)
            ]
        if kind == "flex_adoption":
            # The stored records are the authority (an input cannot create them). Only
            # adoptions within one of this input's establishments enter, so a record of
            # another site, or a site shortened later, leaves the flextime employment
            # "not adopted" instead of making the whole input invalid.
            sites = [
                (
                    x["establishment_id"],
                    x["employer_id"],
                    datetime.fromisoformat(x["start"]),
                    datetime.fromisoformat(x["end"]),
                )
                for x in result.get("establishments", [])
            ]
            # Only adoptions this input's people are enrolled in: a department with no
            # enrolled person is not touched by another department's adoption.
            contained = {
                r.entity_id
                for r in records
                if r.kind == kind
                and any(
                    (site, employer)
                    == (r.payload["establishment_id"], r.payload["employer_id"])
                    and begin <= datetime.fromisoformat(r.payload["start"])
                    and datetime.fromisoformat(r.payload["end"]) <= end
                    for site, employer, begin, end in sites
                )
            }
            enrolments = [
                r.payload
                for r in records
                if r.kind == "flex_enrollment"
                and r.person_id in person_ids
                and r.payload["adoption_id"] in contained
            ]
            used = {n["adoption_id"] for n in enrolments}
            for name, values in (
                (
                    "flex_adoptions",
                    [
                        r.payload
                        for r in records
                        if r.kind == kind and r.entity_id in used
                    ],
                ),
                ("flex_enrollments", enrolments),
            ):
                if values or name in result:  # an input without flextime keeps its form
                    result[name] = values
            continue
        if kind == "flex_enrollment":
            continue  # set together with the adoptions above
        if kind == "work_terms":
            duty_ids = {
                d["duty_id"]
                for d in (*payload.get("history", []), *payload.get("candidates", []))
            }
            relevant = [r for r in relevant if r.entity_id in duty_ids]
        if relevant:
            current = {
                content_hash(v) if kind == "capability" else v[field]: v
                for v in result.get(collection, [])
            }
            for row in relevant:
                current[
                    row.payload["demand_id"] if kind == "demand" else row.entity_id
                ] = row.payload
            result[collection] = list(current.values())
    result["capabilities"], _ = capability_projection(
        session, scope, result.get("capabilities", [])
    )
    return result


def append_leave(
    session: Session, scope: str, event: LeaveRecord, expected: int, actor: str
) -> dict[str, Any]:
    account = session.scalar(
        select(ComplianceEntity)
        .where(
            ComplianceEntity.key == entity_key(scope, "leave_account", event.account_id)
        )
        .with_for_update()
    )
    if account is None:
        raise LookupError("Leave account not found")
    existing = session.get(
        ComplianceEntity, entity_key(scope, "leave_record", event.event_id)
    )
    if existing:
        if existing.payload != event.model_dump(mode="json"):
            raise Conflict("Event ID reused with different content")
        return {
            "event_id": event.event_id,
            "duplicate": True,
            "account_revision": account.revision,
        }
    if account.revision != expected:
        raise Conflict("Shared leave balance changed")
    if (
        event.kind == "take"
        and event.effective_on > datetime.now(ZoneInfo("Asia/Tokyo")).date()
    ):
        raise ValueError("Future reservations cannot be reported as actual leave")
    row = session.scalar(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if row is None or row.payload.get("schema_version") not in {2, 3}:
        raise ValueError("A reconciled v2 input is required")
    payload = overlay(session, scope, row.payload)
    persisted_events = set(
        session.scalars(
            select(ComplianceEntity.entity_id).where(
                ComplianceEntity.kind == "leave_record",
                ComplianceEntity.scope_id.startswith(scope.split("/")[0] + "/"),
            )
        )
    )
    payload["leave_records"] = [
        e for e in payload.get("leave_records", []) if e["event_id"] in persisted_events
    ]
    from collections import Counter

    from shift_scheduler.domain.compliance import parse_snapshot_v2

    # Historical corrections may leave an acknowledged deficit in another lot.
    # Compare against the same effective-date baseline without hiding that deficit.
    baseline = account_leave(parse_snapshot_v2(payload), event.effective_on)
    payload["leave_records"] = [
        *payload.get("leave_records", []),
        event.model_dump(mode="json"),
    ]
    snapshot = parse_snapshot_v2(payload)
    checked = account_leave(snapshot, event.effective_on)
    existing_findings = Counter(
        content_hash(f.model_dump(mode="json")) for f in baseline["findings"]
    )
    new_findings = []
    for finding in checked["findings"]:
        fingerprint = content_hash(finding.model_dump(mode="json"))
        if existing_findings[fingerprint]:
            existing_findings[fingerprint] -= 1
        else:
            new_findings.append(finding)
    # A new debit cannot rely on an invalid/unverified target grant or policy,
    # even if that defect predates this event. Other lots and obligation windows
    # remain visible for HR reconciliation but do not invalidate this entitlement.
    if event.kind in {"reserve", "take"}:
        relevant = {
            event.account_id,
            event.policy_id,
            f"{account.person_id}/{account.payload['employer_id']}/{event.effective_on}",
        }
        new_findings.extend(
            f for f in checked["findings"] if relevant.intersection(f.subjects)
        )
    if new_findings:
        raise ValueError("; ".join(dict.fromkeys(f.message for f in new_findings)))
    changed = session.execute(
        update(ComplianceEntity)
        .where(
            ComplianceEntity.key == account.key, ComplianceEntity.revision == expected
        )
        .values(revision=expected + 1)
    )
    if getattr(changed, "rowcount", 0) != 1:
        raise Conflict("Shared leave balance changed concurrently")
    save_entity(session, scope, "leave_record", event.model_dump(mode="json"), 0, actor)
    return {
        "event_id": event.event_id,
        "duplicate": False,
        "account_revision": expected + 1,
        "requires_hr_reconciliation": bool(checked["findings"]),
        "preexisting_findings": [
            f.model_dump(mode="json") for f in checked["findings"]
        ],
    }


def cancel_publication_leave(
    session: Session, scope: str, publication: Any, actor: str
) -> None:
    """Compensate only this publication's still-reserved typed events."""
    from uuid import uuid4

    from shift_scheduler.domain.planning import Evidence

    ids = publication.payload.get("leave_reservation_ids", [])
    for identity in ids:
        original = session.get(
            ComplianceEntity, entity_key(scope, "leave_record", identity)
        )
        if original is None:
            raise Conflict("Published leave reservation is missing")
        related = session.scalars(
            select(ComplianceEntity).where(ComplianceEntity.kind == "leave_record")
        ).all()
        settled = [
            r
            for r in related
            if r.scope_id.split("/")[0] == scope.split("/")[0]
            and r.payload.get("related_event_id") == identity
        ]
        taken = [r for r in settled if r.payload["kind"] == "take"]
        taken_ids = {r.entity_id for r in taken}
        reversed_amount = sum(
            r.payload["quantity"]
            for r in related
            if r.scope_id.split("/")[0] == scope.split("/")[0]
            and r.payload.get("related_event_id") in taken_ids
            and r.payload["kind"] == "reverse"
        )
        consumed = sum(r.payload["quantity"] for r in taken)
        if consumed - reversed_amount > 0:
            raise Conflict(
                "Actual leave exists; reconcile the leave event before cancellation"
            )
        released = (
            sum(
                r.payload["quantity"] for r in settled if r.payload["kind"] == "release"
            )
            + consumed
        )
        payload = original.payload
        amount = payload["quantity"] - released
        if amount <= 0:
            continue
        account = session.get(
            ComplianceEntity, entity_key(scope, "leave_account", payload["account_id"])
        )
        assert account is not None
        event = LeaveRecord.model_validate(
            {
                **payload,
                "event_id": uuid4().hex,
                "kind": "release",
                "quantity": amount,
                "related_event_id": identity,
                "evidence": Evidence(
                    reference="publication-cancellation:" + publication.publication_id,
                    status="verified",
                    verified_by=actor,
                ).model_dump(mode="json"),
            }
        )
        append_leave(session, scope, event, account.revision, actor)
