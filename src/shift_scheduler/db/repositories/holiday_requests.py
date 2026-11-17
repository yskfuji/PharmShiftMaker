"""Repository for holiday request persistence."""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from shift_scheduler.domain import HolidayRequest, HolidayRequestKind

from ..models import HolidayRequestModel


class HolidayRequestRepository:
    """Provides CRUD helpers for monthly holiday requests."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_month(self, year: int, month: int) -> list[HolidayRequest]:
        end_date = _month_end(year, month)
        upper_bound = (
            HolidayRequestModel.request_date < end_date
            if end_date is not None
            else HolidayRequestModel.request_date <= date.max
        )
        stmt = select(HolidayRequestModel).where(
            and_(
                HolidayRequestModel.request_date >= date(year, month, 1),
                upper_bound,
            )
        )
        rows = self._session.scalars(stmt).all()
        return [self._to_domain(row) for row in rows]

    def upsert(self, request: HolidayRequest) -> HolidayRequest:
        stmt = select(HolidayRequestModel).where(
            and_(
                HolidayRequestModel.person_id == request.person_id,
                HolidayRequestModel.request_date == request.request_date,
            )
        )
        existing = self._session.scalar(stmt)
        if existing:
            existing.kind = request.kind.value
            existing.is_approved = request.is_approved
            self._session.add(existing)
            self._session.flush()
            return request.model_copy(
                update={"order": existing.order, "is_approved": existing.is_approved}
            )

        new_order = self._next_order(
            request.request_date.year, request.request_date.month
        )
        model = HolidayRequestModel(
            person_id=request.person_id,
            request_date=request.request_date,
            kind=request.kind.value,
            order=new_order,
            is_approved=request.is_approved,
        )
        self._session.add(model)
        self._session.flush()
        return request.model_copy(update={"order": new_order})

    def delete(self, person_id: str, target_date: date) -> HolidayRequest | None:
        stmt = select(HolidayRequestModel).where(
            and_(
                HolidayRequestModel.person_id == person_id,
                HolidayRequestModel.request_date == target_date,
            )
        )
        row = self._session.scalar(stmt)
        if row is None:
            return None
        result = self._to_domain(row)
        self._session.delete(row)
        self._session.flush()
        return result

    def replace_month(
        self, year: int, month: int, requests: list[HolidayRequest]
    ) -> None:
        month_start = date(year, month, 1)
        month_end = _month_end(year, month)
        upper_bound = (
            HolidayRequestModel.request_date < month_end
            if month_end is not None
            else HolidayRequestModel.request_date <= date.max
        )
        stmt = delete(HolidayRequestModel).where(
            and_(
                HolidayRequestModel.request_date >= month_start,
                upper_bound,
            )
        )
        self._session.execute(stmt)
        for request in requests:
            model = HolidayRequestModel(
                person_id=request.person_id,
                request_date=request.request_date,
                kind=request.kind.value,
                order=request.order,
                is_approved=request.is_approved,
            )
            self._session.add(model)
        self._session.flush()

    def _next_order(self, year: int, month: int) -> int:
        month_end = _month_end(year, month)
        upper_bound = (
            HolidayRequestModel.request_date < month_end
            if month_end is not None
            else HolidayRequestModel.request_date <= date.max
        )
        stmt = select(func.max(HolidayRequestModel.order)).where(
            and_(
                HolidayRequestModel.request_date >= date(year, month, 1),
                upper_bound,
            )
        )
        current_max = self._session.scalar(stmt)
        return (current_max or 0) + 1

    @staticmethod
    def _to_domain(row: HolidayRequestModel) -> HolidayRequest:
        return HolidayRequest(
            person_id=row.person_id,
            request_date=row.request_date,
            kind=HolidayRequestKind(row.kind),
            order=row.order,
            is_approved=row.is_approved,
        )


def _month_end(year: int, month: int) -> date | None:
    if month == 12:
        if year == date.max.year:
            return None
        return date(year + 1, 1, 1)
    return date(year, month + 1, 1)
