"""Retention is a reviewed, effective policy, not a universal number of years."""

from datetime import date
from typing import Literal

from pydantic import Field

from .planning import Evidence, Value


class RetentionPolicy(Value):
    category: Literal[
        "planning_history",
        "compliance",
        "identity",
        "audit",
        "privacy_cases",
        "exports",
        "backups",
        "control",
    ]
    purpose: str = Field(min_length=1)
    anchor: Literal["period_end", "last_activity", "case_closed", "backup_created"]
    retention_days: int = Field(ge=1)
    legal_minimum_days: int = Field(ge=0)
    effective_from: date
    effective_until: date
    evidence: Evidence
    owner: str = Field(min_length=1)
    next_review: date


class PrivacyRequest(Value):
    person_id: str
    kind: Literal["access", "rectify", "restrict", "erase"]
    reason: str = Field(min_length=1, max_length=2000)


class PrivacyDecision(Value):
    expected_revision: int = Field(ge=1)
    status: Literal["VERIFIED", "APPROVED", "REJECTED", "COMPLETED", "RELEASED"]
    identity_evidence: Evidence
    reason: str = Field(min_length=1, max_length=2000)
    result_reference: str | None = None
