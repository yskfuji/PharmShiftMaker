"""シフト生成 API ルーター."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from shift_scheduler.api.dependencies import (
    AppRole,
    UserPrincipal,
    get_current_user,
    require_roles,
)
from shift_scheduler.audit import record_audit_event
from shift_scheduler.data import load_all
from shift_scheduler.data.schedule_store import ScheduleStore
from shift_scheduler.domain import Assignment
from shift_scheduler.optimizer import solve_schedule
from shift_scheduler.optimizer.solver import SolverError
from shift_scheduler.optimizer.validation import validate_manual_assignments
from shift_scheduler.optimizer.warnings import generate_schedule_warnings

router = APIRouter(prefix="/schedules", tags=["schedules"])
SCHEDULE_STORE = ScheduleStore()


class ScheduleGenerateRequest(BaseModel):
    """POST /schedules/generate のリクエストボディ."""

    year: int = Field(..., ge=2000, le=2100, description="生成対象の西暦年")
    month: int = Field(..., ge=1, le=12, description="生成対象の月 (1-12)")
    trial_mode: bool = Field(
        default=True,
        description="True の場合は結果をDBに保存せずレスポンスのみ返す",
    )
    expected_version: int | None = Field(
        default=None,
        ge=0,
        description="trial_mode=False の場合に必要となるロックバージョン",
    )
    manual_assignments: list[Assignment] | None = Field(
        default=None,
        description="手動調整した割当を反映する場合に指定する",
    )


def _warning_list_factory() -> list[ScheduleWarning]:
    return []


class ScheduleWarning(BaseModel):
    code: str
    severity: Literal["info", "warning", "critical"]
    message: str
    context: dict[str, Any] = Field(default_factory=dict)


class ScheduleGenerateResponse(BaseModel):
    """シフト生成結果のレスポンスモデル."""

    year: int
    month: int
    trial_mode: bool
    generated_at: date
    total_assignments: int
    assignments: list[Assignment]
    warnings: list[ScheduleWarning] = Field(default_factory=_warning_list_factory)
    lock_version: int | None = Field(
        default=None, description="確定済みシフトの現在バージョン"
    )


def _apply_manual_assignments(
    base_assignments: list[Assignment],
    manual_assignments: list[Assignment] | None,
) -> list[Assignment]:
    if not manual_assignments:
        return base_assignments

    assignments_by_date: dict[date, list[Assignment]] = {}
    for assignment in base_assignments:
        assignments_by_date.setdefault(assignment.assignment_date, []).append(
            assignment
        )

    manual_by_date: dict[date, list[Assignment]] = {}
    for override in manual_assignments:
        manual_by_date.setdefault(override.assignment_date, []).append(override)

    for day, overrides in manual_by_date.items():
        assignments_by_date[day] = overrides

    merged: list[Assignment] = []
    for day in sorted(assignments_by_date.keys()):
        merged.extend(assignments_by_date[day])
    return merged


def _visible_assignments_for_user(
    assignments: list[Assignment], user: UserPrincipal
) -> list[Assignment]:
    if user.role == AppRole.PHARMACIST:
        return [
            assignment
            for assignment in assignments
            if assignment.person_id == user.user_id
        ]
    return assignments


@router.post("/generate", response_model=ScheduleGenerateResponse)
def generate_schedule(
    payload: ScheduleGenerateRequest,
    user: UserPrincipal = Depends(
        require_roles(AppRole.LEADER, AppRole.ADMIN, AppRole.DEVELOPER)
    ),
) -> ScheduleGenerateResponse:
    """ソルバを呼び出して指定年月のシフト表を計算する."""

    if not payload.trial_mode:
        raise HTTPException(
            410, detail="Use /planning: generate, review, then publish the same draft"
        )

    try:
        config = load_all(payload.year, payload.month)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc

    persisted = SCHEDULE_STORE.load(payload.year, payload.month)
    current_version = persisted.version if persisted else 0

    try:
        assignments = solve_schedule(config)
    except SolverError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error_code": "schedule.infeasible",
                "message": "指定された条件ではシフトを生成できませんでした。勤務条件や希望休を見直してください。",
                "solver_message": str(exc),
            },
        ) from exc
    assignments = _apply_manual_assignments(assignments, payload.manual_assignments)
    manual_warnings = (
        validate_manual_assignments(assignments, config)
        if payload.manual_assignments
        else []
    )
    warning_entries = [
        *manual_warnings,
        *generate_schedule_warnings(assignments, config),
    ]
    warning_models = [
        ScheduleWarning(
            code=entry.code,
            severity=entry.severity,
            message=entry.message,
            context=entry.context,
        )
        for entry in warning_entries
    ]

    lock_version: int | None = current_version
    if not payload.trial_mode:
        if payload.expected_version is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="expected_version が必要です",
            )
        if payload.expected_version != current_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="他のユーザーによって更新されました",
            )
        new_version = current_version + 1
        persisted = SCHEDULE_STORE.save(
            payload.year, payload.month, assignments, new_version, user.user_id
        )
        lock_version = persisted.version
    else:
        lock_version = current_version

    record_audit_event(
        event_type="schedule.generate",
        actor_id=user.user_id,
        actor_role=user.role.value,
        action="generate_schedule",
        target_year=payload.year,
        target_month=payload.month,
        metadata={
            "trial_mode": payload.trial_mode,
            "total_assignments": len(assignments),
            "lock_version": lock_version,
            "manual_override_days": len(
                {
                    assignment.assignment_date
                    for assignment in payload.manual_assignments or []
                }
            ),
        },
    )

    return ScheduleGenerateResponse(
        year=payload.year,
        month=payload.month,
        trial_mode=payload.trial_mode,
        generated_at=date.today(),
        total_assignments=len(assignments),
        assignments=assignments,
        warnings=warning_models,
        lock_version=lock_version,
    )


@router.get("/{year}/{month}", response_model=ScheduleGenerateResponse)
async def get_confirmed_schedule(
    year: int,
    month: int,
    user: UserPrincipal = Depends(get_current_user),
) -> ScheduleGenerateResponse:
    persisted = SCHEDULE_STORE.load(year, month)
    if persisted is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="確定済みシフトが存在しません"
        )

    visible_assignments = _visible_assignments_for_user(persisted.assignments, user)

    return ScheduleGenerateResponse(
        year=year,
        month=month,
        trial_mode=False,
        generated_at=persisted.updated_at.date(),
        total_assignments=len(visible_assignments),
        assignments=visible_assignments,
        warnings=[
            ScheduleWarning(
                code="legacy.unverified",
                severity="warning",
                message="旧版の保存表です。契約・法令の検証状態は未確認です。",
            )
        ],
        lock_version=persisted.version,
    )


__all__ = [
    "router",
    "ScheduleGenerateRequest",
    "ScheduleGenerateResponse",
    "get_confirmed_schedule",
]
