"""Leave quota management API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from shift_scheduler.api.dependencies import AppRole, require_roles
from shift_scheduler.data import load_leave_quotas, load_people
from shift_scheduler.data.leave_quota_store import LeaveQuotaStore
from shift_scheduler.domain import HolidayRequestKind, LeaveQuota

router = APIRouter(prefix="/leave-quotas", tags=["leave_quotas"])
_STORE = LeaveQuotaStore()
_SUPPORTED_KINDS = {
    HolidayRequestKind.PAID_LEAVE_REQUEST,
    HolidayRequestKind.SUMMER_LEAVE_REQUEST,
    HolidayRequestKind.REFRESH_LEAVE_REQUEST,
}


class LeaveQuotaRecord(BaseModel):
    person_id: str
    person_name: str | None
    year: int
    month: int
    kind: HolidayRequestKind
    total_days: int = Field(..., ge=0)
    used_days: int = Field(..., ge=0)
    used_before_month: int = Field(..., ge=0)
    remaining_days: int = Field(..., ge=0)


class LeaveQuotaListResponse(BaseModel):
    year: int
    month: int
    items: list[LeaveQuotaRecord]


class LeaveQuotaUpsertRequest(BaseModel):
    total_days: int = Field(..., ge=0, le=60)


def _person_name_map() -> dict[str, str]:
    return {person.person_id: person.name for person in load_people()}


def _ensure_kind_supported(kind: HolidayRequestKind) -> None:
    if kind not in _SUPPORTED_KINDS:
        allowed = ", ".join(sorted(item.value for item in _SUPPORTED_KINDS))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{kind.value} は休暇クォータの対象外です (許可: {allowed})",
        )


def _to_record(
    entry: LeaveQuota, person_name: str | None, year: int, month: int
) -> LeaveQuotaRecord:
    remaining = max(0, entry.total_days - entry.used_days)
    return LeaveQuotaRecord(
        person_id=entry.person_id,
        person_name=person_name,
        year=year,
        month=month,
        kind=entry.kind,
        total_days=entry.total_days,
        used_days=entry.used_days,
        used_before_month=entry.used_before_month,
        remaining_days=remaining,
    )


@router.get("/", response_model=LeaveQuotaListResponse)
def list_leave_quotas(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _: None = Depends(require_roles(AppRole.LEADER, AppRole.ADMIN, AppRole.DEVELOPER)),
) -> LeaveQuotaListResponse:
    people = _person_name_map()
    quotas = load_leave_quotas(year, month)
    records = [
        _to_record(entry, people.get(entry.person_id), year, month) for entry in quotas
    ]
    return LeaveQuotaListResponse(year=year, month=month, items=records)


@router.put("/{year}/{person_id}/{kind}", response_model=LeaveQuotaRecord)
def upsert_leave_quota(
    year: int,
    person_id: str,
    kind: HolidayRequestKind,
    payload: LeaveQuotaUpsertRequest,
    month: int = Query(..., ge=1, le=12, description="残数計算に使用する月"),
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> LeaveQuotaRecord:
    _ensure_kind_supported(kind)
    people = _person_name_map()
    if person_id not in people:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="指定した職員が見つかりません"
        )
    quota = LeaveQuota(
        person_id=person_id, year=year, kind=kind, total_days=payload.total_days
    )
    _STORE.upsert(quota)
    refreshed = _find_quota(year, month, person_id, kind)
    if refreshed is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="クォータ更新結果を取得できませんでした",
        )
    return _to_record(refreshed, people.get(person_id), year, month)


@router.delete("/{year}/{person_id}/{kind}", status_code=status.HTTP_204_NO_CONTENT)
def delete_leave_quota(
    year: int,
    person_id: str,
    kind: HolidayRequestKind,
    _: None = Depends(require_roles(AppRole.ADMIN, AppRole.DEVELOPER)),
) -> None:
    _ensure_kind_supported(kind)
    _STORE.delete(person_id, year, kind)


def _find_quota(
    year: int, month: int, person_id: str, kind: HolidayRequestKind
) -> LeaveQuota | None:
    for entry in load_leave_quotas(year, month):
        if entry.person_id == person_id and entry.kind == kind:
            return entry
    return None


__all__ = ["router"]
