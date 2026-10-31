"""Scoped self-service occupation context; permission never supplies a qualification."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from shift_scheduler.api.routers.planning import DB, Scope, User, access
from shift_scheduler.application import compliance
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import PlanningInput
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.enums import Role
from shift_scheduler.domain.planning import Person

router = APIRouter(prefix="/planning", tags=["planning"])


class StaffContext(BaseModel):
    person_id: str
    permission: Literal["ADMIN", "LEADER", "STAFF", "PHARMACIST"]
    occupation: Role | None
    occupation_status: Literal["recorded", "unknown"]


@router.get("/staff-context", response_model=StaffContext)
def staff_context(
    scope_id: Scope, session: DB, user: User, response: Response
) -> StaffContext:
    member = access(session, user, scope_id)
    row = session.scalar(
        select(PlanningInput)
        .where(PlanningInput.scope_id == scope_id)
        .order_by(PlanningInput.input_revision.desc())
        .limit(1)
    )
    occupation = None
    if row:
        if parse_snapshot(row.payload).input_hash != row.input_hash:
            raise HTTPException(409, "Stored input integrity mismatch")
        payload = compliance.overlay(session, scope_id, row.payload)
        person = next(
            (p for p in payload["people"] if p["person_id"] == member.person_id), None
        )
        if person is not None and person.get("occupation") is not None:
            occupation = Role(person["occupation"])
    current = session.get(
        ComplianceEntity, compliance.entity_key(scope_id, "person", member.person_id)
    )
    if current is not None:
        person_record = Person.model_validate(current.payload)
        if (
            person_record.person_id != member.person_id
            or current.scope_id != scope_id
            or current.kind != "person"
        ):
            raise HTTPException(409, "Person record integrity mismatch")
        occupation = person_record.occupation
    response.headers["Cache-Control"] = "no-store"
    return StaffContext.model_validate(
        {
            "person_id": member.person_id,
            "permission": member.role,
            "occupation": occupation,
            "occupation_status": "recorded" if occupation is not None else "unknown",
        }
    )
