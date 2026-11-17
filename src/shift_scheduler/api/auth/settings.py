"""Configuration helpers for authentication components."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from typing import Literal, cast

from shift_scheduler.api.auth.models import AppRole


def _getenv(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value


def _getbool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _hours_to_seconds(hours: int) -> int:
    return int(hours) * 3600


class AuthMode(str, Enum):
    """Available authentication strategies."""

    MOCK = "mock"
    OIDC = "oidc"


@dataclass(frozen=True)
class SessionSettings:
    """Session/token management configuration."""

    secret: str
    token_ttl_seconds: int
    cookie_name: str
    display_cookie_name: str
    role_cookie_name: str
    cookie_domain: str | None
    cookie_secure: bool
    cookie_samesite: Literal["lax", "none", "strict"]
    frontend_base_url: str
    # Browser sessions end after this many seconds without use (0: no idle limit).
    idle_timeout_seconds: int = 15 * 60


@dataclass(frozen=True)
class OIDCSettings:
    """OIDC IdP integration configuration."""

    metadata_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: tuple[str, ...]
    role_claim: str
    admin_roles: tuple[str, ...]
    developer_roles: tuple[str, ...]
    leader_roles: tuple[str, ...]
    pharmacist_roles: tuple[str, ...]
    default_role: AppRole
    user_id_claims: tuple[str, ...]
    email_claims: tuple[str, ...]
    name_claims: tuple[str, ...]
    state_cookie_name: str
    state_ttl_seconds: int
    jwks_cache_seconds: int
    http_timeout: float


def _resolve_auth_mode() -> AuthMode:
    explicit = _getenv("AUTH_MODE")
    if explicit:
        try:
            return AuthMode(explicit.lower())
        except ValueError as exc:  # pragma: no cover - defensive branch
            raise ValueError(f"Unsupported AUTH_MODE: {explicit}") from exc
    azure_toggle = _getbool("AZURE_AD_ENABLE", False)
    return AuthMode.OIDC if azure_toggle else AuthMode.MOCK


@lru_cache(maxsize=1)
def get_auth_mode() -> AuthMode:
    return _resolve_auth_mode()


@lru_cache(maxsize=1)
def get_session_settings() -> SessionSettings:
    secret = _getenv("AUTH_JWT_SECRET", "change-me") or "change-me"
    ttl_hours = int(_getenv("AUTH_TOKEN_TTL_HOURS", "8") or "8")
    cookie_name = (
        _getenv("AUTH_SESSION_COOKIE_NAME", "pharmshift_token") or "pharmshift_token"
    )
    display_cookie = (
        _getenv("AUTH_DISPLAY_NAME_COOKIE", "pharmshift_user") or "pharmshift_user"
    )
    role_cookie = _getenv("AUTH_ROLE_COOKIE", "pharmshift_role") or "pharmshift_role"
    frontend_base = (
        _getenv("FRONTEND_BASE_URL", "https://localhost:3000")
        or "https://localhost:3000"
    )
    samesite_raw = (_getenv("AUTH_COOKIE_SAMESITE", "lax") or "lax").lower()
    if samesite_raw not in {"lax", "none", "strict"}:
        samesite_raw = "lax"
    cookie_samesite = cast(Literal["lax", "none", "strict"], samesite_raw)
    return SessionSettings(
        secret=secret,
        token_ttl_seconds=_hours_to_seconds(ttl_hours),
        cookie_name=cookie_name,
        display_cookie_name=display_cookie,
        role_cookie_name=role_cookie,
        cookie_domain=_getenv("AUTH_COOKIE_DOMAIN"),
        cookie_secure=_getbool("AUTH_COOKIE_SECURE", False),
        cookie_samesite=cookie_samesite,
        frontend_base_url=frontend_base.rstrip("/"),
        idle_timeout_seconds=max(
            0,
            int(
                _getenv("AUTH_IDLE_TIMEOUT_SECONDS", "")
                or 60 * int(_getenv("AUTH_IDLE_TIMEOUT_MINUTES", "15") or "15")
            ),
        ),
    )


def _claims_tuple(
    value: Sequence[str] | None, fallback: Sequence[str]
) -> tuple[str, ...]:
    items = list(value) if value else list(fallback)
    normalized: list[str] = []
    for item in items:
        if item:
            normalized.append(item.strip())
    return tuple(normalized)


@lru_cache(maxsize=1)
def get_oidc_settings() -> OIDCSettings | None:
    mode = get_auth_mode()
    if mode != AuthMode.OIDC:
        return None

    metadata_url = _getenv("OIDC_METADATA_URL")
    client_id = _getenv("OIDC_CLIENT_ID")
    client_secret = _getenv("OIDC_CLIENT_SECRET")
    redirect_uri = _getenv("OIDC_REDIRECT_URI")
    if not all(
        [metadata_url, client_id, client_secret, redirect_uri]
    ):  # pragma: no cover - env guard
        raise RuntimeError(
            "OIDC mode requires OIDC_METADATA_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI"
        )

    scopes = tuple(
        scope
        for scope in (
            _getenv("OIDC_SCOPES") or "openid profile email offline_access"
        ).split()
        if scope
    )
    role_claim = _getenv("OIDC_ROLE_CLAIM", "roles") or "roles"
    admin_roles = tuple(
        _split_csv(_getenv("OIDC_ROLE_MAPPING_ADMIN")) or ["pharmshift-admin"]
    )
    developer_roles = tuple(
        _split_csv(_getenv("OIDC_ROLE_MAPPING_DEVELOPER")) or ["pharmshift-developer"]
    )
    leader_roles = tuple(
        _split_csv(_getenv("OIDC_ROLE_MAPPING_LEADER")) or ["pharmshift-leader"]
    )
    pharmacist_roles = tuple(
        _split_csv(_getenv("OIDC_ROLE_MAPPING_PHARMACIST")) or ["pharmshift-user"]
    )
    default_role_value = (
        _getenv("OIDC_DEFAULT_ROLE") or AppRole.PHARMACIST.value
    ).upper()
    try:
        default_role = AppRole(default_role_value)
    except ValueError:  # pragma: no cover - defensive branch
        default_role = AppRole.PHARMACIST

    user_id_claims = _claims_tuple(
        _split_csv(_getenv("OIDC_USER_ID_CLAIMS")),
        ("preferred_username", "email", "oid"),
    )
    email_claims = _claims_tuple(
        _split_csv(_getenv("OIDC_EMAIL_CLAIMS")), ("email", "upn")
    )
    name_claims = _claims_tuple(
        _split_csv(_getenv("OIDC_NAME_CLAIMS")), ("name", "given_name")
    )

    assert metadata_url and client_id and client_secret and redirect_uri

    state_cookie_name = (
        _getenv("OIDC_STATE_COOKIE_NAME", "pharmshift_oidc_state")
        or "pharmshift_oidc_state"
    )

    return OIDCSettings(
        metadata_url=metadata_url,
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scopes=scopes,
        role_claim=role_claim,
        admin_roles=admin_roles,
        developer_roles=developer_roles,
        leader_roles=leader_roles,
        pharmacist_roles=pharmacist_roles,
        default_role=default_role,
        user_id_claims=user_id_claims,
        email_claims=email_claims,
        name_claims=name_claims,
        state_cookie_name=state_cookie_name,
        state_ttl_seconds=int(_getenv("OIDC_STATE_TTL_SECONDS", "600") or 600),
        jwks_cache_seconds=int(_getenv("OIDC_JWKS_CACHE_SECONDS", "3600") or 3600),
        http_timeout=float(_getenv("OIDC_HTTP_TIMEOUT_SECONDS", "5") or 5.0),
    )


__all__ = [
    "AuthMode",
    "SessionSettings",
    "OIDCSettings",
    "get_auth_mode",
    "get_session_settings",
    "get_oidc_settings",
]
