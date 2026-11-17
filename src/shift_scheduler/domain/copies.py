from typing import Literal

from pydantic import AwareDatetime, Field

from .planning import Evidence, Value


class CopyRegistration(Value):
    copy_id: str = Field(min_length=1, max_length=64)
    category: Literal[
        "planning_history",
        "compliance",
        "identity",
        "audit",
        "privacy_cases",
        "exports",
        "backups",
    ]
    medium: Literal["file", "backup", "external"]
    relative_path: str = Field(min_length=1, max_length=1024)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    person_ids: tuple[str, ...]
    anchor: Literal["period_end", "last_activity", "case_closed", "backup_created"]
    anchor_at: AwareDatetime
    evidence: Evidence
    subject_status: Literal["VERIFIED", "UNVERIFIED"] = "UNVERIFIED"


class CopyPreviewRequest(Value):
    person_id: str = Field(min_length=1, max_length=64)


class CopyExecuteRequest(Value):
    plan_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class DatabaseCopyReview(Value):
    copy_id: str = Field(min_length=1, max_length=64)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    person_ids: tuple[str, ...]
    evidence: Evidence


class SharedProjectionReview(Value):
    copy_id: str = Field(min_length=1, max_length=64)
    person_id: str = Field(min_length=1, max_length=64)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    projection_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    shared_text_reviewed: Literal[True]
    evidence: Evidence
