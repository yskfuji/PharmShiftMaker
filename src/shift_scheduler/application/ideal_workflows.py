"""Revisioned identity, schedule-change and staff-lifecycle workflows.

Every mutation is idempotent and emits an outbox event. Schedule changes reuse
the reviewed planning validator/publisher; clients never assert legal validity.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from shift_scheduler.application import compliance, planning
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningChangeCase,
    PlanningChangeEvent,
    PlanningHead,
    PlanningInput,
    PlanningInputHead,
    PlanningPublication,
    PlanningReceipt,
    PlanningScope,
    StaffLifecycleCase,
    StaffLifecycleEvent,
)
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import Duty, Proposal, content_hash
from shift_scheduler.validation.planning import validate

# Transition tables: the single source of docs/architecture/er/ideal-states.md
# (devtools/er/states.py). tests/test_ideal_states.py checks that every case status the
# code assigns is a state here and back. Membership has no status column (row.active).
MEMBERSHIP_TRANSITIONS: tuple[tuple[str, str, str], ...] = (
    ("START", "ACTIVE", "紐付け（版1）"),
    ("ACTIVE", "ACTIVE", "役割の変更（同じ人物、版+1）"),
    ("ACTIVE", "INACTIVE", "無効化（行と履歴は残す、版+1）"),
    ("INACTIVE", "ACTIVE", "同じ人物への再紐付け（版+1）"),
)
CHANGE_TRANSITIONS: tuple[tuple[str, str, str], ...] = (
    ("START", "DRAFT", "作成時のサーバー検証に指摘あり"),
    ("START", "READY", "欠勤を作成し、サーバー検証を通過"),
    (
        "START",
        "AWAITING_CONSENT",
        "交換、または同意が有効な施設・部署で代わりのある欠勤を作成し、サーバー検証を通過",
    ),
    ("AWAITING_CONSENT", "AWAITING_CONSENT", "同意を求めた人の一部が同意"),
    ("AWAITING_CONSENT", "READY", "同意を求めた人の全員が同意"),
    (
        "READY",
        "AWAITING_INDEPENDENT_APPROVAL",
        "作成者または対象者である責任者が別担当へ承認を依頼",
    ),
    (
        "AWAITING_INDEPENDENT_APPROVAL",
        "APPROVED",
        "案件に関係しない別の責任者が再検証し、新しい公開版を作成",
    ),
    ("READY", "APPROVED", "現行の公開版に対して再検証し、新しい公開版を作成"),
    ("DRAFT", "WITHDRAWN", "作成者または責任者が取り下げ"),
    ("AWAITING_CONSENT", "WITHDRAWN", "作成者または責任者が取り下げ"),
    ("READY", "WITHDRAWN", "作成者または責任者が取り下げ"),
    (
        "AWAITING_INDEPENDENT_APPROVAL",
        "WITHDRAWN",
        "作成者または責任者が取り下げ",
    ),
    ("AWAITING_CONSENT", "DECLINED", "同意を求められた人が拒否"),
    ("READY", "REJECTED", "責任者が却下"),
    ("AWAITING_INDEPENDENT_APPROVAL", "REJECTED", "別担当の責任者が却下"),
)
LIFECYCLE_TRANSITIONS: tuple[tuple[str, str, str], ...] = (
    ("START", "IN_PROGRESS", "入職・退職のケースを作成"),
    ("IN_PROGRESS", "IN_PROGRESS", "タスクを1件完了（残りあり）"),
    ("IN_PROGRESS", "READY", "すべてのタスクが完了"),
)


def once(
    session: Session,
    scope_id: str,
    actor: str,
    operation: str,
    idempotency_key: str,
    request: object,
    action: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    planning.lock_facility(session, scope_id)
    receipt_id = content_hash([scope_id, actor, operation, idempotency_key])
    fingerprint = content_hash(request)
    receipt = session.get(PlanningReceipt, receipt_id)
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise planning.Conflict("Idempotency key reused for different contents")
        return dict(receipt.response)
    result = cast(
        dict[str, Any],
        json.loads(json.dumps(action(), ensure_ascii=False, default=_json_default)),
    )
    session.add(
        PlanningReceipt(receipt_id=receipt_id, fingerprint=fingerprint, response=result)
    )
    session.flush()
    return result


def _json_default(value: object) -> str:
    if isinstance(value, date | datetime):
        return value.isoformat()
    raise TypeError(f"Unsupported receipt value: {type(value).__name__}")


def membership_response(row: AccountMembership) -> dict[str, Any]:
    return {
        "membership_id": row.membership_id,
        "issuer": row.issuer,
        "subject": row.subject,
        "person_id": row.person_id,
        "scope_id": row.scope_id,
        "role": row.role,
        "active": row.active,
        "revision": row.revision,
        "evidence": row.evidence,
        "created_by": row.created_by,
        "created_at": row.created_at,
        "deactivated_at": row.deactivated_at,
    }


def link_membership(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    issuer: str,
    subject: str,
    person_id: str,
    role: str,
    evidence: dict[str, Any],
    expected_version: int,
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "issuer": issuer,
        "subject": subject,
        "person_id": person_id,
        "role": role,
        "evidence": evidence,
        "expected_version": expected_version,
    }

    def action() -> dict[str, Any]:
        if person_id not in scope_people(session, scope_id):
            raise ValueError("The person is not in this scope's current planning input")
        row = session.scalar(
            select(AccountMembership)
            .where(
                AccountMembership.issuer == issuer,
                AccountMembership.subject == subject,
                AccountMembership.scope_id == scope_id,
            )
            .with_for_update()
        )
        if row is None:
            if expected_version != 0:
                raise planning.Conflict("Membership revision changed")
            row = AccountMembership(
                membership_id=uuid4().hex,
                issuer=issuer,
                subject=subject,
                person_id=person_id,
                scope_id=scope_id,
                role=role,
                active=True,
                revision=1,
                evidence=evidence,
                created_by=actor,
            )
            session.add(row)
        else:
            if row.revision != expected_version:
                raise planning.Conflict("Membership revision changed")
            if row.person_id != person_id:
                # ops/reviewed-planning.md: an existing account is never re-pointed at
                # another person; identity continuity is decided outside the app.
                raise planning.Conflict(
                    "An existing account cannot be moved to another person"
                )
            row.role, row.active = role, True
            row.revision += 1
            row.evidence = {**evidence, "previous": row.evidence}
            row.deactivated_at = None
        session.flush()
        result = membership_response(row)
        planning.emit(
            session,
            scope_id,
            actor,
            "membership.linked",
            {
                "membership_id": row.membership_id,
                "person_ids": [person_id],
                "revision": row.revision,
                "evidence": evidence,
            },
        )
        return result

    return once(
        session, scope_id, actor, "membership.link", idempotency_key, request, action
    )


def scope_people(session: Session, scope_id: str) -> set[str]:
    """Staff of the scope: people of its current inputs and person records registered
    in its contract workflow (a new hire is registered there before any input has them).
    """
    from shift_scheduler.db.compliance_models import ComplianceEntity

    hashes = session.scalars(
        select(PlanningInputHead.input_hash).where(
            PlanningInputHead.scope_id == scope_id
        )
    ).all()
    people: set[str] = set(
        session.scalars(
            select(ComplianceEntity.entity_id).where(
                ComplianceEntity.scope_id == scope_id, ComplianceEntity.kind == "person"
            )
        ).all()
    )
    for input_hash in hashes:
        row = session.get(PlanningInput, input_hash)
        if row:
            people |= {p["person_id"] for p in row.payload.get("people", [])}
    return people


def deactivate_membership(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    actor_membership_id: str,
    membership_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "membership_id": membership_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(AccountMembership, membership_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Membership not found")
        if row.revision != expected_version:
            raise planning.Conflict("Membership revision changed")
        if not row.active:
            # No INACTIVE -> INACTIVE transition (MEMBERSHIP_TRANSITIONS).
            raise planning.Conflict("Membership is already inactive")
        if row.membership_id == actor_membership_id:
            raise planning.Conflict(
                "An administrator cannot deactivate their own membership"
            )
        if row.role == "ADMIN":
            active_admins = session.scalars(
                select(AccountMembership).where(
                    AccountMembership.scope_id == scope_id,
                    AccountMembership.role == "ADMIN",
                    AccountMembership.active.is_(True),
                )
            ).all()
            if len(active_admins) <= 1:
                raise planning.Conflict(
                    "The last active administrator cannot be deactivated"
                )
        row.active = False
        row.revision += 1
        row.deactivated_at = datetime.now(UTC)
        row.evidence = {**row.evidence, "deactivation": evidence}
        session.flush()
        result = membership_response(row)
        planning.emit(
            session,
            scope_id,
            actor,
            "membership.deactivated",
            {
                "membership_id": membership_id,
                "person_ids": [row.person_id],
                "revision": row.revision,
                "evidence": evidence,
            },
        )
        return result

    return once(
        session,
        scope_id,
        actor,
        "membership.deactivate",
        idempotency_key,
        request,
        action,
    )


def derive_candidates(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {"expected_version": expected_version, "evidence": evidence}

    def action() -> dict[str, Any]:
        row = session.scalar(
            select(PlanningInput)
            .where(PlanningInput.scope_id == scope_id)
            .order_by(PlanningInput.input_revision.desc())
            .limit(1)
        )
        if not row:
            raise LookupError("Planning input not found")
        # Compliance overlays are authoritative staged records. A source revision
        # bump gives the derived, validated candidate catalogue a new immutable hash.
        if row.payload.get("schema_version", 1) < 2:
            raise planning.Conflict(
                "Compliance records apply only to version 2 or later inputs"
            )
        from shift_scheduler.application.compliance import overlay
        from shift_scheduler.domain.candidate_generation import generate_catalogue
        from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

        payload = overlay(session, scope_id, row.payload)
        snapshot = parse_snapshot(payload)
        if isinstance(snapshot, SolverSnapshotV3):
            # V3 candidates are a complete enumeration of the approved duty
            # templates and employment relationships. Reusing an imported
            # catalogue would make "derive" a revision bump rather than a
            # server-side derivation, and the fail-closed validator correctly
            # rejects such a mismatch.
            catalogue = generate_catalogue(snapshot)
            fixed_history = {duty.duty_id for duty in snapshot.history}
            candidates = [
                duty
                for duty in catalogue["candidates"]
                if duty["duty_id"] not in fixed_history
            ]
            generated_terms = {
                term["duty_id"]: term for term in catalogue["work_terms"]
            }
            # Published/history duties stay fixed but still require their
            # explicit work classification. Preserve a prior classification
            # only when the approved catalogue does not enumerate that duty.
            for term in snapshot.work_terms:
                if (
                    term.duty_id in fixed_history
                    and term.duty_id not in generated_terms
                ):
                    generated_terms[term.duty_id] = term.model_dump(mode="json")
            payload = snapshot.model_dump(mode="json")
            payload.update(
                source_revision=snapshot.source_revision + 1,
                candidates=candidates,
                work_terms=list(generated_terms.values()),
            )
            snapshot = parse_snapshot(payload)
        else:
            snapshot = snapshot.model_copy(
                update={"source_revision": snapshot.source_revision + 1}
            )
        result = planning.register_input(session, snapshot, actor, expected_version)
        planning.emit(
            session,
            scope_id,
            actor,
            "candidates.derived",
            {
                **result,
                "source_input_hash": row.input_hash,
                "evidence": evidence,
            },
        )
        return {**result, "source_input_hash": row.input_hash}

    return once(
        session, scope_id, actor, "candidates.derive", idempotency_key, request, action
    )


def change_response(row: PlanningChangeCase) -> dict[str, Any]:
    return {
        name: getattr(row, name)
        for name in (
            "case_id",
            "scope_id",
            "publication_id",
            "kind",
            "status",
            "version",
            "affected_assignments",
            "proposed_assignments",
            "validation",
            "evidence",
            "created_by",
            "created_at",
            "updated_at",
        )
    }


def merged_assignment_ids(
    published_assignments: list[dict[str, Any]],
    affected_assignment_ids: list[str],
    replacement_assignment_ids: list[str],
) -> tuple[str, ...]:
    """Build a complete proposed schedule without dropping unaffected duties."""
    if len(set(affected_assignment_ids)) != len(affected_assignment_ids):
        raise ValueError("Duplicate affected assignment")
    if len(set(replacement_assignment_ids)) != len(replacement_assignment_ids):
        raise ValueError("Duplicate replacement assignment")
    published_ids = [item["duty_id"] for item in published_assignments]
    missing = set(affected_assignment_ids) - set(published_ids)
    if missing:
        raise ValueError(f"Unknown affected duties: {sorted(missing)}")
    affected = set(affected_assignment_ids)
    return tuple(
        [item for item in published_ids if item not in affected]
        + replacement_assignment_ids
    )


ABSENCE_CONSENT = "absence_replacement_consent"


def absence_consent_policy(session: Session, scope_id: str) -> dict[str, Any]:
    """Whether an absence needs the replacement's consent in this scope (default: no)."""
    row = session.get(
        ComplianceEntity,
        compliance.entity_key(scope_id, "scope_setting", ABSENCE_CONSENT),
    )
    if row is None:
        return {"setting_id": ABSENCE_CONSENT, "enabled": False, "revision": 0}
    return {
        "setting_id": ABSENCE_CONSENT,
        "enabled": bool(row.payload["enabled"]),
        "revision": row.revision,
    }


def set_absence_consent(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    enabled: bool,
    evidence: dict[str, Any],
    expected_version: int,
    idempotency_key: str,
) -> dict[str, Any]:
    """Switch the absence consent setting. Planning inputs stay current (no invalidation):
    the setting is not a solver input, it only decides how new cases are opened."""
    request = {
        "enabled": enabled,
        "evidence": evidence,
        "expected_version": expected_version,
    }

    def action() -> dict[str, Any]:
        payload = {
            "setting_id": ABSENCE_CONSENT,
            "enabled": enabled,
            "reason": evidence["reason"],
            "evidence": {"reference": evidence["reference"]},
        }
        compliance.save_entity(
            session,
            scope_id,
            "scope_setting",
            payload,
            expected_version,
            actor,
            invalidate=False,
        )
        return absence_consent_policy(session, scope_id)

    return once(
        session,
        scope_id,
        actor,
        "scope-setting.absence-consent",
        idempotency_key,
        request,
        action,
    )


def absence_consent_history(session: Session, scope_id: str) -> list[dict[str, Any]]:
    """Every recorded revision of the setting, oldest first (for administrators)."""
    from shift_scheduler.db.compliance_models import ComplianceRevision

    key = compliance.entity_key(scope_id, "scope_setting", ABSENCE_CONSENT)
    rows = session.scalars(
        select(ComplianceRevision)
        .where(ComplianceRevision.entity_key == key)
        .order_by(ComplianceRevision.revision)
    ).all()
    return [
        {
            "revision": row.revision,
            "enabled": bool(row.payload["enabled"]),
            "reason": row.payload["reason"],
            "reference": row.payload["evidence"]["reference"],
            "actor": row.actor,
            "at": row.created_at,
        }
        for row in rows
    ]


OPTION_LIMIT = 20


def change_options(
    session: Session,
    publication: PlanningPublication,
    duty_id: str,
    kind: str,
    *,
    planner: bool,
) -> dict[str, Any]:
    """Replacements (ABSENCE) or exchanges (SWAP) for one published duty, each checked
    by the server validation as the case it would open.

    ABSENCE: another person's candidate duty at exactly the same time, for someone with
    no published duty overlapping it. SWAP: another person's published duty B such that
    they can take this duty's time and the duty's owner can take B's time. At most
    OPTION_LIMIT options, nearest first, are validated. A pharmacist (planner=False) is
    told the counterpart's name and the one duty concerned, not the findings.
    """
    assignments = publication.payload["assignments"]
    duty = next((d for d in assignments if d["duty_id"] == duty_id), None)
    if duty is None:
        raise LookupError("Duty not found in this publication")
    source = session.get(PlanningInput, publication.payload["input_hash"])
    if not source:
        raise planning.Conflict("Published input is unavailable")
    snapshot = parse_snapshot(source.payload)
    names = {p.person_id: p.name for p in snapshot.people}
    start = datetime.fromisoformat(duty["start"])
    end = datetime.fromisoformat(duty["end"])

    def busy(person: str, a: datetime, b: datetime, ignore: set[str]) -> bool:
        return any(
            d["person_id"] == person
            and d["duty_id"] not in ignore
            and datetime.fromisoformat(d["start"]) < b
            and a < datetime.fromisoformat(d["end"])
            for d in assignments
        )

    def at(person: str, a: datetime, b: datetime) -> Duty | None:
        return next(
            (
                c
                for c in snapshot.candidates
                if c.person_id == person and c.start == a and c.end == b
            ),
            None,
        )

    raw: list[tuple[float, list[str], list[str], str, dict[str, Any]]] = []
    if kind == "ABSENCE":
        for c in snapshot.candidates:
            if (
                c.person_id != duty["person_id"]
                and c.start == start
                and c.end == end
                and not busy(c.person_id, start, end, set())
            ):
                shown = c.model_dump(mode="json")
                raw.append((0.0, [duty_id], [c.duty_id], c.person_id, shown))
    else:
        for other in assignments:
            person = other["person_id"]
            if person == duty["person_id"]:
                continue
            o_start = datetime.fromisoformat(other["start"])
            o_end = datetime.fromisoformat(other["end"])
            theirs = at(person, start, end)
            mine = at(duty["person_id"], o_start, o_end)
            ignore = {duty_id, other["duty_id"]}
            if (
                theirs
                and mine
                and not busy(person, start, end, ignore)
                and not busy(duty["person_id"], o_start, o_end, ignore)
            ):
                distance = abs((o_start - start).total_seconds())
                raw.append(
                    (
                        distance,
                        [duty_id, other["duty_id"]],
                        [theirs.duty_id, mine.duty_id],
                        person,
                        other,
                    )
                )
    raw.sort(key=lambda item: (item[0], item[3], item[2]))
    options = []
    for _distance, affected, proposed, person, shown in raw[:OPTION_LIMIT]:
        final_ids = merged_assignment_ids(assignments, affected, proposed)
        report = validate(snapshot, Proposal(duty_ids=final_ids))
        options.append(
            {
                "option_id": content_hash([affected, proposed]),
                "affected_assignment_ids": affected,
                "proposed_assignment_ids": proposed,
                "counterpart": {"person_id": person, "display_name": names.get(person)},
                "duty": {
                    name: shown[name]
                    for name in ("start", "end", "kind", "task", "location")
                },
                "publishable": report.publishable,
                "finding_count": len(report.findings) if planner else None,
            }
        )
    return {
        "publication_id": publication.publication_id,
        "publication_version": publication.version,
        "duty_id": duty_id,
        "kind": kind,
        "options": options,
    }


def create_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    publication_id: str,
    kind: str,
    affected_assignment_ids: list[str],
    proposed_assignment_ids: list[str],
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "publication_id": publication_id,
        "kind": kind,
        "affected_assignment_ids": affected_assignment_ids,
        "proposed_assignment_ids": proposed_assignment_ids,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        publication = session.get(PlanningPublication, publication_id)
        if not publication or publication.scope_id != scope_id:
            raise LookupError("Publication not found")
        source = session.get(PlanningInput, publication.payload["input_hash"])
        if not source:
            raise planning.Conflict("Published input is unavailable")
        snapshot = parse_snapshot(source.payload)
        candidates = {d.duty_id: d for d in snapshot.candidates}
        missing = set(proposed_assignment_ids) - set(candidates)
        if missing:
            raise ValueError(f"Unknown candidate duties: {sorted(missing)}")
        final_ids = merged_assignment_ids(
            publication.payload["assignments"],
            affected_assignment_ids,
            proposed_assignment_ids,
        )
        report = validate(snapshot, Proposal(duty_ids=final_ids))
        proposed = [candidates[item].model_dump(mode="json") for item in final_ids]
        affected = [
            item
            for item in publication.payload["assignments"]
            if item["duty_id"] in set(affected_assignment_ids)
        ]
        replacements = [
            candidates[item].model_dump(mode="json") for item in proposed_assignment_ids
        ]
        if kind == "ABSENCE" and {d["person_id"] for d in replacements} & {
            d["person_id"] for d in affected
        }:
            raise ValueError("An absent person cannot be their own replacement")
        involved = sorted({item["person_id"] for item in affected + replacements})
        # The policy in force when the case is opened decides it; a later switch does
        # not change open cases.
        policy = absence_consent_policy(session, scope_id)
        if kind == "SWAP":
            required = involved
        elif policy["enabled"]:
            # Everyone put on a replacement duty, including a person who is absent from
            # another duty of the same case: covering a duty is its own agreement.
            required = sorted({item["person_id"] for item in replacements})
        else:
            required = []
        validation = {
            **report.model_dump(mode="json"),
            "required_consent_person_ids": required,
            "consented_person_ids": [],
            "replacement_duty_ids": list(proposed_assignment_ids),
            "involved_person_ids": involved,
            "consent_policy": policy,
        }
        status = (
            "DRAFT"
            if not report.publishable
            else ("AWAITING_CONSENT" if required else "READY")
        )
        row = PlanningChangeCase(
            case_id=uuid4().hex,
            scope_id=scope_id,
            publication_id=publication_id,
            kind=kind,
            status=status,
            version=1,
            affected_assignments=affected,
            proposed_assignments=proposed,
            validation=validation,
            evidence=evidence,
            created_by=actor,
        )
        session.add(row)
        session.flush()
        planning.emit(
            session,
            scope_id,
            actor,
            f"change.{kind.lower()}.created",
            {
                "case_id": row.case_id,
                "person_ids": sorted({d["person_id"] for d in affected + proposed}),
                "publishable": report.publishable,
                "evidence": evidence,
            },
        )
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=row.case_id,
                kind="CREATED",
                actor=actor,
                evidence=evidence,
            )
        )
        return change_response(row)

    return once(
        session, scope_id, actor, "change.create", idempotency_key, request, action
    )


def consent_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    person_id: str,
    case_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "case_id": case_id,
        "person_id": person_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if row.status != "AWAITING_CONSENT" or row.version != expected_version:
            raise planning.Conflict("Change case revision or status changed")
        validation = dict(row.validation or {})
        required = set(validation.get("required_consent_person_ids", []))
        if person_id not in required:
            raise ValueError("Consent subject is not asked to consent to this change")
        consented = set(validation.get("consented_person_ids", []))
        consented.add(person_id)
        validation["consented_person_ids"] = sorted(consented)
        status = "READY" if required <= consented else "AWAITING_CONSENT"
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status == "AWAITING_CONSENT",
            )
            .values(
                status=status,
                version=expected_version + 1,
                validation=validation,
                updated_at=datetime.now(UTC),
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during consent")
        recorded = {**evidence, "person_id": person_id}
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="CONSENTED",
                actor=actor,
                evidence=recorded,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            f"change.{row.kind.lower()}.consented",
            {
                "case_id": case_id,
                "person_ids": [person_id],
                "status": status,
                "evidence": evidence,
            },
        )
        session.flush()
        session.refresh(row)
        return change_response(row)

    return once(
        session, scope_id, actor, "change.consent", idempotency_key, request, action
    )


def withdraw_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    case_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    """Close an open case without publishing it. Who may withdraw is decided by the
    route (its creator, or a planner)."""
    request = {
        "case_id": case_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if (
            row.status
            not in (
                "DRAFT",
                "AWAITING_CONSENT",
                "READY",
                "AWAITING_INDEPENDENT_APPROVAL",
            )
            or row.version != expected_version
        ):
            raise planning.Conflict("Change case revision or status changed")
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status.in_(
                    (
                        "DRAFT",
                        "AWAITING_CONSENT",
                        "READY",
                        "AWAITING_INDEPENDENT_APPROVAL",
                    )
                ),
            )
            .values(
                status="WITHDRAWN",
                version=expected_version + 1,
                updated_at=datetime.now(UTC),
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during withdrawal")
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="WITHDRAWN",
                actor=actor,
                evidence=evidence,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            "change.withdrawn",
            {
                "case_id": case_id,
                "person_ids": sorted(involved_person_ids(session, row)),
            },
        )
        session.flush()
        session.refresh(row)
        return change_response(row)

    return once(
        session, scope_id, actor, "change.withdraw", idempotency_key, request, action
    )


def decline_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    person_id: str,
    case_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    """A person asked to consent refuses: the case closes without publishing."""
    request = {
        "case_id": case_id,
        "person_id": person_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if row.status != "AWAITING_CONSENT" or row.version != expected_version:
            raise planning.Conflict("Change case revision or status changed")
        validation = row.validation or {}
        required = set(validation.get("required_consent_person_ids", []))
        if person_id not in required:
            raise ValueError("Consent subject is not asked to consent to this change")
        if person_id in set(validation.get("consented_person_ids", [])):
            # A given consent stands; the case can still be withdrawn by its creator
            # or a planner.
            raise planning.Conflict(
                "Consent already given; ask for the case to be withdrawn"
            )
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status == "AWAITING_CONSENT",
            )
            .values(
                status="DECLINED",
                version=expected_version + 1,
                updated_at=datetime.now(UTC),
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during the refusal")
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="DECLINED",
                actor=actor,
                evidence={**evidence, "person_id": person_id},
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            f"change.{row.kind.lower()}.declined",
            {"case_id": case_id, "person_ids": [person_id]},
        )
        session.flush()
        session.refresh(row)
        return change_response(row)

    return once(
        session, scope_id, actor, "change.decline", idempotency_key, request, action
    )


def replacement_duty_ids(session: Session, row: PlanningChangeCase) -> list[str]:
    """The duties a case adds. Recorded at creation; derived for cases opened before that."""
    recorded = (row.validation or {}).get("replacement_duty_ids")
    if recorded is not None:
        return list(recorded)
    publication = session.get(PlanningPublication, row.publication_id)
    published = (
        {d["duty_id"] for d in publication.payload["assignments"]}
        if publication
        else set()
    )
    return [
        d["duty_id"] for d in row.proposed_assignments if d["duty_id"] not in published
    ]


def involved_person_ids(session: Session, row: PlanningChangeCase) -> set[str]:
    """People whose own duties a case removes or adds (not everyone in the merged roster)."""
    recorded = (row.validation or {}).get("involved_person_ids")
    if recorded is not None:
        return set(recorded)
    added = set(replacement_duty_ids(session, row))
    return {d["person_id"] for d in row.affected_assignments} | {
        d["person_id"] for d in row.proposed_assignments if d["duty_id"] in added
    }


def actor_is_related(
    session: Session,
    row: PlanningChangeCase,
    *,
    actor: str,
    actor_person_id: str,
) -> bool:
    """Whether the actor must not make the final publication decision."""
    return row.created_by == actor or actor_person_id in involved_person_ids(
        session, row
    )


def recommend_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    actor_person_id: str,
    case_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "case_id": case_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if row.version != expected_version or row.status != "READY":
            raise planning.Conflict("Change case revision or status changed")
        if not actor_is_related(
            session, row, actor=actor, actor_person_id=actor_person_id
        ):
            raise ValueError("An unrelated planner may approve directly")
        now = datetime.now(UTC)
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status == "READY",
            )
            .values(
                status="AWAITING_INDEPENDENT_APPROVAL",
                version=expected_version + 1,
                updated_at=now,
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during recommendation")
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="RECOMMENDED",
                actor=actor,
                evidence=evidence,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            "change.recommended",
            {
                "case_id": case_id,
                "person_ids": sorted(involved_person_ids(session, row)),
                "evidence": evidence,
            },
        )
        session.flush()
        session.refresh(row)
        return change_response(row)

    return once(
        session, scope_id, actor, "change.recommend", idempotency_key, request, action
    )


def reject_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    case_id: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "case_id": case_id,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if row.version != expected_version or row.status not in (
            "READY",
            "AWAITING_INDEPENDENT_APPROVAL",
        ):
            raise planning.Conflict("Change case revision or status changed")
        previous = row.status
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status == previous,
            )
            .values(
                status="REJECTED",
                version=expected_version + 1,
                updated_at=datetime.now(UTC),
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during rejection")
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="REJECTED",
                actor=actor,
                evidence=evidence,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            "change.rejected",
            {
                "case_id": case_id,
                "person_ids": sorted(involved_person_ids(session, row)),
                "evidence": evidence,
            },
        )
        session.flush()
        session.refresh(row)
        return change_response(row)

    return once(
        session, scope_id, actor, "change.reject", idempotency_key, request, action
    )


def approve_change_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    actor_person_id: str,
    case_id: str,
    expected_version: int,
    expected_publication_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    """Publish a READY case as a replacement of the publication it was opened against.

    The case must still be based on the current publication of its period; otherwise a
    later change would be silently dropped. The replacement follows the reviewed path:
    refresh the input from current commitments, then draft, review and publish anew.
    """
    request = {
        "case_id": case_id,
        "expected_version": expected_version,
        "expected_publication_version": expected_publication_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(PlanningChangeCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Change case not found")
        if row.version != expected_version or row.status not in (
            "READY",
            "AWAITING_INDEPENDENT_APPROVAL",
        ):
            raise planning.Conflict("Change case revision or status changed")
        if actor_is_related(session, row, actor=actor, actor_person_id=actor_person_id):
            raise planning.Conflict(
                "A creator or affected person cannot make the final approval"
            )
        previous_status = row.status
        source_publication = session.get(PlanningPublication, row.publication_id)
        if not source_publication:
            raise planning.Conflict("Source publication is unavailable")
        head = session.get(
            PlanningHead, content_hash([scope_id, source_publication.period_key])
        )
        if not head or head.publication_id != row.publication_id:
            raise planning.Conflict(
                "The published schedule changed after this case was opened; open it again"
            )
        if head.version != expected_publication_version:
            raise planning.Conflict("Publication version changed")
        input_head = session.get(
            PlanningInputHead, content_hash([scope_id, source_publication.period_key])
        )
        scope = session.get(PlanningScope, scope_id)
        if not input_head or not scope:
            raise planning.Conflict("Current planning input is unavailable")
        refreshed = planning.refresh_input(
            session,
            scope_id,
            actor,
            scope.input_revision,
            input_hash=input_head.input_hash,
        )
        source = planning.require_input(session, refreshed["input_hash"], scope_id)
        snapshot = parse_snapshot(source.payload)
        added = replacement_duty_ids(session, row)
        missing = set(added) - {d.duty_id for d in snapshot.candidates}
        if missing:
            raise planning.Conflict(
                f"Replacement duties are no longer candidates: {sorted(missing)}"
            )
        proposal = Proposal(
            duty_ids=merged_assignment_ids(
                source_publication.payload["assignments"],
                [d["duty_id"] for d in row.affected_assignments],
                added,
            )
        )
        report = validate(snapshot, proposal)
        if not report.publishable:
            raise planning.Blocked("Schedule change no longer passes server validation")
        draft = planning.new_draft(session, source, proposal, actor)
        session.flush()
        reviewed = planning.review_draft(session, draft.draft_id, scope_id, 1, actor)
        if not reviewed["review_hash"]:
            raise planning.Blocked("Schedule change review is not publishable")
        published = planning.publish(
            session,
            draft.draft_id,
            scope_id,
            actor,
            1,
            expected_publication_version,
            source.input_hash,
            reviewed["review_hash"],
            f"change-publish-{case_id}-{expected_version}",
        )
        changed = session.execute(
            update(PlanningChangeCase)
            .where(
                PlanningChangeCase.case_id == case_id,
                PlanningChangeCase.version == expected_version,
                PlanningChangeCase.status == previous_status,
            )
            .values(
                status="APPROVED",
                version=expected_version + 1,
                updated_at=datetime.now(UTC),
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Change case changed during approval")
        session.add(
            PlanningChangeEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="APPROVED",
                actor=actor,
                evidence={**evidence, "publication_id": published["publication_id"]},
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            "change.approved",
            {
                "case_id": case_id,
                "publication_id": published["publication_id"],
                "version": published["version"],
                "person_ids": sorted(involved_person_ids(session, row)),
                "evidence": evidence,
            },
        )
        return {**published, "case_id": case_id, "case_version": expected_version + 1}

    return once(
        session, scope_id, actor, "change.approve", idempotency_key, request, action
    )


DEFAULT_TASKS = {
    "ONBOARD": ["contract", "qualification", "membership", "candidate_generation"],
    "OFFBOARD": [
        "contract_end",
        "candidate_exclusion",
        "balance_review",
        "membership_deactivation",
    ],
}

MANUAL_LIFECYCLE_TASKS = {"balance_review"}


def _person_entities(
    session: Session, scope_id: str, person_id: str, kind: str
) -> list[ComplianceEntity]:
    rows = session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.scope_id == scope_id,
            ComplianceEntity.kind == kind,
        )
    ).all()
    return [row for row in rows if row.payload.get("person_id") == person_id]


def lifecycle_task_state(
    session: Session, row: StaffLifecycleCase, stored: dict[str, Any]
) -> dict[str, Any]:
    """Project a task from authoritative records; only attestations are manual."""
    key = str(stored["key"])
    source = "ATTESTATION" if key in MANUAL_LIFECYCLE_TASKS else "SYSTEM"
    satisfied_by: list[str] = []
    if source == "ATTESTATION":
        complete = stored.get("status") == "COMPLETED"
        if complete:
            satisfied_by = [f"lifecycle-event:{key}"]
    elif key in {"contract", "contract_end"}:
        contracts = _person_entities(session, row.scope_id, row.person_id, "contract")
        if key == "contract":
            complete = bool(contracts)
            satisfied_by = [f"compliance:{item.key}" for item in contracts]
        else:
            dated = [item for item in contracts if item.payload.get("end")]
            complete = bool(dated) and all(
                str(item.payload["end"])[:10] <= row.effective_date.isoformat()
                for item in dated
            )
            if complete:
                satisfied_by = [f"compliance:{item.key}" for item in dated]
    elif key == "qualification":
        capabilities = _person_entities(
            session, row.scope_id, row.person_id, "capability"
        )
        complete = bool(capabilities)
        satisfied_by = [f"compliance:{item.key}" for item in capabilities]
    elif key in {"membership", "membership_deactivation"}:
        memberships = session.scalars(
            select(AccountMembership).where(
                AccountMembership.scope_id == row.scope_id,
                AccountMembership.person_id == row.person_id,
            )
        ).all()
        active = [item for item in memberships if item.active]
        complete = bool(active) if key == "membership" else not active
        selected = active if key == "membership" else memberships
        satisfied_by = [f"membership:{item.membership_id}" for item in selected]
    elif key in {"candidate_generation", "candidate_exclusion"}:
        planning_input = session.scalar(
            select(PlanningInput)
            .where(PlanningInput.scope_id == row.scope_id)
            .order_by(PlanningInput.input_revision.desc())
            .limit(1)
        )
        candidates = (
            planning_input.payload.get("candidates", []) if planning_input else []
        )
        included = any(item.get("person_id") == row.person_id for item in candidates)
        complete = (
            included
            if key == "candidate_generation"
            else bool(planning_input) and not included
        )
        if complete and planning_input:
            satisfied_by = [f"planning-input:{planning_input.input_hash}"]
    else:  # guarded by the task template, fail closed if it drifts
        complete = False

    return {
        "key": key,
        "source": source,
        "status": "COMPLETED" if complete else "NOT_STARTED",
        "completed_at": stored.get("completed_at") if source == "ATTESTATION" else None,
        "satisfied_by": satisfied_by,
        "can_complete": source == "ATTESTATION" and not complete,
        "blocked_reason": (
            None
            if complete or source == "ATTESTATION"
            else "対応する正本の登録・確定が必要です。"
        ),
    }


def lifecycle_response(
    row: StaffLifecycleCase, session: Session | None = None
) -> dict[str, Any]:
    response = {
        name: getattr(row, name)
        for name in (
            "case_id",
            "scope_id",
            "person_id",
            "kind",
            "effective_date",
            "status",
            "version",
            "tasks",
            "evidence",
            "created_by",
            "created_at",
            "updated_at",
        )
    }
    if session is not None:
        tasks = [lifecycle_task_state(session, row, item) for item in row.tasks]
        response["tasks"] = tasks
        response["status"] = (
            "READY"
            if tasks and all(item["status"] == "COMPLETED" for item in tasks)
            else "IN_PROGRESS"
        )
    return response


def create_lifecycle_case(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    person_id: str,
    kind: str,
    effective_date: date,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "person_id": person_id,
        "kind": kind,
        "effective_date": effective_date.isoformat(),
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        tasks = [
            {
                "key": key,
                "source": "ATTESTATION" if key in MANUAL_LIFECYCLE_TASKS else "SYSTEM",
                "status": "NOT_STARTED",
                "completed_at": None,
            }
            for key in DEFAULT_TASKS[kind]
        ]
        row = StaffLifecycleCase(
            case_id=uuid4().hex,
            scope_id=scope_id,
            person_id=person_id,
            kind=kind,
            effective_date=effective_date,
            status="IN_PROGRESS",
            version=1,
            tasks=tasks,
            evidence=evidence,
            created_by=actor,
        )
        session.add(row)
        session.flush()
        session.add(
            StaffLifecycleEvent(
                event_id=uuid4().hex,
                case_id=row.case_id,
                kind="CREATED",
                task_key=None,
                actor=actor,
                evidence=evidence,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            f"lifecycle.{kind.lower()}.created",
            {"case_id": row.case_id, "person_ids": [person_id], "evidence": evidence},
        )
        return lifecycle_response(row, session)

    return once(
        session, scope_id, actor, "lifecycle.create", idempotency_key, request, action
    )


def complete_lifecycle_task(
    session: Session,
    *,
    scope_id: str,
    actor: str,
    case_id: str,
    task_key: str,
    expected_version: int,
    evidence: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    request = {
        "case_id": case_id,
        "task_key": task_key,
        "expected_version": expected_version,
        "evidence": evidence,
    }

    def action() -> dict[str, Any]:
        row = session.get(StaffLifecycleCase, case_id)
        if not row or row.scope_id != scope_id:
            raise LookupError("Lifecycle case not found")
        if row.version != expected_version:
            raise planning.Conflict("Lifecycle case revision changed")
        if task_key not in {t["key"] for t in row.tasks}:
            raise ValueError("Unknown lifecycle task")
        if task_key not in MANUAL_LIFECYCLE_TASKS:
            raise ValueError(
                "System-backed lifecycle tasks are completed by their authoritative record"
            )
        if any(t["key"] == task_key and t["status"] == "COMPLETED" for t in row.tasks):
            # A completed task stays completed: no READY -> READY (LIFECYCLE_TRANSITIONS).
            raise planning.Conflict("Lifecycle task already completed")
        now = datetime.now(UTC)
        tasks = [
            (
                {
                    **task,
                    "status": "COMPLETED",
                    "completed_at": now.isoformat(),
                    "evidence": evidence,
                }
                if task["key"] == task_key
                else task
            )
            for task in row.tasks
        ]
        status = (
            "READY" if all(t["status"] == "COMPLETED" for t in tasks) else "IN_PROGRESS"
        )
        changed = session.execute(
            update(StaffLifecycleCase)
            .where(
                StaffLifecycleCase.case_id == case_id,
                StaffLifecycleCase.version == expected_version,
            )
            .values(
                tasks=tasks, status=status, version=expected_version + 1, updated_at=now
            )
        )
        if getattr(changed, "rowcount", 0) != 1:
            raise planning.Conflict("Lifecycle case changed concurrently")
        session.add(
            StaffLifecycleEvent(
                event_id=uuid4().hex,
                case_id=case_id,
                kind="TASK_COMPLETED",
                task_key=task_key,
                actor=actor,
                evidence=evidence,
            )
        )
        planning.emit(
            session,
            scope_id,
            actor,
            "lifecycle.task.completed",
            {
                "case_id": case_id,
                "person_ids": [row.person_id],
                "task_key": task_key,
                "status": status,
                "evidence": evidence,
            },
        )
        session.flush()
        session.refresh(row)
        return lifecycle_response(row, session)

    return once(
        session,
        scope_id,
        actor,
        "lifecycle.task.complete",
        idempotency_key,
        request,
        action,
    )
