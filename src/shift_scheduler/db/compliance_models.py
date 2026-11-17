"""Versioned administration, retention decisions and erasure receipts."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ComplianceEntity(Base):
    __tablename__ = "compliance_entities"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(128))
    person_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    __table_args__ = (UniqueConstraint("scope_id", "kind", "entity_id"),)


class ComplianceRevision(Base):
    __tablename__ = "compliance_revisions"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_key: Mapped[str] = mapped_column(ForeignKey("compliance_entities.key"))
    revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    actor: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    __table_args__ = (UniqueConstraint("entity_key", "revision"),)


class RetentionRule(Base):
    __tablename__ = "retention_rules"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    category: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class LegalHold(Base):
    __tablename__ = "legal_holds"
    hold_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    person_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class PrivacyCase(Base):
    __tablename__ = "privacy_cases"
    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    person_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="REQUESTED")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class ErasurePlan(Base):
    __tablename__ = "erasure_plans"
    plan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="PREVIEW")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class ErasureMarker(Base):
    __tablename__ = "erasure_markers"
    marker_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(64))
    scope_id: Mapped[str] = mapped_column(String(256))
    table_name: Mapped[str] = mapped_column(String(128))
    object_key: Mapped[str] = mapped_column(String(384))
    prior_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class RestoreGate(Base):
    __tablename__ = "restore_gates"
    gate_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    state: Mapped[str] = mapped_column(String(32), default="QUARANTINED")
    marker_manifest_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class ManagedCopy(Base):
    """One managed location/version; content is never duplicated into this ledger."""

    __tablename__ = "managed_copies"
    copy_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256), index=True)
    category: Mapped[str] = mapped_column(String(64))
    medium: Mapped[str] = mapped_column(String(32))
    locator: Mapped[dict[str, Any]] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(32), default="PRESENT")
    subject_status: Mapped[str] = mapped_column(String(32), default="UNVERIFIED")
    anchor: Mapped[str] = mapped_column(String(32))
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)


class CopySubject(Base):
    __tablename__ = "copy_subjects"
    copy_id: Mapped[str] = mapped_column(
        ForeignKey("managed_copies.copy_id"), primary_key=True
    )
    person_id: Mapped[str] = mapped_column(String(64), primary_key=True)


class CopyErasure(Base):
    __tablename__ = "copy_erasures"
    plan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256))
    person_id: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(32), default="PREVIEW")
    revision: Mapped[int] = mapped_column(Integer, default=1)


class ErasedSubject(Base):
    """Minimal, retained control record preventing reintroduction after approved erasure."""

    __tablename__ = "erased_subjects"
    facility_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    person_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)


class PreservedArchive(Base):
    """Read-only partial history, deliberately not a solver input or publication."""

    __tablename__ = "preserved_archives"
    archive_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_id: Mapped[str] = mapped_column(String(256), index=True)
    source_digest: Mapped[str] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class ControlCommit(Base):
    """Receipt committed with the protected operation; no duplicated raw manifest."""

    __tablename__ = "control_commits"
    operation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(128))
    expected_generation: Mapped[int] = mapped_column(Integer)
    manifest_hash: Mapped[str] = mapped_column(String(64))
    receipt_hash: Mapped[str] = mapped_column(String(64))
