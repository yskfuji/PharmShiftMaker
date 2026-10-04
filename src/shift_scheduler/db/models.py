"""SQLAlchemy ORM models."""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class PersonModel(TimestampMixin, Base):
    __tablename__ = "people"

    person_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)

    timeline_entries: Mapped[list[TimelineEntryModel]] = relationship(
        back_populates="person"
    )
    holiday_requests: Mapped[list[HolidayRequestModel]] = relationship(
        back_populates="person"
    )
    leave_quotas: Mapped[list[LeaveQuotaModel]] = relationship(back_populates="person")


class ProfileModel(TimestampMixin, Base):
    __tablename__ = "profiles"

    profile_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    employment_type: Mapped[str] = mapped_column(String(32), nullable=False)
    can_night_duty: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    can_on_call: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
    can_evening: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    can_ward_alone: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    weekend_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    holiday_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    allowed_weekdays: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    max_consecutive_working_days: Mapped[int] = mapped_column(
        Integer, default=6, server_default="6"
    )
    night_duty_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    night_duty_max: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    on_call_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    on_call_max: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    evening_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    evening_max: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    timeline_entries: Mapped[list[TimelineEntryModel]] = relationship(
        back_populates="profile"
    )


class TimelineEntryModel(TimestampMixin, Base):
    __tablename__ = "staff_timeline"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("people.person_id", ondelete="CASCADE"), nullable=False
    )
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("profiles.profile_id", ondelete="CASCADE"), nullable=False
    )
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)

    person: Mapped[PersonModel] = relationship(back_populates="timeline_entries")
    profile: Mapped[ProfileModel] = relationship(back_populates="timeline_entries")

    __table_args__ = (
        UniqueConstraint("person_id", "from_date", name="uq_timeline_person_from"),
    )


class HolidayRequestModel(TimestampMixin, Base):
    __tablename__ = "holiday_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("people.person_id", ondelete="CASCADE"), nullable=False
    )
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_approved: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    person: Mapped[PersonModel] = relationship(back_populates="holiday_requests")

    __table_args__ = (
        UniqueConstraint(
            "person_id", "request_date", name="uq_holiday_requests_person_date"
        ),
    )


class LeaveQuotaModel(TimestampMixin, Base):
    __tablename__ = "leave_quotas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("people.person_id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    leave_type: Mapped[str] = mapped_column(String(32), nullable=False)
    total_days: Mapped[int] = mapped_column(Integer, nullable=False)

    person: Mapped[PersonModel] = relationship(back_populates="leave_quotas")

    __table_args__ = (
        UniqueConstraint(
            "person_id", "year", "leave_type", name="uq_leave_quota_person_year_kind"
        ),
    )


class ScheduleSnapshotModel(TimestampMixin, Base):
    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_by: Mapped[str] = mapped_column(String(64), nullable=False)

    assignments: Mapped[list[ScheduleAssignmentModel]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("year", "month", name="uq_schedule_year_month"),)


class ScheduleAssignmentModel(Base):
    __tablename__ = "schedule_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False
    )
    person_id: Mapped[str] = mapped_column(String(64), nullable=False)
    assignment_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_id: Mapped[str] = mapped_column(String(32), nullable=False)

    schedule: Mapped[ScheduleSnapshotModel] = relationship(back_populates="assignments")

    __table_args__ = (
        Index("ix_schedule_assignments_date", "assignment_date"),
        Index("ix_schedule_assignments_person", "person_id"),
        UniqueConstraint(
            "schedule_id",
            "person_id",
            "assignment_date",
            "shift_id",
            name="uq_schedule_assignment",
        ),
    )


# Register additive planning tables in the shared Alembic metadata.
from . import compliance_models as compliance_models  # noqa: E402,F401
from . import planning_models as planning_models  # noqa: E402,F401
