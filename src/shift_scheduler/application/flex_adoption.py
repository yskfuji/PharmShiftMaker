"""Facility adoption of flextime: register, review the impact, confirm by a second
administrator, withdraw before the start or end at a settlement period start
(労基法32条の3, 則12条の3; OWASP ASVS 5.0 V2.3.1/V2.3.5).

Default is off: a flextime employment is valid only while a confirmed adoption and
a confirmed enrolment of that person cover it (validation/work_accounting). The
records go through save_entity, so every step leaves a ComplianceRevision with its
actor and an outbox event. Actor identities come from the session only.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.application import compliance as service
from shift_scheduler.application.planning import Blocked, Conflict
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningInput,
    PlanningInputHead,
    PlanningScope,
)
from shift_scheduler.domain.compliance_v3 import (
    JST,
    EmploymentV3,
    FlexAdoption,
    FlexEnrollment,
    settlement_starts,
)
from shift_scheduler.domain.planning import content_hash

SERVER_FIELDS = frozenset(
    {
        "status",
        "created_by",
        "created_at",
        "reviewed_by",
        "reviewed_at",
        "decided_by",
        "decided_at",
        "withdrawal_reason",
        "end_reason",
    }
)


class Refused(Exception):
    """The request is not allowed for this actor (mapped to 403)."""


def now() -> datetime:
    return datetime.now(UTC)


def facility_admin(
    session: Session, memberships: list[AccountMembership], scope: str
) -> None:
    """Facility-wide records need ADMIN in every department of the facility: those
    with planning data and those with members (a department without an input yet
    still counts)."""
    facility = scope.split("/")[0]
    scopes = set(
        session.scalars(
            select(PlanningScope.scope_id).where(
                PlanningScope.scope_id.startswith(facility + "/")
            )
        )
    )
    scopes |= set(
        session.scalars(
            select(AccountMembership.scope_id).where(
                AccountMembership.scope_id.startswith(facility + "/"),
                AccountMembership.active.is_(True),
            )
        )
    )
    admin = {m.scope_id for m in memberships if m.role == "ADMIN" and m.active}
    if not scopes or not scopes <= admin:
        raise Refused("施設内のすべての部署の管理者権限が必要です。")


def _rows(session: Session, scope: str, kind: str) -> list[ComplianceEntity]:
    facility = scope.split("/")[0]
    return list(
        session.scalars(
            select(ComplianceEntity).where(
                ComplianceEntity.scope_id.startswith(facility + "/"),
                ComplianceEntity.kind == kind,
            )
        )
    )


def _row(session: Session, scope: str, kind: str, identity: str) -> ComplianceEntity:
    row = next(
        (r for r in _rows(session, scope, kind) if r.entity_id == identity), None
    )
    if row is None:
        raise LookupError("対象の記録が見つかりません。")
    return row


def _people(session: Session, account: str) -> set[str]:
    """The persons behind an account, to keep registrant, confirmer and enrolled
    person apart even when one person holds several accounts. The account is the
    session's user_id: the subject itself (mock sign-in) or sha256([iss, sub]) (OIDC,
    api/auth/oidc.py build_principal); memberships hold the issuer and subject."""
    people = set()
    for issuer, subject, person in session.execute(
        select(
            AccountMembership.issuer,
            AccountMembership.subject,
            AccountMembership.person_id,
        )
    ):
        derived = hashlib.sha256(json.dumps([issuer, subject]).encode()).hexdigest()
        if account in (subject, derived):
            people.add(person)
    return people


def _separate(
    session: Session, registrant: str, actor: str, person: str | None = None
) -> None:
    mine = _people(session, actor)
    if registrant == actor or mine & _people(session, registrant):
        raise Refused(
            "登録した管理者本人は確認できません。別の管理者が確認してください。"
        )
    if person is not None and person in mine:
        raise Refused("自分自身の参加は確認できません。別の管理者が確認してください。")


def _open_spans(
    session: Session, scope: str, person: str, ignore: str | None = None
) -> list[tuple[datetime, datetime]]:
    """The person's enrolments that are not withdrawn, as (start, adoption end)."""
    adoptions = {
        r.entity_id: FlexAdoption.model_validate(r.payload)
        for r in _rows(session, scope, "flex_adoption")
    }
    spans = []
    for r in _rows(session, scope, "flex_enrollment"):
        n = FlexEnrollment.model_validate(r.payload)
        adoption = adoptions.get(n.adoption_id)
        if (
            n.person_id == person
            and n.status != "withdrawn"
            and r.entity_id != ignore
            and adoption
            and adoption.status != "withdrawn"
        ):
            spans.append((n.start, adoption.end))
    return spans


def _registration(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    if SERVER_FIELDS & payload.keys():
        raise Blocked("状態・登録者・確認者はサーバーが記録します。")
    return {
        **payload,
        "status": "registered",
        "created_by": actor,
        "created_at": now().isoformat(),
    }


def _department(session: Session, scope: str) -> dict[str, Any]:
    """The department's latest input with its administrative records applied."""
    row = session.scalar(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    if row is None:
        raise Blocked("部署の勤務計画の入力がありません。先に入力を登録してください。")
    return service.overlay(session, scope, row.payload)


def register_adoption(
    session: Session, scope: str, payload: dict[str, Any], actor: str
) -> ComplianceEntity:
    parsed = FlexAdoption.model_validate(_registration(payload, actor))
    if parsed.start <= now():
        raise Blocked(
            "採用は、将来の清算期間の初日から始めてください（さかのぼる採用はできません）。"
        )
    sites = [
        x
        for x in _department(session, scope).get("establishments", [])
        if x["establishment_id"] == parsed.establishment_id
    ]
    if not any(
        x["employer_id"] == parsed.employer_id
        and datetime.fromisoformat(x["start"]) <= parsed.start
        and parsed.end <= datetime.fromisoformat(x["end"])
        for x in sites
    ):
        raise Blocked(
            "事業場と雇用主が部署の記録と一致しないか、採用の期間が事業場の期間の外です。"
        )
    value = parsed.model_dump(mode="json")
    if any(
        r.entity_id == value["adoption_id"]
        for r in _rows(session, scope, "flex_adoption")
    ):
        raise Conflict(
            "同じ識別子の採用が登録済みです。変更は取り下げて新しく登録してください。"
        )
    return service.save_entity(session, scope, "flex_adoption", value, 0, actor)


def register_enrollment(
    session: Session, scope: str, payload: dict[str, Any], actor: str
) -> ComplianceEntity:
    value = FlexEnrollment.model_validate(_registration(payload, actor))
    adoption = FlexAdoption.model_validate(
        _row(session, scope, "flex_adoption", value.adoption_id).payload
    )
    if value.start <= now():
        raise Blocked("参加は、将来の清算期間の初日から始めてください。")
    if value.person_id not in {
        p["person_id"] for p in _department(session, scope)["people"]
    }:
        raise Blocked("この部署の職員だけを参加者として登録できます。")
    if adoption.status == "withdrawn":
        raise Blocked("取り下げた採用には参加を登録できません。")
    if not adoption.start <= value.start < adoption.end or value.start.astimezone(
        service.JST
    ).date() not in settlement_starts(adoption):
        raise Blocked("参加の開始は、採用期間内の清算期間の初日にしてください。")
    if any(
        r.entity_id == value.enrollment_id
        for r in _rows(session, scope, "flex_enrollment")
    ):
        raise Conflict("同じ識別子の参加が登録済みです。")
    # One person, one enrolment at a time (overlapping ones would make every input
    # of the person's departments invalid).
    if any(
        value.start < end and start < adoption.end
        for start, end in _open_spans(session, scope, value.person_id)
    ):
        raise Blocked("この職員には、期間の重なる参加がすでにあります。")
    return service.save_entity(
        session, scope, "flex_enrollment", value.model_dump(mode="json"), 0, actor
    )


def impact(session: Session, scope: str, adoption_id: str) -> dict[str, Any]:
    """What confirming changes, and what stops it (shown before the second admin confirms)."""
    adoption = FlexAdoption.model_validate(
        _row(session, scope, "flex_adoption", adoption_id).payload
    )
    enrollments = [
        FlexEnrollment.model_validate(r.payload)
        for r in _rows(session, scope, "flex_enrollment")
        if r.payload.get("adoption_id") == adoption_id
        and r.payload.get("status") != "withdrawn"
    ]
    people = {e.person_id: e for e in enrollments}
    employments = [
        r.payload for r in _rows(session, scope, "employment") if r.person_id in people
    ]
    timed: list[dict[str, Any]] = []
    facility = scope.split("/")[0]
    # The current input of every department and planning period (not superseded ones).
    current = select(PlanningInputHead.input_hash).where(
        PlanningInputHead.scope_id.startswith(facility + "/")
    )
    for row in session.scalars(
        select(PlanningInput)
        .where(PlanningInput.input_hash.in_(current))
        .order_by(PlanningInput.scope_id, PlanningInput.input_revision)
    ):
        for duty in (
            *row.payload.get("candidates", []),
            *row.payload.get("history", []),
        ):
            enrolled = people.get(duty.get("person_id"))
            if (
                enrolled
                and duty.get("source") != "actual"
                and datetime.fromisoformat(duty["start"]) >= enrolled.start
            ):
                timed.append(
                    {
                        "scope_id": row.scope_id,
                        "duty_id": duty["duty_id"],
                        "person_id": duty["person_id"],
                        "start": duty["start"],
                    }
                )
    blocking = []
    if adoption.status != "registered":
        blocking.append("確認できるのは、登録済みで確認待ちの採用だけです。")
    if adoption.start <= now():
        blocking.append(
            "開始日が過ぎています。将来の清算期間の初日から採用してください。"
        )
    for name, evidence in (
        ("就業規則の規定", adoption.work_rules_evidence),
        ("労使協定", adoption.agreement_evidence),
        *((("協定の届出", adoption.filing.evidence),) if adoption.filing else ()),
    ):
        if evidence.status != "verified":
            blocking.append(f"{name}の根拠が確認済みではありません。")
    if (
        adoption.filing
        and adoption.filing.filed_on > adoption.start.astimezone(service.JST).date()
    ):
        blocking.append("協定の届出日が開始日より後です。")
    body = {
        "adoption_id": adoption_id,
        "status": adoption.status,
        "settlement": {
            "months": adoption.settlement_months,
            "anchor": adoption.settlement_anchor.isoformat(),
            "total_hours_rule": adoption.total_hours_rule,
        },
        "people": [
            {
                "person_id": p,
                "enrollment_id": e.enrollment_id,
                "start": e.start.isoformat(),
                "status": e.status,
                "employment_revisions": sorted(
                    x["revision_id"] for x in employments if x["person_id"] == p
                ),
            }
            for p, e in sorted(people.items())
        ],
        "timed_duties": sorted(timed, key=lambda d: (d["start"], d["duty_id"])),
        "blocking": blocking,
        # After confirmation the administrator records each person's flextime
        # employment revision from the enrolment start (it is not split automatically,
        # so no duty is left pointing at a closed revision).
        "next_steps": [
            "参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録する",
            "開始日以降の時刻付き勤務を取り除き、必要配置を他の職員で満たせるか確認する",
        ],
    }
    return {**body, "impact_hash": content_hash(body)}


def confirm_adoption(
    session: Session,
    scope: str,
    adoption_id: str,
    expected: int,
    impact_hash: str,
    actor: str,
) -> dict[str, Any]:
    row = _row(session, scope, "flex_adoption", adoption_id)
    _separate(session, row.payload["created_by"], actor)
    if row.revision != expected:
        raise Conflict("採用の記録が更新されました。影響を確認し直してください。")
    current = impact(session, scope, adoption_id)
    if current["impact_hash"] != impact_hash:
        raise Conflict("影響の内容が変わりました。確認し直してください。")
    if current["blocking"]:
        raise Blocked(" ".join(current["blocking"]))
    stamp = now().isoformat()
    confirmed = {
        **row.payload,
        "status": "confirmed",
        "reviewed_by": actor,
        "reviewed_at": stamp,
    }
    saved = service.save_entity(
        session,
        scope,
        "flex_adoption",
        FlexAdoption.model_validate(confirmed).model_dump(mode="json"),
        expected,
        actor,
    )
    # Enrolments registered with the adoption are confirmed with it, except those
    # this administrator registered or that are the administrator's own (they still
    # need another administrator).
    enrolled, pending = [], []
    for r in _rows(session, scope, "flex_enrollment"):
        if (
            r.payload.get("adoption_id") != adoption_id
            or r.payload.get("status") != "registered"
        ):
            continue
        try:
            _separate(session, r.payload["created_by"], actor, r.person_id)
        except Refused:
            pending.append(r.entity_id)
            continue
        value = {
            **r.payload,
            "status": "confirmed",
            "reviewed_by": actor,
            "reviewed_at": stamp,
        }
        service.save_entity(
            session,
            scope,
            "flex_enrollment",
            FlexEnrollment.model_validate(value).model_dump(mode="json"),
            r.revision,
            actor,
        )
        enrolled.append(r.entity_id)
    return {
        "revision": saved.revision,
        "status": "confirmed",
        "confirmed_enrollments": sorted(enrolled),
        "enrollments_needing_another_admin": sorted(pending),
    }


def confirm_enrollment(
    session: Session, scope: str, enrollment_id: str, expected: int, actor: str
) -> dict[str, Any]:
    row = _row(session, scope, "flex_enrollment", enrollment_id)
    _separate(session, row.payload["created_by"], actor, row.person_id)
    if row.revision != expected:
        raise Conflict("参加の記録が更新されました。確認し直してください。")
    enrollment = FlexEnrollment.model_validate(row.payload)
    adoption = FlexAdoption.model_validate(
        _row(session, scope, "flex_adoption", enrollment.adoption_id).payload
    )
    if enrollment.status != "registered" or adoption.status != "confirmed":
        raise Blocked("確認できるのは、確認済みの採用に属する確認待ちの参加だけです。")
    if enrollment.start <= now():
        raise Blocked(
            "参加の開始日が過ぎています。将来の清算期間の初日から参加してください。"
        )
    value = {
        **row.payload,
        "status": "confirmed",
        "reviewed_by": actor,
        "reviewed_at": now().isoformat(),
    }
    saved = service.save_entity(
        session,
        scope,
        "flex_enrollment",
        FlexEnrollment.model_validate(value).model_dump(mode="json"),
        expected,
        actor,
    )
    return {"revision": saved.revision, "status": "confirmed"}


def withdraw(
    session: Session,
    scope: str,
    kind: str,
    identity: str,
    expected: int,
    reason: str,
    actor: str,
) -> dict[str, Any]:
    """Switching off is the safe direction: one facility administrator, with a reason.
    A confirmed record only before its start: a started settlement period is not
    undone afterwards (an adoption is ended at a later settlement period start
    instead). An unconfirmed record never took effect and can always be withdrawn."""
    model = FlexAdoption if kind == "flex_adoption" else FlexEnrollment
    row = _row(session, scope, kind, identity)
    if row.revision != expected:
        raise Conflict("記録が更新されました。確認し直してください。")
    if row.payload.get("status") == "withdrawn":
        raise Blocked("すでに取り下げられています。")
    if (
        row.payload.get("status") == "confirmed"
        and datetime.fromisoformat(row.payload["start"]) <= now()
    ):
        raise Blocked(
            "開始後は取り下げられません。採用は、将来の清算期間の初日で終了してください。"
            "本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。"
            if kind == "flex_adoption"
            else "開始後の参加は取り下げられません。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。"
        )
    value = {
        **row.payload,
        "status": "withdrawn",
        "decided_by": actor,
        "decided_at": now().isoformat(),
        "withdrawal_reason": reason,
    }
    saved = service.save_entity(
        session,
        scope,
        kind,
        model.model_validate(value).model_dump(mode="json"),
        expected,
        actor,
    )
    return {"revision": saved.revision, "status": "withdrawn"}


def end_adoption(
    session: Session,
    scope: str,
    adoption_id: str,
    expected: int,
    end_on: date,
    reason: str,
    actor: str,
) -> dict[str, Any]:
    """End a confirmed adoption at a future settlement period start. Settlement periods
    already begun stay complete; enrolments that would start later are withdrawn."""
    row = _row(session, scope, "flex_adoption", adoption_id)
    if row.revision != expected:
        raise Conflict("採用の記録が更新されました。確認し直してください。")
    adoption = FlexAdoption.model_validate(row.payload)
    end = datetime.combine(end_on, time(), JST)
    if adoption.status != "confirmed" or adoption.end_reason is not None:
        raise Blocked("終了できるのは、確認済みで終了日を定めていない採用だけです。")
    if adoption.start > now():
        raise Blocked("開始前の採用は、終了ではなく取り下げてください。")
    if not (
        now() < end < adoption.end
        and adoption.start < end
        and end_on in settlement_starts(adoption)
    ):
        raise Blocked("終了日は、採用期間内の将来の清算期間の初日にしてください。")
    stamp = now().isoformat()
    value = {
        **row.payload,
        "end": end.isoformat(),
        "decided_by": actor,
        "decided_at": stamp,
        "end_reason": reason,
    }
    saved = service.save_entity(
        session,
        scope,
        "flex_adoption",
        FlexAdoption.model_validate(value).model_dump(mode="json"),
        expected,
        actor,
    )
    withdrawn = []
    for r in _rows(session, scope, "flex_enrollment"):
        if (
            r.payload.get("adoption_id") == adoption_id
            and r.payload.get("status") != "withdrawn"
            and datetime.fromisoformat(r.payload["start"]) >= end
        ):
            gone = {
                **r.payload,
                "status": "withdrawn",
                "decided_by": actor,
                "decided_at": stamp,
                "withdrawal_reason": "採用の終了に伴う取下げ",
            }
            service.save_entity(
                session,
                scope,
                "flex_enrollment",
                FlexEnrollment.model_validate(gone).model_dump(mode="json"),
                r.revision,
                actor,
            )
            withdrawn.append(r.entity_id)
    return {
        "revision": saved.revision,
        "status": "confirmed",
        "end": end.isoformat(),
        "withdrawn_enrollments": sorted(withdrawn),
    }


def employment_flex_problem(
    session: Session, scope: str, payload: dict[str, Any]
) -> str | None:
    """A flextime employment is saved only within a confirmed adoption and enrolment
    of that person, with the adoption's settlement terms."""
    if payload.get("working_time_system") != "flex":
        return None
    if "establishment_id" not in payload:
        # Without a site the record would be saved in the version-2 form, which the
        # facility adoption (per establishment) cannot cover.
        return "フレックスタイム制の雇用条件には、採用した事業場の指定が必要です。"
    try:
        employment = EmploymentV3.model_validate(payload)
    except ValueError:
        return None  # save_entity reports the invalid record itself
    start, end = employment.start, employment.end
    adoptions = {
        r.entity_id: FlexAdoption.model_validate(r.payload)
        for r in _rows(session, scope, "flex_adoption")
        if r.payload.get("status") == "confirmed"
    }
    for r in _rows(session, scope, "flex_enrollment"):
        if (
            r.person_id != employment.person_id
            or r.payload.get("status") != "confirmed"
        ):
            continue
        enrollment = FlexEnrollment.model_validate(r.payload)
        adoption = adoptions.get(enrollment.adoption_id)
        if adoption is None or (adoption.employer_id, adoption.establishment_id) != (
            employment.employer_id,
            employment.establishment_id,
        ):
            continue
        if not (enrollment.start <= start and end <= adoption.end):
            continue
        terms = (
            employment.flex_anchor,
            employment.flex_months,
            employment.flex_full_two_day_weekend,
            employment.flex_rest_weekdays,
            employment.flex_other_rest_days,
        )
        agreed = (
            adoption.settlement_anchor,
            adoption.settlement_months,
            adoption.total_hours_rule == "full_two_day_weekend",
            adoption.rest_weekdays,
            adoption.other_rest_days,
        )
        if terms != agreed:
            return "フレックスタイム制の清算期間・総枠の条件が、確認済みの採用と一致しません。"
        return None
    return (
        "フレックスタイム制にするには、施設の設定で採用と本人の参加を登録し、別の管理者の確認を受けてください"
        "（雇用条件の期間は参加の開始日から採用の終了日までの範囲にします）。"
    )
