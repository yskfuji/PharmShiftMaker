"""Additive persistence for reviewed, immutable planning revisions."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

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
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PlanningScope(Base):
    __tablename__ = "planning_scopes"
    scope_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    input_revision: Mapped[int] = mapped_column(Integer, default=0)
    data_revision: Mapped[int] = mapped_column(Integer, default=0)
    source_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Human-facing facility/department name. Legacy rows intentionally fall
    # back to scope_id at the API boundary instead of inventing a label.
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)


class PlanningInput(Base):
    __tablename__ = "planning_inputs"
    input_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(ForeignKey("planning_scopes.scope_id"))
    input_revision: Mapped[int] = mapped_column(Integer)
    data_revision: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class PlanningJob(Base):
    __tablename__ = "planning_jobs"
    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    input_hash: Mapped[str] = mapped_column(ForeignKey("planning_inputs.input_hash"))
    status: Mapped[str] = mapped_column(String(32), default="QUEUED")
    requested_by: Mapped[str] = mapped_column(String(128))
    request_key: Mapped[str] = mapped_column(String(128), unique=True)
    budget_seconds: Mapped[int] = mapped_column(Integer, default=25)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # A separate post-commit observation; NULL means it was not recorded (e.g. crash).
    persisted_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stage_seconds: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class PlanningDraft(Base):
    __tablename__ = "planning_drafts"
    draft_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    input_hash: Mapped[str] = mapped_column(ForeignKey("planning_inputs.input_hash"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    proposal: Mapped[dict[str, Any]] = mapped_column(JSON)
    validation: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_by: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")


class PlanningPublication(Base):
    __tablename__ = "planning_publications"
    publication_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("planning_drafts.draft_id"), unique=True
    )
    scope_id: Mapped[str] = mapped_column(ForeignKey("planning_scopes.scope_id"))
    period_key: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    published_by: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    __table_args__ = (UniqueConstraint("scope_id", "period_key", "version"),)


class PlanningHead(Base):
    __tablename__ = "planning_heads"
    key: Mapped[str] = mapped_column(String(384), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    publication_id: Mapped[str | None] = mapped_column(
        ForeignKey("planning_publications.publication_id"), nullable=True
    )


class LeaveBalance(Base):
    __tablename__ = "planning_leave_balances"
    grant_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    person_id: Mapped[str] = mapped_column(String(64))
    employer_id: Mapped[str] = mapped_column(String(128))
    amount: Mapped[int] = mapped_column(Integer)
    consumed: Mapped[int] = mapped_column(Integer, default=0)
    reserved: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class LeaveEvent(Base):
    __tablename__ = "planning_leave_events"
    event_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    grant_id: Mapped[str] = mapped_column(
        ForeignKey("planning_leave_balances.grant_id")
    )
    publication_id: Mapped[str | None] = mapped_column(
        ForeignKey("planning_publications.publication_id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    amount: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class PlanningOutbox(Base):
    __tablename__ = "planning_outbox"
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(64))
    scope_id: Mapped[str] = mapped_column(String(256))
    actor: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    delivered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class PlanningReceipt(Base):
    __tablename__ = "planning_receipts"
    receipt_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict[str, Any]] = mapped_column(JSON)


class AccountMembership(Base):
    __tablename__ = "account_memberships"
    membership_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    issuer: Mapped[str] = mapped_column(String(512))
    subject: Mapped[str] = mapped_column(String(256))
    person_id: Mapped[str] = mapped_column(String(64))
    scope_id: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    evidence: Mapped[dict[str, Any]] = mapped_column(
        JSON, default=dict, server_default=text("'{}'")
    )
    created_by: Mapped[str] = mapped_column(
        String(128), default="migration", server_default="migration"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    deactivated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    __table_args__ = (UniqueConstraint("issuer", "subject", "scope_id"),)


class PlanningChangeCase(Base):
    """Absence/swap workflow; published schedules remain immutable."""

    __tablename__ = "planning_change_cases"
    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(ForeignKey("planning_scopes.scope_id"))
    publication_id: Mapped[str] = mapped_column(
        ForeignKey("planning_publications.publication_id")
    )
    kind: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    version: Mapped[int] = mapped_column(Integer, default=1)
    affected_assignments: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    proposed_assignments: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    validation: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    __table_args__ = (Index("ix_change_cases_scope_status", "scope_id", "status"),)


class PlanningChangeEvent(Base):
    __tablename__ = "planning_change_events"
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("planning_change_cases.case_id"))
    kind: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(128))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class StaffLifecycleCase(Base):
    __tablename__ = "staff_lifecycle_cases"
    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(ForeignKey("planning_scopes.scope_id"))
    person_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(24))
    effective_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), default="IN_PROGRESS")
    version: Mapped[int] = mapped_column(Integer, default=1)
    tasks: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    __table_args__ = (Index("ix_lifecycle_scope_status", "scope_id", "status"),)


class StaffLifecycleEvent(Base):
    __tablename__ = "staff_lifecycle_events"
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("staff_lifecycle_cases.case_id"))
    kind: Mapped[str] = mapped_column(String(32))
    task_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor: Mapped[str] = mapped_column(String(128))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class RevokedSession(Base):
    __tablename__ = "revoked_sessions"
    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revoked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class ActualWorkEvent(Base):
    __tablename__ = "actual_work_events"
    key: Mapped[str] = mapped_column(String(256), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    external_id: Mapped[str] = mapped_column(String(128))
    revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("scope_id", "external_id", "revision"),)


class NotificationRead(Base):
    __tablename__ = "planning_notification_reads"
    key: Mapped[str] = mapped_column(String(256), primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("planning_outbox.event_id"))
    person_id: Mapped[str] = mapped_column(String(64))
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class PlanningRequest(Base):
    __tablename__ = "planning_requests"
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    person_id: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    decision: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class PlanningInputHead(Base):
    __tablename__ = "planning_input_heads"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(ForeignKey("planning_scopes.scope_id"))
    input_hash: Mapped[str] = mapped_column(ForeignKey("planning_inputs.input_hash"))
