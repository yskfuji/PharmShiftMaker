"""Database configuration utilities."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DatabaseSettings(BaseModel):
    """Settings for establishing database connections."""

    url: str = Field(
        default="postgresql+psycopg://shift_scheduler:shift_scheduler@localhost:5432/pharmshift",
        description="SQLAlchemy database URL",
    )
    echo: bool = Field(
        default=False, description="Enable SQL echo logging for SQLAlchemy"
    )

    @classmethod
    def from_environment(cls) -> DatabaseSettings:
        from os import getenv

        from shift_scheduler.security.secrets import get_secret

        primary = get_secret("DATABASE_URL")
        legacy = getenv("SHIFT_SCHEDULER_DB_URL")
        if getenv("PHARMSHIFT_ENV") == "production" and not (primary or legacy):
            raise RuntimeError(
                "Production requires an explicit authoritative database URL"
            )
        if primary and legacy and primary != legacy:
            raise ValueError("DATABASE_URL and SHIFT_SCHEDULER_DB_URL disagree")

        return cls(
            url=primary or legacy or cls.model_fields["url"].default,
            echo=getenv("SHIFT_SCHEDULER_DB_ECHO", "false").lower()
            in {"1", "true", "yes"},
        )
