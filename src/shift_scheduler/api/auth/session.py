"""Session token helpers shared by auth routes/dependencies."""

from __future__ import annotations

import secrets
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, cast

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.settings import SessionSettings, get_session_settings


class SessionTokenError(Exception):
    """Raised when session token parsing fails."""


class SessionTokenManager:
    """Encodes and decodes signed session payloads."""

    def __init__(self, settings: SessionSettings) -> None:
        self._settings = settings
        self._revoked: set[str] = set()
        self._serializer = URLSafeTimedSerializer(
            secret_key=settings.secret, salt="pharmshift-session"
        )

    def issue(self, principal: UserPrincipal, browser: bool = False) -> str:
        """A browser (cookie) token also ends after the idle timeout; it is
        re-signed by POST /auth/refresh while the person keeps working."""
        payload = self._serialize_principal(principal)
        if browser and self._settings.idle_timeout_seconds:
            payload["idle"] = True
        return self._serializer.dumps(payload)

    def parse(self, token: str) -> UserPrincipal:
        return self._parse(token)[0]

    def parse_browser(self, token: str) -> tuple[UserPrincipal, bool]:
        """The principal and whether the token is a browser token with an idle limit."""
        return self._parse(token)

    def _parse(self, token: str) -> tuple[UserPrincipal, bool]:
        try:
            data: dict[str, Any] = self._serializer.loads(
                token, max_age=self._settings.token_ttl_seconds
            )
            if data.get("idle") and self._settings.idle_timeout_seconds:
                # The signature time is the last renewal: idle limit from there.
                self._serializer.loads(
                    token, max_age=self._settings.idle_timeout_seconds
                )
        except SignatureExpired as exc:  # pragma: no cover - defensive branch
            raise SessionTokenError("session expired") from exc
        except BadSignature as exc:  # pragma: no cover - defensive branch
            raise SessionTokenError("invalid session token") from exc
        try:
            principal = self._deserialize_principal(data)
        except (ValueError, TypeError, KeyError) as exc:
            raise SessionTokenError("Invalid session payload") from exc
        # Absolute limit from the first sign-in, however often the token is renewed.
        issued = (
            principal.issued_at
            if principal.issued_at.tzinfo
            else principal.issued_at.replace(tzinfo=UTC)
        )
        if (
            datetime.now(UTC) - issued
        ).total_seconds() > self._settings.token_ttl_seconds:
            raise SessionTokenError("session expired")
        if principal.session_id in self._revoked:
            raise SessionTokenError("Session revoked")
        from shift_scheduler.api.auth.settings import AuthMode, get_auth_mode

        if get_auth_mode() == AuthMode.OIDC:
            from shift_scheduler.db.planning_models import RevokedSession
            from shift_scheduler.db.session import get_session_factory

            with get_session_factory()() as session:
                if session.get(RevokedSession, principal.session_id):
                    raise SessionTokenError("Session revoked")
        return principal, bool(data.get("idle"))

    def revoke(self, token: str) -> None:
        # Signed-out sessions are revoked even when the idle limit has passed, so
        # the same token cannot be replayed until the absolute limit either.
        try:
            data = self._serializer.loads(
                token, max_age=self._settings.token_ttl_seconds
            )
            principal = self._deserialize_principal(data)
        except (BadSignature, ValueError, TypeError, KeyError) as exc:
            raise SessionTokenError("invalid session token") from exc
        if not principal.session_id:
            raise SessionTokenError("Missing session ID")
        from shift_scheduler.api.auth.settings import AuthMode, get_auth_mode

        if get_auth_mode() == AuthMode.OIDC:
            from shift_scheduler.db.planning_models import RevokedSession
            from shift_scheduler.db.session import get_session_factory

            with get_session_factory().begin() as session:
                session.merge(RevokedSession(session_id=principal.session_id))
        self._revoked.add(principal.session_id)

    def _serialize_principal(self, principal: UserPrincipal) -> dict[str, Any]:
        session_id = principal.session_id or secrets.token_urlsafe(16)
        issued_at = (
            principal.issued_at
            if principal.issued_at.tzinfo
            else principal.issued_at.replace(tzinfo=UTC)
        )
        payload: dict[str, Any] = {
            "user_id": principal.user_id,
            "role": principal.role.value,
            "issued_at": issued_at.isoformat(),
            "session_id": session_id,
            "display_name": principal.display_name,
            "email": principal.email,
            "oid": principal.oid,
        }
        claims = principal.claims
        if claims:
            payload["claims"] = dict(claims)
        return payload

    def _deserialize_principal(self, payload: dict[str, Any]) -> UserPrincipal:
        for required in ("user_id", "role", "issued_at", "session_id"):
            if not isinstance(payload.get(required), str) or not payload[required]:
                raise ValueError("Missing required session field")
        issued_at_raw = payload.get("issued_at")
        issued_at = (
            datetime.fromisoformat(issued_at_raw)
            if isinstance(issued_at_raw, str)
            else datetime.now(UTC)
        )
        role_value = str(payload.get("role", AppRole.PHARMACIST.value))
        try:
            role = AppRole(role_value)
        except ValueError:  # pragma: no cover - defensive branch
            raise SessionTokenError("Unknown role")
        claims_value = payload.get("claims")
        if isinstance(claims_value, dict):
            claims_dict: Mapping[str, Any] | None = cast(dict[str, Any], claims_value)
        else:
            claims_dict = None
        return UserPrincipal(
            user_id=str(payload.get("user_id")),
            role=role,
            issued_at=issued_at,
            session_id=(
                str(payload.get("session_id")) if payload.get("session_id") else None
            ),
            display_name=(
                str(payload.get("display_name"))
                if payload.get("display_name")
                else None
            ),
            email=str(payload.get("email")) if payload.get("email") else None,
            oid=str(payload.get("oid")) if payload.get("oid") else None,
            claims=claims_dict,
        )


_session_manager: SessionTokenManager | None = None


def get_session_manager() -> SessionTokenManager:
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionTokenManager(get_session_settings())
    return _session_manager


__all__ = ["SessionTokenError", "SessionTokenManager", "get_session_manager"]
