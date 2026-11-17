"""Fail closed for explicitly configured production deployments."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from shift_scheduler.api.auth.settings import (
    AuthMode,
    get_auth_mode,
    get_oidc_settings,
    get_session_settings,
)
from shift_scheduler.db.settings import DatabaseSettings


def check_production() -> None:
    if os.getenv("PHARMSHIFT_ENV", "development") != "production":
        return
    session = get_session_settings()
    if os.getenv("SHIFT_SCHEDULER_DATA_BACKEND") != "db":
        raise RuntimeError("Production cannot fall back to development YAML data")
    if get_auth_mode() != AuthMode.OIDC:
        raise RuntimeError(
            "Production requires OIDC; development accounts are disabled"
        )
    oidc = get_oidc_settings()
    if oidc is None or any(
        urlsplit(value).scheme != "https"
        for value in (oidc.metadata_url, oidc.redirect_uri, session.frontend_base_url)
    ):
        raise RuntimeError("Production authentication endpoints require HTTPS")
    if len(session.secret) < 32 or not session.cookie_secure:
        raise RuntimeError(
            "Production requires a strong session secret and secure cookies"
        )
    if not DatabaseSettings.from_environment().url.startswith("postgresql"):
        raise RuntimeError("Production requires the authoritative PostgreSQL database")
    origins = os.getenv("API_CORS_ALLOW_ORIGINS", "")
    if not origins or any(
        urlsplit(value.strip()).scheme != "https" or "*" in value
        for value in origins.split(",")
    ):
        raise RuntimeError("Production requires explicit HTTPS browser origins")
    from shift_scheduler.control.client import configured_client

    configured_client()  # Missing independent authority is a production configuration error.
