"""Repository for staff, profile, and timeline data."""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from shift_scheduler.domain import (
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    LeaveQuota,
    Person,
    Profile,
    Role,
    TimelineEntry,
    TimelineStatus,
)

from ..models import (
    HolidayRequestModel,
    LeaveQuotaModel,
    PersonModel,
    ProfileModel,
    TimelineEntryModel,
)


class ConfigRepository:
    """Reads domain models from the relational database."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_people(self) -> list[Person]:
        stmt = select(PersonModel)
        rows = self._session.scalars(stmt).all()
        return [
            Person(person_id=row.person_id, name=row.name, role=Role(row.role))
            for row in rows
        ]

    def list_profiles(self) -> list[Profile]:
        rows = self._session.scalars(select(ProfileModel)).all()
        profiles: list[Profile] = []
        for row in rows:
            profiles.append(
                Profile(
                    profile_id=row.profile_id,
                    name=row.name,
                    employment_type=EmploymentType(row.employment_type),
                    can_night_duty=row.can_night_duty,
                    can_on_call=row.can_on_call,
                    can_evening=row.can_evening,
                    can_ward_alone=row.can_ward_alone,
                    weekend_allowed=row.weekend_allowed,
                    holiday_allowed=row.holiday_allowed,
                    allowed_weekdays=row.allowed_weekdays,
                    max_consecutive_working_days=row.max_consecutive_working_days,
                    night_duty_min=row.night_duty_min,
                    night_duty_max=row.night_duty_max,
                    on_call_min=row.on_call_min,
                    on_call_max=row.on_call_max,
                    evening_min=row.evening_min,
                    evening_max=row.evening_max,
                )
            )
        return profiles

    def list_timeline_entries(self) -> list[TimelineEntry]:
        stmt = select(TimelineEntryModel)
        rows = self._session.scalars(stmt).all()
        entries: list[TimelineEntry] = []
        for row in rows:
            entries.append(
                TimelineEntry(
                    person_id=row.person_id,
                    from_date=row.from_date,
                    to_date=row.to_date,
                    profile_id=row.profile_id,
                    status=TimelineStatus(row.status),
                )
            )
        return entries

    def list_holiday_requests(self, year: int, month: int) -> list[HolidayRequest]:
        start_date = date(year, month, 1)
        end_date = _month_end(start_date)
        upper_bound = (
            HolidayRequestModel.request_date < end_date
            if end_date is not None
            else HolidayRequestModel.request_date <= date.max
        )
        stmt = select(HolidayRequestModel).where(
            and_(
                HolidayRequestModel.request_date >= start_date,
                upper_bound,
            )
        )
        rows = self._session.scalars(stmt).all()
        requests: list[HolidayRequest] = []
        for row in rows:
            requests.append(
                HolidayRequest(
                    person_id=row.person_id,
                    request_date=row.request_date,
                    kind=HolidayRequestKind(row.kind),
                    order=row.order,
                    is_approved=row.is_approved,
                )
            )
        requests.sort(key=lambda r: (r.request_date, r.order))
        return requests

    def list_leave_quotas(self, year: int) -> list[LeaveQuota]:
        stmt = select(LeaveQuotaModel).where(LeaveQuotaModel.year == year)
        rows = self._session.scalars(stmt).all()
        quotas: list[LeaveQuota] = []
        for row in rows:
            quotas.append(
                LeaveQuota(
                    person_id=row.person_id,
                    year=row.year,
                    kind=HolidayRequestKind(row.leave_type),
                    total_days=row.total_days,
                )
            )
        return quotas


def _month_end(start: date) -> date | None:
    if start.month == 12:
        if start.year == date.max.year:
            return None
        return date(start.year + 1, 1, 1)
    return date(start.year, start.month + 1, 1)
