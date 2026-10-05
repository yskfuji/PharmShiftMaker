"""Administrative workflows with typed schemas, scoped identity and idempotent writes."""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal, Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import Field, ValidationError
from sqlalchemy import select

from shift_scheduler.api.routers.planning import (
    DB,
    RequestModel,
    Scope,
    User,
    access,
    memberships,
)
from shift_scheduler.application import compliance as service
from shift_scheduler.application import flex_adoption, privacy
from shift_scheduler.application.hashed_types import Coverage
from shift_scheduler.application.planning import Conflict, lock_facility
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    LegalHold,
    PrivacyCase,
    RetentionRule,
)
from shift_scheduler.db.planning_models import PlanningInput, PlanningReceipt
from shift_scheduler.domain.compliance import (
    LeaveRecord,
    SolverSnapshotV2,
    parse_snapshot,
    parse_snapshot_v2,
)
from shift_scheduler.domain.planning import Finding, content_hash
from shift_scheduler.domain.privacy import (
    PrivacyDecision,
    PrivacyRequest,
    RetentionPolicy,
)
from shift_scheduler.validation.leave_accounting import account_leave

router = APIRouter(prefix="/planning/compliance", tags=["compliance"])


class Mutation(RequestModel):
    expected_revision: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=128)
    payload: dict[str, Any]


class DemandMutation(Mutation):
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class GrantAssessmentMutation(Mutation):
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class IdempotentRequest(Protocol):
    """What `once` needs: an idempotency key and a canonical dump of the request."""

    @property
    def idempotency_key(self) -> str: ...

    def model_dump(self, *, mode: str = ...) -> dict[str, Any]: ...


def once(
    session: Any,
    scope: str,
    actor: str,
    operation: str,
    request: IdempotentRequest,
    action: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    lock_facility(session, scope)
    key = content_hash([scope, actor, operation, request.idempotency_key])
    fingerprint = content_hash(request.model_dump(mode="json"))
    old = session.get(PlanningReceipt, key)
    if old:
        if old.fingerprint != fingerprint:
            raise Conflict("Idempotency key reused for different contents")
        return dict(old.response)
    result = action()
    session.add(
        PlanningReceipt(receipt_id=key, fingerprint=fingerprint, response=result)
    )
    session.flush()
    return dict(result)


def staged_payload(
    session: Any, scope: str, input_hash: str | None = None
) -> dict[str, Any]:
    """Editable records are not a validated solver input.

    An incomplete cross-record edit must remain repairable. Consumers that
    calculate or publish must continue using latest_v2/refresh validation.
    """
    query = select(PlanningInput).where(PlanningInput.scope_id == scope)
    if input_hash is not None:
        query = query.where(PlanningInput.input_hash == input_hash)
    row = session.scalar(query.order_by(PlanningInput.input_revision.desc()).limit(1))
    if not row or row.payload.get("schema_version") not in {2, 3}:
        raise HTTPException(
            409, "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。"
        )
    original = parse_snapshot(row.payload)
    if original.input_hash != row.input_hash:
        raise Conflict("Stored input integrity mismatch")
    return service.overlay(session, scope, row.payload)


def latest_v2(session: Any, scope: str) -> SolverSnapshotV2:
    return parse_snapshot_v2(
        staged_payload(session, scope)
    )  # staged_payload admits only V2/V3


@router.get("/schemas")
def schemas(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    result = {
        key: model.model_json_schema() for key, (model, _, _) in service.SCHEMAS.items()
    }
    from shift_scheduler.domain.copies import CopyRegistration

    result["copy_registration"] = CopyRegistration.model_json_schema()
    row = session.scalar(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if row and row.payload.get("schema_version") == 3:
        from shift_scheduler.domain.compliance_v3 import (
            AgreementV3,
            EmploymentV3,
            LeaveObligationV3,
        )

        result.update(
            employment=EmploymentV3.model_json_schema(),
            agreement=AgreementV3.model_json_schema(),
            leave_obligation=LeaveObligationV3.model_json_schema(),
        )
    from shift_scheduler.api.routers.planning import ActualRequest

    result["actual_event"] = ActualRequest.model_json_schema()
    result.update(
        retention_rule=RetentionPolicy.model_json_schema(),
        privacy_request=PrivacyRequest.model_json_schema(),
        privacy_decision=PrivacyDecision.model_json_schema(),
    )
    return result


@router.get("/storage-coverage", response_model=None)
def storage_coverage(scope_id: Scope, session: DB, user: User) -> Coverage:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    from shift_scheduler.application.copy_coverage import coverage

    return coverage(session, scope_id)


@router.get("/recovery-status", response_model=None)
def recovery_status(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    from shift_scheduler.db.compliance_models import RestoreGate

    gate = session.get(RestoreGate, "restore")
    return {
        "state": gate.state if gate else "NO_RESTORE_RECORDED",
        "manifest_hash": gate.marker_manifest_hash if gate else None,
        "operator_only": True,
        "note": "復元操作は独立した制御台帳を使う運用CLIで実施します。接続遮断中は運用側の記録を確認してください。",
    }


@router.get("/rule-impact/{review_id}", response_model=None)
def rule_impact(
    review_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    """Read-only list of what an earlier rule decided within a revised rule's interval."""
    access(session, user, scope_id, admin=True)
    from shift_scheduler.application.rule_impact import rule_impact as impact
    from shift_scheduler.domain.compliance_v3 import RuleReview

    row = session.get(
        ComplianceEntity, service.entity_key(scope_id, "rule_review", review_id)
    )
    if row is None:
        raise HTTPException(404, "制度確認が見つかりません。")
    return impact(session, scope_id, RuleReview.model_validate(row.payload))


@router.get("/records")
def records(
    scope_id: Scope, session: DB, user: User, input_hash: str | None = None
) -> list[dict[str, Any]]:
    member = access(session, user, scope_id)
    staged = staged_payload(session, scope_id, input_hash)
    people = {p["person_id"] for p in staged["people"]}
    sites = {s["establishment_id"] for s in staged.get("establishments", [])}
    result = []
    for row in session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.scope_id.startswith(scope_id.split("/")[0] + "/")
        )
    ):
        if row.scope_id != scope_id and not (
            (
                row.kind in {"leave_account", "leave_record", "flex_enrollment"}
                and row.person_id in people
            )
            or (
                row.kind == "flex_adoption" and row.payload["establishment_id"] in sites
            )
        ):
            continue
        if row.kind == "demand" and row.entity_id != service.demand_identity(
            staged["period"], row.payload["demand_id"]
        ):
            continue
        if row.kind in service.SETTING_ONLY and member.role != "ADMIN":
            # Who switched a workflow setting and why is for administrators
            # (/planning/scope-settings gives everyone the current value).
            continue
        if member.role not in {"ADMIN", "LEADER"} and (
            row.person_id != member.person_id
            or row.kind
            not in {
                "employment",
                "leave_account",
                "leave_obligation",
                "leave_policy",
                "outside_declaration",
                "flex_enrollment",
            }
        ):
            continue
        result.append(
            {
                "kind": row.kind,
                "key": row.key,
                "entity_id": (
                    row.payload["demand_id"] if row.kind == "demand" else row.entity_id
                ),
                "revision": row.revision,
                "payload": row.payload,
            }
        )
    return result


@router.post("/records/{kind}")
def save(
    kind: str,
    request: DemandMutation | Mutation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    access(session, user, scope_id, write=kind == "demand", admin=kind != "demand")
    if kind in {"leave_record", "grant_amendment", "leave_amendment"}:
        raise HTTPException(
            422, "休暇イベントは残高照合付きの専用操作で登録してください。"
        )
    if kind in {"outside_declaration", "work_terms"}:
        # These carry self-service, withdrawal and actual-work coupling rules that
        # only their dedicated routes enforce.
        raise HTTPException(
            422, "兼業申告と勤務区分は、それぞれの専用操作で登録してください。"
        )
    if kind in service.SETTING_ONLY:
        raise HTTPException(
            422, "業務の設定は、施設・部署の設定の操作で変更してください。"
        )
    if kind in service.PROCEDURE_ONLY:
        # Adoption needs a second administrator; the generic save would bypass it.
        raise HTTPException(
            422,
            "フレックスタイム制の採用と参加は、施設の設定の手続で登録してください。",
        )
    if kind == "rule_review" and not (
        request.payload.get("source_sha256") and request.payload.get("document_version")
    ):
        raise HTTPException(
            422, "制度の確認には、一次資料のSHA-256と資料の版を記録してください。"
        )

    def action() -> dict[str, Any]:
        demand_period = None
        if kind == "demand":
            if not isinstance(request, DemandMutation):
                raise HTTPException(422, "需要編集には表示した入力版が必要です。")
            from shift_scheduler.application.planning import require_input

            source = require_input(session, request.input_hash, scope_id)
            from shift_scheduler.application.planning import period_key
            from shift_scheduler.db.planning_models import PlanningInputHead

            parsed = parse_snapshot(source.payload)
            latest = session.get(
                PlanningInputHead, content_hash([scope_id, period_key(parsed)])
            )
            if not latest or latest.input_hash != source.input_hash:
                raise Conflict(
                    "需要の対象入力が変わりました。期間と内容を確認してください。"
                )
            demand_period = source.payload["period"]
        if kind == "employment":
            problem = flex_adoption.employment_flex_problem(
                session, scope_id, request.payload
            )
            if problem:
                raise HTTPException(422, problem)
        if kind == "rule_decision":
            from shift_scheduler.application.rule_impact import decision_problem

            problem = decision_problem(session, scope_id, request.payload)
            if problem:
                raise HTTPException(422, problem)
        row = service.save_entity(
            session,
            scope_id,
            kind,
            request.payload,
            request.expected_revision,
            user.user_id,
            demand_period=demand_period,
        )
        return {"key": row.key, "revision": row.revision, "kind": row.kind}

    return once(session, scope_id, user.user_id, "save:" + kind, request, action)


@router.post("/leave-events")
def leave_event(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, write=True)
    event = LeaveRecord.model_validate(request.payload)
    return once(
        session,
        scope_id,
        user.user_id,
        "leave",
        request,
        lambda: service.append_leave(
            session, scope_id, event, request.expected_revision, user.user_id
        ),
    )


@router.get("/leave-report")
def leave_report(
    scope_id: Scope,
    session: DB,
    user: User,
    effective_at: date | None = None,
    known_at: datetime | None = None,
) -> dict[str, Any]:
    member = access(session, user, scope_id)
    data = latest_v2(session, scope_id)
    persisted = set(
        session.scalars(
            select(ComplianceEntity.entity_id).where(
                ComplianceEntity.kind == "leave_record",
                ComplianceEntity.scope_id.startswith(scope_id.split("/")[0] + "/"),
            )
        )
    )
    data = data.model_copy(
        update={
            "leave_records": tuple(
                e for e in data.leave_records if e.event_id in persisted
            )
        }
    )
    if known_at is not None and known_at.tzinfo is None:
        raise HTTPException(422, "記録時点にはタイムゾーンが必要です。")
    result = account_leave(
        data,
        effective_at or datetime.now(ZoneInfo("Asia/Tokyo")).date(),
        effective_at=effective_at,
        known_at=known_at,
    )
    # Self-service never returns another person's ledger or event identifiers.
    if member.role not in {"ADMIN", "LEADER"}:
        for field in ("balances", "obligations", "live_intervals"):
            result[field] = [
                r for r in result[field] if r["person_id"] == member.person_id
            ]
        result["findings"] = []
        result["conversion_trace"] = []
        result["obligation_calculations"] = []
        if "amendment_trace" in result:
            result["amendment_trace"] = [
                r
                for r in result["amendment_trace"]
                if r["person_id"] == member.person_id
            ]
        result["requires_hr_reconciliation"] = any(
            r["unreserved_days"]["numerator"] < 0 for r in result["balances"]
        )
    # Attach labels only after self-service filtering. Do not return the staff
    # directory to a person requesting their own ledger. Display names are from
    # the current directory, not a claim about historical name validity.
    names = {p.person_id: p.name for p in data.people}
    employers = {
        row.entity_id: row.payload.get("name")
        for row in session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id == scope_id,
                ComplianceEntity.kind == "employer",
            )
        )
    }
    accounts = {a.account_id: a for a in data.leave_accounts}
    windows = {o.obligation_id: o for o in data.leave_obligations}
    for balance in result["balances"]:
        source = accounts.get(balance["account_id"])
        balance.update(
            person_name=names.get(balance["person_id"]),
            employer_name=employers.get(source.employer_id) if source else None,
            granted_on=source.granted_on.isoformat() if source else None,
        )
    for obligation in result["obligations"]:
        window = windows.get(obligation["obligation_id"])
        obligation.update(
            person_name=names.get(obligation["person_id"]),
            employer_name=employers.get(window.employer_id) if window else None,
            start=window.start.isoformat() if window else None,
        )
    result["display_metadata_as_of"] = "current_directory"
    return result


@router.get("/privacy")
def privacy_records(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    member = access(session, user, scope_id, privacy_purpose=True)
    names = privacy.scoped_person_names(session, scope_id)
    visible_people = (
        names
        if member.role == "ADMIN"
        else {member.person_id: names.get(member.person_id, "本人")}
    )
    cases = session.scalars(
        select(PrivacyCase).where(PrivacyCase.scope_id == scope_id)
    ).all()
    return {
        "cases": [
            {
                "case_id": r.case_id,
                "revision": r.revision,
                "status": r.status,
                "payload": r.payload,
                # The decision route admits administrators only (privacy_decision).
                **privacy.decision_options(r.status, member.role == "ADMIN"),
            }
            for r in cases
            if member.role == "ADMIN" or r.person_id == member.person_id
        ],
        "rules": (
            [
                {"key": r.key, "revision": r.revision, "payload": r.payload}
                for r in session.scalars(
                    select(RetentionRule).where(RetentionRule.scope_id == scope_id)
                )
            ]
            if member.role == "ADMIN"
            else []
        ),
        "holds": (
            [
                {
                    "hold_id": r.hold_id,
                    "revision": r.revision,
                    "active": r.active,
                    "person_id": r.person_id,
                    "payload": r.payload,
                }
                for r in session.scalars(
                    select(LegalHold).where(LegalHold.scope_id == scope_id)
                )
            ]
            if member.role == "ADMIN"
            else []
        ),
        "people": [
            {"person_id": person_id, "name": name}
            for person_id, name in visible_people.items()
        ],
    }


@router.post("/privacy/requests")
def privacy_request(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    member = access(session, user, scope_id, privacy_purpose=True)
    value = PrivacyRequest.model_validate(request.payload)
    if member.role != "ADMIN" and value.person_id != member.person_id:
        raise HTTPException(403, "本人の請求だけを登録できます。")
    if value.person_id not in privacy.scoped_people(session, scope_id):
        # Use the same answer for an unknown person and a person outside this scope.
        raise HTTPException(404, "対象となる職員が、この施設・部署に見つかりません。")

    def action() -> dict[str, Any]:
        row = privacy.request_case(session, scope_id, value, user.user_id)
        return {"case_id": row.case_id, "revision": row.revision, "status": row.status}

    return once(session, scope_id, user.user_id, "privacy.request", request, action)


@router.post("/privacy/cases/{case_id}")
def privacy_decision(
    case_id: str, request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    value = PrivacyDecision.model_validate(
        {**request.payload, "expected_revision": request.expected_revision}
    )

    def action() -> dict[str, Any]:
        row = privacy.decide_case(session, case_id, scope_id, value, user.user_id)
        return {"case_id": row.case_id, "revision": row.revision, "status": row.status}

    return once(
        session, scope_id, user.user_id, "privacy.decision:" + case_id, request, action
    )


@router.post("/retention-rules")
def rule(request: Mutation, scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    return once(
        session,
        scope_id,
        user.user_id,
        "retention.rule",
        request,
        lambda: privacy.save_rule(
            session,
            scope_id,
            RetentionPolicy.model_validate(request.payload),
            request.expected_revision,
            user.user_id,
        ),
    )


@router.post("/holds")
def hold(request: Mutation, scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)

    def action() -> dict[str, Any]:
        from shift_scheduler.control.transaction import stage_control

        stage_control(session)
        hold_id = request.payload.get("hold_id") or uuid4().hex
        row = session.get(LegalHold, hold_id)
        if row and (
            row.scope_id != scope_id or row.revision != request.expected_revision
        ):
            raise Conflict("保全状態が変更されました。")
        if not str(request.payload.get("reason", "")).strip():
            raise ValueError("保全・解除の理由が必要です。")
        if not row:
            if request.expected_revision:
                raise Conflict("保全版が一致しません。")
            row = LegalHold(
                hold_id=hold_id,
                scope_id=scope_id,
                person_id=request.payload.get("person_id"),
                revision=0,
            )
            session.add(row)
        active = request.payload.get("active", True)
        if not isinstance(active, bool):
            raise ValueError("保全状態は真偽値で指定してください。")
        if (
            row.revision
            and "person_id" in request.payload
            and row.person_id != request.payload["person_id"]
        ):
            raise Conflict("保全対象の本人は付け替えできません。")
        row.active = active
        row.revision += 1
        row.payload = {**request.payload, "actor": user.user_id}
        from shift_scheduler.application.planning import emit

        emit(
            session,
            scope_id,
            user.user_id,
            "privacy.hold",
            {"hold_id": hold_id, "revision": row.revision, "active": row.active},
        )
        return {"hold_id": hold_id, "revision": row.revision}

    return once(session, scope_id, user.user_id, "hold", request, action)


@router.get("/erasure-candidates", response_model=None)
def erasure_candidates(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    """The scope's planning inputs with the server's answer on erasing each one."""
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    return privacy.erasure_candidates(session, scope_id)


@router.post("/erasure-preview")
def erasure_preview(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)

    def action() -> dict[str, Any]:
        row = privacy.preview(
            session, scope_id, request.payload["input_hash"], user.user_id
        )
        # `erasable` is not part of the plan: the fingerprint binds row.payload only.
        return dict(
            plan_id=row.plan_id,
            fingerprint=row.fingerprint,
            erasable=privacy.erasable(row.payload),
            **row.payload,
        )

    return once(session, scope_id, user.user_id, "erasure.preview", request, action)


@router.post("/erasure-execute")
def erasure_execute(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    return once(
        session,
        scope_id,
        user.user_id,
        "erasure.execute",
        request,
        lambda: privacy.execute(
            session,
            scope_id,
            request.payload["plan_id"],
            request.payload["fingerprint"],
            user.user_id,
        ),
    )


@router.post("/actual-events")
def actual_event(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    from shift_scheduler.api.routers.planning import ActualRequest
    from shift_scheduler.application.planning import import_actual
    from shift_scheduler.domain.compliance import WorkTerms

    value = ActualRequest.model_validate(
        {
            k: v
            for k, v in request.payload.items()
            if k not in {"work_terms", "expected_work_terms_revision"}
        }
    )
    if value.revision != request.expected_revision + 1:
        raise Conflict(
            "External actual revision must immediately follow the reviewed revision"
        )
    terms = (
        WorkTerms.model_validate(request.payload["work_terms"])
        if request.payload.get("work_terms")
        else None
    )

    def action() -> dict[str, Any]:
        if terms:
            # Validate the actual interval before committing classification. A
            # individually valid WorkTerms must not poison the next read/refresh.
            data = latest_v2(session, scope_id)
            revisions = {e.revision_id: e for e in data.employments}
            ids = terms.employment_revision_ids or (terms.employment_revision_id,)
            segments = [revisions.get(identity) for identity in ids]
            present = [e for e in segments if e is not None]
            version: int = data.schema_version  # V3 inputs arrive through the V2 type
            if (
                len(present) != len(segments)
                or (len(present) > 1 and version != 3)
                or any(
                    e.person_id != value.duty.person_id
                    or e.relationship_id != value.duty.relationship_id
                    or e.employer_id != present[0].employer_id
                    or not e.overlaps(value.duty)
                    for e in present
                )
                or present[0].start > value.duty.start
                or present[-1].end < value.duty.end
                or any(
                    a.end != b.start for a, b in zip(present, present[1:], strict=False)
                )
            ):
                raise ValueError(
                    "実績区間に適用する雇用改定を時系列で選択してください。"
                )
            scheduled = sorted(terms.scheduled_work, key=lambda p: p.start)
            if any(not value.duty.contains(p) for p in scheduled) or any(
                a.overlaps(b) for a, b in zip(scheduled, scheduled[1:], strict=False)
            ):
                raise ValueError("所定労働区間は実績区間内で重複なく記録してください。")
            if scheduled and any(e.working_time_system == "flex" for e in present):
                # Flextime has no scheduled hours; the worker sets start and end times.
                raise ValueError(
                    "フレックスタイム制の実績には所定労働区間を付けません。"
                )
        if terms and terms.planned_publication_id:
            from shift_scheduler.db.planning_models import PlanningPublication

            publication = session.get(PlanningPublication, terms.planned_publication_id)
            if not publication or publication.scope_id != scope_id:
                raise LookupError("Planned publication not found in scope")
            original = next(
                (
                    d
                    for d in publication.payload["assignments"]
                    if d["duty_id"] == terms.planned_duty_id
                ),
                None,
            )
            if (
                not original
                or original["person_id"] != value.duty.person_id
                or original["relationship_id"] != value.duty.relationship_id
            ):
                raise Conflict(
                    "Actual event does not match the published person/employment"
                )
        if terms and terms.duty_id != value.duty.duty_id:
            raise ValueError("実績IDと勤務区分IDが一致しません。")
        if terms:
            expected_terms = request.payload.get("expected_work_terms_revision")
            # Exactly int: a JSON true is not a revision number.
            if type(expected_terms) is not int or expected_terms < 0:  # noqa: E721
                raise ValueError("勤務区分の確認済み版が必要です。")
            old = session.get(
                ComplianceEntity,
                service.entity_key(scope_id, "work_terms", terms.duty_id),
            )
            if (old.revision if old else 0) != expected_terms:
                raise Conflict(
                    "勤務区分が変更されました。実績と区分の差分を再確認してください。"
                )
            service.save_entity(
                session,
                scope_id,
                "work_terms",
                terms.model_dump(mode="json"),
                expected_terms,
                user.user_id,
            )
        return import_actual(
            session,
            scope_id,
            user.user_id,
            value.external_id,
            value.revision,
            value.duty,
            expected_revision=request.expected_revision,
        )

    return once(session, scope_id, user.user_id, "actual", request, action)


def declaration_change_refusal(role: str, stored_status: str | None) -> str | None:
    """Why this role may not correct or withdraw a declaration stored with this
    status (None: it may, or nothing is stored yet). The listing and the route use
    this one function.

    Hours already confirmed stay in the combined count (Art. 38 is mandatory;
    基発0901第3号 counts the hours as known). Only REVIEWED declarations are
    counted, so any change by the person (resubmitting as SUBMITTED, then
    withdrawing) would drop them; an administrator makes the correction, e.g. an
    earlier end, and reviews it.
    """
    if role != "ADMIN" and stored_status == "REVIEWED":
        return "照合済みの申告は本人では変更・取り下げできません。終了日などの訂正は管理者に依頼してください。"
    return None


def _action(refusal: str | None) -> dict[str, Any]:
    return {"allowed": refusal is None, "refusal": refusal}


@router.get("/declaration-context", response_model=None)
def declaration_context(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    """Self-service directory: no other person's employment or administrative records."""
    member = access(session, user, scope_id)
    payload = staged_payload(session, scope_id)
    own_employment = [
        e for e in payload.get("employments", []) if e["person_id"] == member.person_id
    ]
    employer_ids = {e["employer_id"] for e in own_employment}
    directory = {
        r.entity_id: {"employer_id": r.entity_id, "name": r.payload["name"]}
        for r in session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id == scope_id,
                ComplianceEntity.kind == "employer",
            )
        )
    }
    for employer_id in employer_ids:
        directory.setdefault(
            employer_id, {"employer_id": employer_id, "name": employer_id}
        )
    return {
        "person_id": member.person_id,
        "employers": list(directory.values()),
        "establishments": [
            {k: e[k] for k in ("establishment_id", "employer_id", "name") if k in e}
            for e in payload.get("establishments", [])
            if e["employer_id"] in directory
        ],
        "declarations": [
            {
                "entity_id": r.entity_id,
                "revision": r.revision,
                "payload": r.payload,
                # What the declaration route answers this viewer for this stored
                # version: the same function decides both.
                "actions": {
                    "change": _action(
                        declaration_change_refusal(member.role, r.payload.get("status"))
                    )
                },
            }
            for r in session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == scope_id,
                    ComplianceEntity.kind == "outside_declaration",
                    *(
                        (ComplianceEntity.person_id == member.person_id,)
                        if member.role != "ADMIN"
                        else ()
                    ),
                )
            )
        ],
    }


@router.get("/workflow-context", response_model=None)
def workflow_context(
    scope_id: Scope, session: DB, user: User, input_hash: str | None = None
) -> dict[str, Any]:
    from shift_scheduler.db.planning_models import (
        ActualWorkEvent,
        PlanningOutbox,
        PlanningPublication,
    )

    member = access(session, user, scope_id, write=True)
    payload = staged_payload(session, scope_id, input_hash)
    validation_issues = []
    try:
        parse_snapshot(payload)
    except ValidationError as exc:
        validation_issues = [
            {"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
            for e in exc.errors(
                include_input=False, include_context=False, include_url=False
            )
        ]
    # A reconciliation note is recorded against one revision of an actual: the
    # event actual_review emits names that revision's key.
    reviewed = {
        noted.get("event_id")
        for noted in session.scalars(
            select(PlanningOutbox.payload).where(
                PlanningOutbox.scope_id == scope_id,
                PlanningOutbox.kind == "actual.reviewed",
            )
        )
    }
    latest = {}
    for row in session.scalars(
        select(ActualWorkEvent)
        .where(ActualWorkEvent.scope_id == scope_id)
        .order_by(ActualWorkEvent.revision)
    ):
        latest[row.external_id] = {
            "external_id": row.external_id,
            "revision": row.revision,
            "event_id": row.key,
            "duty": row.payload,
            # Whether a note exists for the revision listed here (the current one).
            "reviewed": row.key in reviewed,
        }
    source_query = select(PlanningInput).where(PlanningInput.scope_id == scope_id)
    if input_hash is not None:
        source_query = source_query.where(PlanningInput.input_hash == input_hash)
    latest_source = session.scalar(
        source_query.order_by(PlanningInput.input_revision.desc()).limit(1)
    )
    if latest_source is None:  # staged_payload above found the same row
        raise HTTPException(
            409, "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。"
        )
    return {
        "role": member.role,
        "can_correct_actuals": member.role == "ADMIN",
        "input_hash": latest_source.input_hash,
        "staging_valid": not validation_issues,
        "validation_issues": validation_issues,
        "employers": [
            r.payload
            for r in session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == scope_id,
                    ComplianceEntity.kind == "employer",
                )
            )
        ],
        "capability_targets": [
            {"target_hash": r.entity_id, "payload": r.payload, "revision": r.revision}
            for r in session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == scope_id,
                    ComplianceEntity.kind == "capability",
                )
            )
        ],
        "capability_amendments": [
            r.payload
            for r in session.scalars(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == scope_id,
                    ComplianceEntity.kind == "capability_amendment",
                )
            )
        ],
        **{
            name: payload.get(name, [])
            for name in (
                "management_models",
                "leave_policies",
                "leave_accounts",
                "leave_records",
                "leave_obligations",
                "ledger_recordings",
                "work_terms",
                "demands",
            )
        },
        "people": payload["people"],
        "contracts": payload["contracts"],
        "capabilities": payload["capabilities"],
        "agreements": payload.get("agreements", []),
        "rule_reviews": payload.get("rule_reviews", []),
        "rule_decisions": payload.get("rule_decisions", []),
        "accounting_transitions": payload.get("accounting_transitions", []),
        "site_attribution_decisions": payload.get("site_attribution_decisions", []),
        "annual_calendars": payload.get("annual_calendars", []),
        "flex_adoptions": payload.get("flex_adoptions", []),
        "flex_enrollments": payload.get("flex_enrollments", []),
        "rule_revision": payload["rule_revision"],
        "duty_options": [
            dict(zip(("kind", "task", "location"), option, strict=False))
            for option in sorted(
                {
                    (d["kind"], d["task"], d["location"])
                    for d in (
                        *payload["candidates"],
                        *payload["history"],
                        *payload.get("duty_templates", ()),
                    )
                }
            )
        ],
        "employments": payload["employments"],
        "establishments": payload.get("establishments", []),
        "publications": [
            {
                "publication_id": p.publication_id,
                "version": p.version,
                "period": p.period_key,
                "assignments": p.payload["assignments"],
            }
            for p in session.scalars(
                select(PlanningPublication)
                .where(PlanningPublication.scope_id == scope_id)
                .order_by(PlanningPublication.created_at.desc())
            )
        ],
        "actuals": list(latest.values()),
        "records": records(scope_id, session, user, input_hash),
    }


class ActualFilePreview(RequestModel):
    source_text: str = Field(min_length=1, max_length=2_000_000)


@router.get("/copies/account-backfill", response_model=None)
def account_backfill_preview(
    scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    from shift_scheduler.application.account_copy_backfill import preview

    return preview(session, scope_id)


@router.post("/copies/account-backfill", response_model=None)
def account_backfill_apply(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True, privacy_purpose=True)
    if request.expected_revision != 0 or set(request.payload) != {"preview_hash"}:
        raise ValueError("照合した参照一覧の確認が必要です。")
    from shift_scheduler.application.account_copy_backfill import apply

    return once(
        session,
        scope_id,
        user.user_id,
        "copy.account-backfill",
        request,
        lambda: apply(session, scope_id, request.payload["preview_hash"]),
    )


@router.post("/actual-import/preview", response_model=None)
def actual_import_preview(
    request: ActualFilePreview, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    from shift_scheduler.application.actual_file import inspect_actual_file

    inspected = inspect_actual_file(
        session, scope_id, user.user_id, request.source_text
    )
    # Each row uses the public mutation path, without retaining any preview write.
    # Continue after a domain failure so the operator can correct all affected rows.
    from shift_scheduler.application.actual_file import ActualFileErrors, row_error

    errors = []
    for index, item in enumerate(inspected["requests"]):
        savepoint = session.begin_nested()
        try:
            actual_event(Mutation.model_validate(item), scope_id, session, user)
        except (ValueError, Conflict, HTTPException) as exc:
            if isinstance(exc, HTTPException) and exc.status_code >= 500:
                raise
            errors.append(
                row_error(
                    index,
                    "domain",
                    "契約・勤務・原本改定と所定区分の対応を確認してください。",
                )
            )
        finally:
            savepoint.rollback()
    if errors:
        raise ActualFileErrors(errors)
    return {k: v for k, v in inspected.items() if k != "requests"}


@router.post("/actual-import/commit", response_model=None)
def actual_import_commit(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    if request.expected_revision != 0 or set(request.payload) != {
        "source_text",
        "preview_hash",
    }:
        raise ValueError("原本と確認済みプレビューが必要です。")
    source = ActualFilePreview(source_text=request.payload["source_text"])

    def action() -> dict[str, Any]:
        from shift_scheduler.application.actual_file import inspect_actual_file

        inspected = inspect_actual_file(
            session, scope_id, user.user_id, source.source_text
        )
        if inspected["preview_hash"] != request.payload["preview_hash"]:
            raise Conflict(
                "取込対象が変更されました。原本との差分を再確認してください。"
            )
        results = [
            actual_event(Mutation.model_validate(item), scope_id, session, user)
            for item in inspected["requests"]
        ]
        from shift_scheduler.application.planning import emit

        emit(
            session,
            scope_id,
            user.user_id,
            "actual.import",
            {
                "source_hash": inspected["source_hash"],
                "count": len(results),
                "person_ids": sorted({r["person_id"] for r in inspected["rows"]}),
            },
        )
        return {
            "source_hash": inspected["source_hash"],
            "count": len(results),
            "results": results,
        }

    return once(session, scope_id, user.user_id, "actual.file.import", request, action)


@router.post("/actual-reviews", response_model=None)
def actual_review(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.db.planning_models import ActualWorkEvent

    access(session, user, scope_id, write=True)

    def action() -> dict[str, Any]:
        row = session.scalar(
            select(ActualWorkEvent)
            .where(
                ActualWorkEvent.scope_id == scope_id,
                ActualWorkEvent.external_id == request.payload.get("external_id"),
            )
            .order_by(ActualWorkEvent.revision.desc())
            .limit(1)
        )
        if not row or row.revision != request.expected_revision:
            raise Conflict("実績の版が変わりました。差分を再確認してください。")
        reason = str(request.payload.get("reason", "")).strip()
        if not reason:
            raise ValueError("照合内容を記録してください。")
        from shift_scheduler.application.planning import emit

        emit(
            session,
            scope_id,
            user.user_id,
            "actual.reviewed",
            {
                "event_id": row.key,
                "revision": row.revision,
                "person_id": row.payload["person_id"],
                "reason": reason,
            },
        )
        return {"event_id": row.key, "revision": row.revision, "reviewed": True}

    return once(session, scope_id, user.user_id, "actual.review", request, action)


@router.post("/leave-requests")
def request_leave(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from sqlalchemy import update

    from shift_scheduler.application.planning import emit
    from shift_scheduler.db.planning_models import PlanningRequest, PlanningScope
    from shift_scheduler.domain.compliance import LeaveRequest

    member = access(session, user, scope_id)
    value = LeaveRequest.model_validate(request.payload)
    account = session.get(
        ComplianceEntity,
        service.entity_key(scope_id, "leave_account", value.account_id),
    )
    if account is None or account.person_id != member.person_id:
        raise HTTPException(403, "本人の年休付与だけを請求できます。")

    def action() -> dict[str, Any]:
        identity = uuid4().hex
        row = PlanningRequest(
            request_id=identity,
            scope_id=scope_id,
            person_id=member.person_id,
            version=1,
            kind="PAID_LEAVE_V2",
            status="PENDING",
            payload={
                **value.model_dump(mode="json"),
                "start": value.interval.start.isoformat(),
                "end": value.interval.end.isoformat(),
            },
        )
        session.add(row)
        session.execute(
            update(PlanningScope)
            .where(PlanningScope.scope_id == scope_id)
            .values(
                input_revision=PlanningScope.input_revision + 1,
                data_revision=PlanningScope.data_revision + 1,
            )
        )
        emit(
            session,
            scope_id,
            user.user_id,
            "leave.request",
            {"request_id": identity, "person_id": member.person_id},
        )
        return {"request_id": identity, "status": "PENDING", "version": 1}

    return once(session, scope_id, user.user_id, "leave.request", request, action)


@router.post("/grant-amendments")
def grant_amendment(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.domain.compliance_v3 import GrantAmendment, SolverSnapshotV3

    access(session, user, scope_id, admin=True)

    def action() -> dict[str, Any]:
        data = latest_v2(session, scope_id)
        if not isinstance(data, SolverSnapshotV3):
            raise HTTPException(
                409, "付与訂正には、元の記録日時を確認した版3入力が必要です。"
            )
        amendment = GrantAmendment.model_validate(request.payload)
        account = next(
            (a for a in data.leave_accounts if a.account_id == amendment.account_id),
            None,
        )
        if not account or account.person_id != amendment.person_id:
            raise HTTPException(422, "訂正対象の付与・本人が一致しません。")
        candidate = parse_snapshot_v2(
            dict(
                data.model_dump(mode="json"),
                grant_amendments=[
                    *(a.model_dump(mode="json") for a in data.grant_amendments),
                    amendment.model_dump(mode="json"),
                ],
            )
        )
        checked = account_leave(candidate, datetime.now(ZoneInfo("Asia/Tokyo")).date())
        if any(f.rule_id == "leave.v3.history" for f in checked["findings"]):
            raise HTTPException(422, "訂正の改定順・元記録・確認根拠を照合できません。")
        row = service.save_entity(
            session,
            scope_id,
            "grant_amendment",
            request.payload,
            request.expected_revision,
            user.user_id,
        )
        return {
            "key": row.key,
            "revision": row.revision,
            "requires_hr_reconciliation": checked["requires_hr_reconciliation"],
            "balances": checked["balances"],
            "amendment_trace": checked["amendment_trace"],
        }

    return once(session, scope_id, user.user_id, "grant-amendment", request, action)


@router.post("/leave-amendments", response_model=None)
def leave_amendment(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.domain.compliance_v3 import LeaveAmendment, SolverSnapshotV3

    access(session, user, scope_id, admin=True)

    def action() -> dict[str, Any]:
        data = latest_v2(session, scope_id)
        if not isinstance(data, SolverSnapshotV3):
            raise HTTPException(
                409, "取得訂正には元の記録日時を確認した版3入力が必要です。"
            )
        item = LeaveAmendment.model_validate(request.payload)
        candidate = parse_snapshot_v2(
            {
                **data.model_dump(mode="json"),
                "leave_amendments": [
                    *(a.model_dump(mode="json") for a in data.leave_amendments),
                    item.model_dump(mode="json"),
                ],
            }
        )
        checked = account_leave(candidate, datetime.now(ZoneInfo("Asia/Tokyo")).date())
        if any(f.rule_id == "leave.v3.history" for f in checked["findings"]):
            raise HTTPException(422, "訂正の改定順・元記録・確認根拠を照合できません。")
        # Preserve reconciled HR evidence even when it reveals a shortage or a
        # dependent reservation requiring another explicit correction. Publication
        # remains blocked by the independent validator until those are reconciled.
        row = service.save_entity(
            session,
            scope_id,
            "leave_amendment",
            request.payload,
            request.expected_revision,
            user.user_id,
        )
        return {
            "key": row.key,
            "revision": row.revision,
            "balances": checked["balances"],
            "amendment_trace": checked["amendment_trace"],
            "requires_hr_reconciliation": bool(checked["findings"]),
            "findings": [f.model_dump(mode="json") for f in checked["findings"]],
        }

    return once(session, scope_id, user.user_id, "leave-amendment", request, action)


class SubjectControlRequest(RequestModel):
    expected_revision: int = Field(ge=0, le=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    case_id: str = Field(min_length=1, max_length=64)
    case_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)


@router.get("/subject-controls/{person_id}", response_model=None)
def subject_control_preview(
    person_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.application import subject_controls

    member = access(session, user, scope_id, admin=True, privacy_purpose=True)
    return subject_controls.preview(
        session, scope_id, person_id, issuer=member.issuer, subject=member.subject
    )


@router.post("/subject-controls/{person_id}", response_model=None)
def subject_control_apply(
    person_id: str,
    request: SubjectControlRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    from shift_scheduler.application import subject_controls

    member = access(
        session, user, scope_id, write=True, admin=True, privacy_purpose=True
    )
    return subject_controls.apply(
        session,
        scope_id,
        person_id,
        issuer=member.issuer,
        subject=member.subject,
        **request.model_dump(),
    )


class SubjectEligiblePlanRequest(RequestModel):
    expected_revision: int = Field(ge=1, le=1)
    idempotency_key: str = Field(min_length=8, max_length=128)


@router.post("/subject-controls/{person_id}/plans", response_model=None)
def subject_control_plan(
    person_id: str,
    request: SubjectEligiblePlanRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    from shift_scheduler.application import subject_controls

    member = access(
        session, user, scope_id, write=True, admin=True, privacy_purpose=True
    )
    return subject_controls.plan_eligible(
        session,
        scope_id,
        person_id,
        issuer=member.issuer,
        subject=member.subject,
        **request.model_dump(),
    )


class SubjectEligibleErasureRequest(RequestModel):
    expected_revision: int = Field(ge=1, le=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    plan_id: str = Field(min_length=1, max_length=64)
    plan_revision: int = Field(ge=1)
    fingerprint: str = Field(min_length=64, max_length=64)


@router.post("/subject-controls/{person_id}/execute", response_model=None)
def subject_control_execute(
    person_id: str,
    request: SubjectEligibleErasureRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    from shift_scheduler.application import subject_controls

    member = access(
        session, user, scope_id, write=True, admin=True, privacy_purpose=True
    )
    return subject_controls.execute_eligible(
        session,
        scope_id,
        person_id,
        issuer=member.issuer,
        subject=member.subject,
        **request.model_dump(),
    )


@router.get("/copies", response_model=None)
def copy_inventory(
    scope_id: Scope, person_id: str, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.application import copies

    access(session, user, scope_id, admin=True, privacy_purpose=True)
    return copies.with_processing(
        copies.inventory(
            session, scope_id, person_id, datetime.now(ZoneInfo("Asia/Tokyo"))
        )
    )


@router.get("/copies/context", response_model=None)
def copy_context(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy

    access(session, user, scope_id, admin=True, privacy_purpose=True)
    prefix = scope_id.split("/")[0] + "/"
    identities = set(
        session.scalars(
            select(CopySubject.person_id)
            .join(ManagedCopy)
            .where(ManagedCopy.scope_id.startswith(prefix))
        )
    )
    names = {}
    for row in session.scalars(
        select(PlanningInput)
        .where(PlanningInput.scope_id.startswith(prefix))
        .order_by(PlanningInput.input_revision)
    ):
        names.update({p["person_id"]: p["name"] for p in row.payload.get("people", [])})
    return {
        "people": [
            {"person_id": p, "name": names.get(p, "旧記録の職員（氏名未照合）")}
            for p in sorted(identities | names.keys())
        ]
    }


@router.post("/copies/{operation}", response_model=None)
def copy_operation(
    operation: str, request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.application import copies
    from shift_scheduler.domain.copies import (
        CopyExecuteRequest,
        CopyPreviewRequest,
        CopyRegistration,
        DatabaseCopyReview,
        SharedProjectionReview,
    )

    access(session, user, scope_id, admin=True, privacy_purpose=True)

    def action() -> dict[str, Any]:
        if operation == "confirm-external":
            from shift_scheduler.domain.planning import Evidence

            if set(request.payload) != {"copy_id", "evidence"}:
                raise HTTPException(422, "外部コピーと確認根拠を指定してください。")
            return copies.confirm_external(
                session,
                scope_id,
                request.payload["copy_id"],
                request.expected_revision,
                Evidence.model_validate(request.payload["evidence"]),
                user.user_id,
            )
        if operation == "review-preservation":
            return copies.review_shared_projection(
                session,
                scope_id,
                SharedProjectionReview.model_validate(request.payload),
                request.expected_revision,
                user.user_id,
            )
        if operation == "review-database":
            return copies.review_database_copy(
                session,
                scope_id,
                DatabaseCopyReview.model_validate(request.payload),
                request.expected_revision,
                user.user_id,
            )
        if operation == "register":
            return copies.register(
                session,
                scope_id,
                CopyRegistration.model_validate(request.payload),
                request.expected_revision,
                user.user_id,
            )
        if operation == "preview":
            item = CopyPreviewRequest.model_validate(request.payload)
            return copies.preview(session, scope_id, item.person_id, user.user_id)
        if operation == "execute":
            planned = CopyExecuteRequest.model_validate(request.payload)
            return copies.execute(
                session,
                scope_id,
                planned.plan_id,
                planned.fingerprint,
                request.expected_revision,
                user.user_id,
            )
        raise HTTPException(404, "コピー管理の操作が見つかりません。")

    return once(session, scope_id, user.user_id, "copies:" + operation, request, action)


class JointCopyReviewRequest(RequestModel):
    shared_text_reviewed: Literal[True]
    expected_revision: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    source_hash: str = Field(min_length=64, max_length=64)
    context_hash: str = Field(min_length=64, max_length=64)
    reason: str = Field(min_length=1, max_length=2000)
    evidence: dict[str, Any]
    # Database rows that keep uncontrolled owners: the exact partial history.
    projection_hash: str | None = Field(default=None, min_length=64, max_length=64)


@router.get("/copies/{copy_id}/joint-review", response_model=None)
def joint_copy_context(
    copy_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.application import joint_copy_erasure
    from shift_scheduler.application.subject_controls import _authority
    from shift_scheduler.db.compliance_models import ManagedCopy

    access(session, user, scope_id, admin=True, privacy_purpose=True)
    _authority()
    row = session.get(ManagedCopy, copy_id)
    if not row or row.scope_id != scope_id:
        raise HTTPException(404, "Copy not found")
    context = joint_copy_erasure.context(
        session, row, datetime.now(ZoneInfo("Asia/Tokyo"))
    )
    projection = None
    if row.medium == "database":
        if context["retained_owners"]:
            prepared = joint_copy_erasure.joint_payload(session, row, context, None)
            projection = {
                "payload": prepared["payload"],
                "payload_hash": prepared["payload_hash"],
                "retained_owners": prepared["person_ids"],
            }
    else:
        from shift_scheduler.application.shared_projection import file_payload

        file_payload(session, row, context["owners"][0])
    return {
        "copy_id": copy_id,
        "revision": row.revision,
        "source_hash": row.content_hash,
        "context": context,
        "context_hash": content_hash(context),
        "projection": projection,
        "requires_explicit_review": True,
        "all_copies_erased": False,
    }


@router.post("/copies/{copy_id}/joint-review", response_model=None)
def joint_copy_review(
    copy_id: str,
    request: JointCopyReviewRequest,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    from shift_scheduler.application import joint_copy_erasure
    from shift_scheduler.domain.planning import Evidence

    member = access(
        session, user, scope_id, write=True, admin=True, privacy_purpose=True
    )
    from shift_scheduler.application.subject_controls import _authority

    _authority()

    def action() -> dict[str, Any]:
        return joint_copy_erasure.review(
            session,
            scope_id,
            copy_id,
            expected_revision=request.expected_revision,
            source_hash=request.source_hash,
            context_hash=request.context_hash,
            reason=request.reason,
            evidence=Evidence.model_validate(request.evidence),
            issuer=member.issuer,
            subject=member.subject,
            at=datetime.now(ZoneInfo("Asia/Tokyo")),
            projection_hash=request.projection_hash,
        )

    return once(
        session, scope_id, user.user_id, "joint-copy-review:" + copy_id, request, action
    )


@router.get("/copies/{copy_id}/projection", response_model=None)
def shared_projection(
    copy_id: str, person_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.application.shared_projection import proposal
    from shift_scheduler.db.compliance_models import ManagedCopy

    access(session, user, scope_id, admin=True, privacy_purpose=True)
    row = session.get(ManagedCopy, copy_id)
    if not row or row.scope_id != scope_id or row.state != "PRESENT":
        raise HTTPException(404, "現在の共有コピーが見つかりません。")
    return {
        "copy_id": copy_id,
        "revision": row.revision,
        **proposal(session, row, person_id),
    }


@router.get("/preserved-archives/{archive_id}", response_model=None)
def preserved_archive(
    archive_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.db.compliance_models import PreservedArchive

    access(session, user, scope_id, admin=True, privacy_purpose=True)
    row = session.get(PreservedArchive, archive_id)
    if not row or row.scope_id != scope_id:
        raise HTTPException(404, "保存された部分履歴が見つかりません。")
    return {
        "archive_id": row.archive_id,
        "source_digest": row.source_digest,
        "payload_hash": row.payload_hash,
        "payload": row.payload,
    }


@router.post("/outside-declarations", response_model=None)
def outside_declaration(
    request: Mutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.domain.compliance_v3 import OutsideDeclaration

    member = access(session, user, scope_id)
    payload = request.payload
    evidence = payload.get("review_evidence")
    if member.role == "ADMIN" and isinstance(evidence, dict):
        # The reviewer is the signed-in administrator, never a typed name.
        payload = {
            **payload,
            "review_evidence": {**evidence, "verified_by": user.user_id},
        }
    item = OutsideDeclaration.model_validate(payload)
    if member.role != "ADMIN" and (
        item.person_id != member.person_id
        or item.status not in {"SUBMITTED", "WITHDRAWN"}
        or item.review_evidence is not None
    ):
        raise HTTPException(
            403, "本人の申告のみ登録できます。確認済みには変更できません。"
        )

    # A submission is not automatically used as verified scheduling input.
    def action() -> dict[str, Any]:
        existing = session.scalar(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id == scope_id,
                ComplianceEntity.kind == "outside_declaration",
                ComplianceEntity.entity_id == item.declaration_id,
            )
        )
        refusal = declaration_change_refusal(
            member.role, existing.payload.get("status") if existing else None
        )
        if refusal:
            raise HTTPException(422, refusal)
        if item.status == "WITHDRAWN":
            if not existing or existing.person_id != item.person_id:
                raise HTTPException(422, "取下げ対象の本人申告がありません。")
            if existing.revision != request.expected_revision:
                raise Conflict("申告版が変更されました。現在の内容を確認してください。")
            original = {
                **existing.payload,
                "status": "WITHDRAWN",
                "review_evidence": None,
            }
            if item.model_dump(mode="json") != original:
                raise HTTPException(422, "取下げでは元の申告内容を変更できません。")
        row = service.save_entity(
            session,
            scope_id,
            "outside_declaration",
            payload,
            request.expected_revision,
            user.user_id,
        )
        return {"key": row.key, "revision": row.revision, "status": item.status}

    return once(session, scope_id, user.user_id, "outside-declaration", request, action)


@router.get("/candidate-catalogue", response_model=None)
def candidate_catalogue(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    from shift_scheduler.application.catalogue import generate_catalogue
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

    access(session, user, scope_id, write=True)
    data = latest_v2(session, scope_id)
    if not isinstance(data, SolverSnapshotV3):
        raise HTTPException(
            409, "候補カタログには承認済み勤務型を持つ版3入力が必要です。"
        )
    return generate_catalogue(data)


def grant_assessment_context(
    session: Any,
    scope: str,
) -> tuple[SolverSnapshotV2, SolverSnapshotV2, list[Finding], date]:
    from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
    from shift_scheduler.validation.leave_history import project_ledger

    data = latest_v2(session, scope)
    projected: SolverSnapshotV2 = data
    findings: list[Finding] = []
    as_of = datetime.now(ZoneInfo("Asia/Tokyo")).date()
    if isinstance(data, SolverSnapshotV3):
        projected, findings, _ = project_ledger(data, as_of, None)
    return data, projected, findings, as_of


@router.get("/grant-assessments/context", response_model=None)
def get_grant_assessment_context(
    scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    access(session, user, scope_id, admin=True)
    data, projected, findings, as_of = grant_assessment_context(session, scope_id)
    return {
        "input_hash": data.input_hash,
        "source_revision": data.source_revision,
        "as_of": as_of.isoformat(),
        "accounts": [a.model_dump(mode="json") for a in projected.leave_accounts],
        "findings": [f.model_dump(mode="json") for f in findings],
    }


@router.post("/grant-assessments", response_model=None)
def grant_assessment(
    request: GrantAssessmentMutation, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    from shift_scheduler.domain.leave_entitlement import GrantAssessment
    from shift_scheduler.validation.leave_entitlement import reconcile_grant

    access(session, user, scope_id, admin=True)

    def action() -> dict[str, Any]:
        item = GrantAssessment.model_validate(request.payload)
        data, projected, findings, as_of = grant_assessment_context(session, scope_id)
        if request.input_hash != data.input_hash:
            raise Conflict("HR assessment evidence changed; reload the reviewed input")
        if findings:
            raise Conflict(
                "Grant correction history requires reconciliation before assessment"
            )
        account = next(
            (a for a in projected.leave_accounts if a.account_id == item.account_id),
            None,
        )
        if account is None:
            raise HTTPException(404, "照合対象の付与が見つかりません。")
        if request.expected_revision != data.source_revision:
            raise Conflict("HR assessment input version changed")
        report = reconcile_grant(item, account, projected.leave_accounts)
        report.update(
            scope_id=scope_id,  # receipts have no scope column (G04 impact listing)
            recorded_by=user.user_id,  # the signed-in account; the HR verifier stays as entered
            input_hash=data.input_hash,
            rule_revision=data.rule_revision,
            as_of=as_of.isoformat(),
            assessment=item.model_dump(mode="json"),
        )
        return report

    return once(session, scope_id, user.user_id, "grant-assessment", request, action)


class FlexRegistration(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    payload: dict[str, Any]


class FlexConfirmation(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    expected_revision: int = Field(ge=1)
    impact_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class FlexWithdrawal(RequestModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=500)


class FlexEnd(FlexWithdrawal):
    end_on: date


def facility_admin(session: Any, user: Any, scope_id: str) -> None:
    access(session, user, scope_id, admin=True)
    try:
        flex_adoption.facility_admin(
            session, list(memberships(session, user)), scope_id
        )
    except flex_adoption.Refused as exc:
        raise HTTPException(403, "施設管理者による確認が必要です") from exc


def flex_step(
    session: Any,
    scope_id: str,
    user: Any,
    operation: str,
    request: IdempotentRequest,
    step: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    facility_admin(session, user, scope_id)

    def action() -> dict[str, Any]:
        try:
            return step()
        except flex_adoption.Refused as exc:
            raise HTTPException(
                403, "フレックス勤務の操作は許可されていません"
            ) from exc

    return once(session, scope_id, user.user_id, operation, request, action)


@router.get("/flex-adoptions", response_model=None)
def flex_adoptions(scope_id: Scope, session: DB, user: User) -> dict[str, Any]:
    """The facility's flextime adoptions and enrolments, and the choices for a new one."""
    access(session, user, scope_id, admin=True)
    try:
        flex_adoption.facility_admin(
            session, list(memberships(session, user)), scope_id
        )
        can_manage, reason = True, None
    except flex_adoption.Refused:
        can_manage, reason = False, "施設管理者による確認が必要です"
    try:
        staged = staged_payload(session, scope_id)
    except HTTPException:
        staged = {}
    people = {p["person_id"] for p in staged.get("people", [])}
    sites = {s["establishment_id"] for s in staged.get("establishments", [])}
    facility = scope_id.split("/")[0]
    rows = session.scalars(
        select(ComplianceEntity).where(
            ComplianceEntity.scope_id.startswith(facility + "/"),
            ComplianceEntity.kind.in_(("flex_adoption", "flex_enrollment")),
        )
    )
    listed: dict[str, list[dict[str, Any]]] = {
        "flex_adoption": [],
        "flex_enrollment": [],
    }
    # A department administrator sees the department's own sites and people only.
    shown = [
        row
        for row in rows
        if can_manage
        or (
            row.person_id in people
            if row.kind == "flex_enrollment"
            else row.payload["establishment_id"] in sites
        )
    ]
    # What this viewer may do with each record now, from the checks the steps use.
    available = flex_adoption.available_actions(
        session, scope_id, user.user_id, reason, shown
    )
    for row in shown:
        listed[row.kind].append(
            {
                "entity_id": row.entity_id,
                "revision": row.revision,
                "payload": row.payload,
                **available[row.key],
            }
        )
    return {
        "viewer": user.user_id,
        "can_manage": can_manage,
        "manage_refusal": reason,
        "adoptions": sorted(listed["flex_adoption"], key=lambda r: r["entity_id"]),
        "enrollments": sorted(listed["flex_enrollment"], key=lambda r: r["entity_id"]),
        "establishments": staged.get("establishments", []),
        "people": [
            {"person_id": p["person_id"], "name": p["name"]}
            for p in staged.get("people", [])
        ],
    }


@router.get("/flex-adoptions/{adoption_id}/impact", response_model=None)
def flex_adoption_impact(
    adoption_id: str, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    facility_admin(session, user, scope_id)
    return flex_adoption.impact(session, scope_id, adoption_id)


@router.post("/flex-adoptions", response_model=None)
def flex_adoption_register(
    request: FlexRegistration, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    def step() -> dict[str, Any]:
        row = flex_adoption.register_adoption(
            session, scope_id, request.payload, user.user_id
        )
        return {
            "entity_id": row.entity_id,
            "revision": row.revision,
            "status": "registered",
        }

    return flex_step(session, scope_id, user, "flex-adoption:register", request, step)


@router.post("/flex-adoptions/{adoption_id}/confirm", response_model=None)
def flex_adoption_confirm(
    adoption_id: str,
    request: FlexConfirmation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    if request.impact_hash is None:
        raise HTTPException(422, "確認した影響の内容（impact_hash）が必要です。")
    impact_hash = request.impact_hash
    return flex_step(
        session,
        scope_id,
        user,
        "flex-adoption:confirm:" + adoption_id,
        request,
        lambda: flex_adoption.confirm_adoption(
            session,
            scope_id,
            adoption_id,
            request.expected_revision,
            impact_hash,
            user.user_id,
        ),
    )


@router.post("/flex-adoptions/{adoption_id}/withdraw", response_model=None)
def flex_adoption_withdraw(
    adoption_id: str, request: FlexWithdrawal, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    return flex_step(
        session,
        scope_id,
        user,
        "flex-adoption:withdraw:" + adoption_id,
        request,
        lambda: flex_adoption.withdraw(
            session,
            scope_id,
            "flex_adoption",
            adoption_id,
            request.expected_revision,
            request.reason,
            user.user_id,
        ),
    )


@router.post("/flex-adoptions/{adoption_id}/end", response_model=None)
def flex_adoption_end(
    adoption_id: str, request: FlexEnd, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    return flex_step(
        session,
        scope_id,
        user,
        "flex-adoption:end:" + adoption_id,
        request,
        lambda: flex_adoption.end_adoption(
            session,
            scope_id,
            adoption_id,
            request.expected_revision,
            request.end_on,
            request.reason,
            user.user_id,
        ),
    )


@router.post("/flex-enrollments", response_model=None)
def flex_enrollment_register(
    request: FlexRegistration, scope_id: Scope, session: DB, user: User
) -> dict[str, Any]:
    def step() -> dict[str, Any]:
        row = flex_adoption.register_enrollment(
            session, scope_id, request.payload, user.user_id
        )
        return {
            "entity_id": row.entity_id,
            "revision": row.revision,
            "status": "registered",
        }

    return flex_step(session, scope_id, user, "flex-enrollment:register", request, step)


@router.post("/flex-enrollments/{enrollment_id}/confirm", response_model=None)
def flex_enrollment_confirm(
    enrollment_id: str,
    request: FlexConfirmation,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    return flex_step(
        session,
        scope_id,
        user,
        "flex-enrollment:confirm:" + enrollment_id,
        request,
        lambda: flex_adoption.confirm_enrollment(
            session, scope_id, enrollment_id, request.expected_revision, user.user_id
        ),
    )


@router.post("/flex-enrollments/{enrollment_id}/withdraw", response_model=None)
def flex_enrollment_withdraw(
    enrollment_id: str,
    request: FlexWithdrawal,
    scope_id: Scope,
    session: DB,
    user: User,
) -> dict[str, Any]:
    return flex_step(
        session,
        scope_id,
        user,
        "flex-enrollment:withdraw:" + enrollment_id,
        request,
        lambda: flex_adoption.withdraw(
            session,
            scope_id,
            "flex_enrollment",
            enrollment_id,
            request.expected_revision,
            request.reason,
            user.user_id,
        ),
    )


@router.get("/flex-settlements", response_model=None)
def flex_settlements(
    scope_id: Scope, session: DB, user: User, input_hash: str | None = None
) -> dict[str, Any]:
    """Flextime settlement per person from the registered input (read only)."""
    access(session, user, scope_id, write=True)
    from shift_scheduler.validation.work_accounting import account_work

    # The registered input with the current records (adoptions confirmed since
    # count); staged_payload checks the stored input's integrity.
    staged = staged_payload(session, scope_id, input_hash)
    data = parse_snapshot(staged)
    if not isinstance(data, SolverSnapshotV2):
        raise HTTPException(409, "版2以降の入力が必要です。")
    flex = sorted(
        {e.person_id for e in data.employments if e.working_time_system == "flex"}
    )
    source = input_hash or session.scalar(
        select(PlanningInput.input_hash)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if not flex:
        return {"input_hash": source, "people": [], "findings": []}
    result = account_work(data, list(data.history))
    names = {p.person_id: p.name for p in data.people}
    return {
        "input_hash": source,
        "people": [
            {
                "person_id": p,
                "name": names.get(p, p),
                "settlements": [
                    s for s in result.get("settlements", []) if s["person_id"] == p
                ],
            }
            for p in flex
        ],
        "findings": [
            f.model_dump(mode="json")
            for f in result["findings"]
            if set(f.subjects) & set(flex) or "flextime" in f.message.lower()
        ],
    }
