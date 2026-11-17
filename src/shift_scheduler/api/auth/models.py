"""Authentication domain models used across API layers."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any


class AppRole(str, Enum):
    """Application-level RBAC roles."""

    PHARMACIST = "PHARMACIST"
    LEADER = "LEADER"
    ADMIN = "ADMIN"
    DEVELOPER = "DEVELOPER"


@dataclass(frozen=True)
class UserPrincipal:
    """Represents an authenticated user."""

    user_id: str
    role: AppRole
    issued_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    session_id: str | None = None
    display_name: str | None = None
    email: str | None = None
    oid: str | None = None
    claims: Mapping[str, Any] | None = None


__all__ = ["AppRole", "UserPrincipal"]
