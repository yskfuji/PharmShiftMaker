"""希望休 CRUD API."""

from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field

from shift_scheduler.api.dependencies import AppRole, UserPrincipal, get_current_user
from shift_scheduler.audit import record_audit_event
from shift_scheduler.data import load_day_infos
from shift_scheduler.data.holiday_request_store import HolidayRequestStore
from shift_scheduler.domain import DayType, HolidayRequest, HolidayRequestKind

router = APIRouter(prefix="/holiday-requests", tags=["holiday_requests"])
_STORE = HolidayRequestStore()
CalendarYear = Annotated[int, Path(ge=1, le=9999, description="対象年")]
CalendarMonth = Annotated[int, Path(ge=1, le=12, description="対象月")]


class HolidayRequestRecord(BaseModel):
    person_id: str = Field(..., description="職員ID")
    date: date_type = Field(..., description="希望日")
    kind: HolidayRequestKind
    order: int
    is_approved: bool

    @classmethod
    def from_domain(cls, request: HolidayRequest) -> HolidayRequestRecord:
        return cls(
            person_id=request.person_id,
            date=request.request_date,
            kind=request.kind,
            order=request.order,
            is_approved=request.is_approved,
        )


class HolidayRequestListResponse(BaseModel):
    year: int
    month: int
    requests: list[HolidayRequestRecord]


class HolidayRequestUpsertRequest(BaseModel):
    date: date_type = Field(..., description="対象日付")
    kind: HolidayRequestKind = Field(..., description="希望種別")
    person_id: str | None = Field(None, description="代理登録する場合に指定")


class HolidayRequestDeleteRequest(BaseModel):
    date: date_type = Field(..., description="削除対象日付")
    person_id: str | None = Field(None, description="代理削除する場合に指定")


def _resolve_person_id(person_id: str | None, user: UserPrincipal) -> str:
    if user.role == AppRole.PHARMACIST:
        if person_id is not None and person_id != user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="他者の希望休は操作できません",
            )
        return user.user_id
    return person_id or user.user_id


def _load_day_info_map(year: int, month: int) -> dict[date_type, DayType]:
    try:
        day_infos = load_day_infos(year, month, _STORE.config_dir)
    except FileNotFoundError as exc:  # pragma: no cover - propagate as 404
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return {info.day_date: info.day_type for info in day_infos}


def _day_limit(day_type: DayType) -> int:
    if day_type in {DayType.SUNDAY, DayType.YEAR_END}:
        return 4
    return 3


def _validate_person_limit(
    requests: list[HolidayRequest],
    person_id: str,
    target_date: date_type,
    max_days: int = 4,
) -> None:
    per_person_dates = {
        req.request_date for req in requests if req.person_id == person_id
    }
    if target_date in per_person_dates:
        return
    if len(per_person_dates) >= max_days:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="1ヶ月に登録できる希望休は4日までです",
        )


def _validate_day_limit(
    requests: list[HolidayRequest],
    person_id: str,
    target_date: date_type,
    day_type: DayType,
) -> None:
    limit = _day_limit(day_type)
    same_day = [req for req in requests if req.request_date == target_date]
    if any(req.person_id == person_id for req in same_day):
        return
    if len(same_day) >= limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="この日は希望休上限に達しています",
        )


@router.get("/{year}/{month}", response_model=HolidayRequestListResponse)
def list_holiday_requests(
    year: CalendarYear,
    month: CalendarMonth,
    person_id: str | None = Query(None, description="絞り込み対象の職員ID"),
    user: UserPrincipal = Depends(get_current_user),
) -> HolidayRequestListResponse:
    requests = _STORE.list_requests(year, month)
    match user.role:
        case AppRole.PHARMACIST:
            target = _resolve_person_id(person_id, user)
            requests = [req for req in requests if req.person_id == target]
        case _:
            if person_id:
                requests = [req for req in requests if req.person_id == person_id]
    return HolidayRequestListResponse(
        year=year,
        month=month,
        requests=[HolidayRequestRecord.from_domain(req) for req in requests],
    )


@router.post(
    "/{year}/{month}",
    response_model=HolidayRequestRecord,
    status_code=status.HTTP_201_CREATED,
)
def upsert_holiday_request(
    year: CalendarYear,
    month: CalendarMonth,
    payload: HolidayRequestUpsertRequest,
    user: UserPrincipal = Depends(get_current_user),
) -> HolidayRequestRecord:
    person_id = _resolve_person_id(payload.person_id, user)
    if payload.date.year != year or payload.date.month != month:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="対象年月と日付が一致していません",
        )
    day_map = _load_day_info_map(year, month)
    day_type = day_map.get(payload.date)
    if day_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="カレンダーに存在しない日付です",
        )

    requests = _STORE.list_requests(year, month)
    _validate_person_limit(requests, person_id, payload.date)
    _validate_day_limit(requests, person_id, payload.date, day_type)

    new_request = HolidayRequest(
        person_id=person_id,
        request_date=payload.date,
        kind=payload.kind,
        order=1,
        is_approved=False,
    )
    saved = _STORE.upsert_request(year, month, new_request)
    record_audit_event(
        event_type="holiday_request.upsert",
        actor_id=user.user_id,
        actor_role=user.role.value,
        action="upsert_holiday_request",
        target_year=year,
        target_month=month,
        metadata={
            "person_id": person_id,
            "date": payload.date.isoformat(),
            "kind": payload.kind.value,
        },
    )
    return HolidayRequestRecord.from_domain(saved)


@router.delete("/{year}/{month}", response_model=HolidayRequestRecord)
def delete_holiday_request(
    year: CalendarYear,
    month: CalendarMonth,
    payload: HolidayRequestDeleteRequest,
    user: UserPrincipal = Depends(get_current_user),
) -> HolidayRequestRecord:
    person_id = _resolve_person_id(payload.person_id, user)
    if payload.date.year != year or payload.date.month != month:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="対象年月と日付が一致していません",
        )
    try:
        deleted = _STORE.delete_request(year, month, person_id, payload.date)
    except KeyError as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="希望休が見つかりません"
        ) from exc

    record_audit_event(
        event_type="holiday_request.delete",
        actor_id=user.user_id,
        actor_role=user.role.value,
        action="delete_holiday_request",
        target_year=year,
        target_month=month,
        metadata={"person_id": person_id, "date": payload.date.isoformat()},
    )
    return HolidayRequestRecord.from_domain(deleted)


__all__ = [
    "router",
    "HolidayRequestRecord",
    "HolidayRequestUpsertRequest",
    "HolidayRequestDeleteRequest",
]
