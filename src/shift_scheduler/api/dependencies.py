"""API 層の依存関係 (フェーズ7: セキュリティ枠組み)."""

from __future__ import annotations

import os
from collections.abc import Callable, Generator, Iterable
from dataclasses import replace
from typing import Any, TypedDict

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.session import SessionTokenError, get_session_manager
from shift_scheduler.api.auth.settings import (
    AuthMode,
    get_auth_mode,
    get_session_settings,
)
from shift_scheduler.security.secrets import get_secret


class DummyDBSession(dict[str, Any]):
    """シンプルな in-memory DB セッションのダミー実装."""

    pass


security_scheme = HTTPBearer(auto_error=False)
SESSION_SETTINGS = get_session_settings()
SESSION_MANAGER = get_session_manager()
AUTH_MODE = get_auth_mode()


def _secret_or_default(env_key: str, default: str) -> str:
    value = get_secret(env_key)
    if value is None:
        return default
    return value


class InvalidCredentialsError(Exception):
    """モック認証失敗時の内部例外."""


class MockUserRecord(TypedDict):
    password: str
    role: AppRole


_MOCK_USER_DB: dict[str, MockUserRecord] = {
    "pharmacist": {
        "password": _secret_or_default("AUTH_PASSWORD_PHARMACIST", "pass-ph"),
        "role": AppRole.PHARMACIST,
    },
    "leader": {
        "password": _secret_or_default("AUTH_PASSWORD_LEADER", "pass-lead"),
        "role": AppRole.LEADER,
    },
    "admin": {
        "password": _secret_or_default("AUTH_PASSWORD_ADMIN", "pass-admin"),
        "role": AppRole.ADMIN,
    },
    "developer": {
        "password": _secret_or_default("AUTH_PASSWORD_DEVELOPER", "pass-dev"),
        "role": AppRole.DEVELOPER,
    },
}


def authenticate_mock_user(username: str, password: str) -> UserPrincipal:
    """固定ユーザーDBを用いた擬似認証 (AUTH_MODE=mock 限定)."""

    if AUTH_MODE != AuthMode.MOCK:
        raise InvalidCredentialsError("mock authentication is disabled")
    record = _MOCK_USER_DB.get(username)
    if record is None or record["password"] != password:
        raise InvalidCredentialsError("invalid username or password")
    return UserPrincipal(user_id=username, role=record["role"], display_name=username)


def issue_development_token(principal: UserPrincipal) -> str:
    """現在のプリンシパル情報でアクセストークンを発行."""

    return SESSION_MANAGER.issue(principal)


def get_db_session() -> Generator[DummyDBSession, None, None]:
    """開発用の疑似 DB セッションを提供する依存関数."""

    session = DummyDBSession()
    try:
        yield session
    finally:
        session.clear()


def _token_from_cookies(request: Request) -> str | None:
    return request.cookies.get(SESSION_SETTINGS.cookie_name)


def get_authenticated_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
) -> UserPrincipal:
    """HTTP ヘッダー or クッキーからユーザー情報を取得."""

    if request.headers.get("authorization") is not None and credentials is None:
        raise HTTPException(status_code=401, detail="Invalid authorization scheme")
    token = credentials.credentials if credentials is not None else None
    if token is None:
        token = _token_from_cookies(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing credentials"
        )
    try:
        principal = SESSION_MANAGER.parse(token)
    except SessionTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc
    return principal


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
) -> UserPrincipal:
    """Legacy/scoped authorization projection, separate from account identity."""
    principal = get_authenticated_principal(request, credentials)
    if not request.url.path.startswith(("/planning", "/auth")) and (
        os.getenv("SHIFT_SCHEDULER_DATA_BACKEND") == "db"
        or os.getenv("PHARMSHIFT_ENV") == "production"
    ):
        from sqlalchemy import select

        from shift_scheduler.db.compliance_models import PrivacyCase, RestoreGate
        from shift_scheduler.db.session import get_session_factory

        with get_session_factory()() as session:
            gate = session.get(RestoreGate, "restore")
            if gate and gate.state != "REPLAYED":
                raise HTTPException(503, "Restored data remains quarantined")
            if not request.url.path.startswith(
                ("/planning", "/auth")
            ) and session.scalar(
                select(PrivacyCase.case_id)
                .where(
                    PrivacyCase.kind == "restrict",
                    PrivacyCase.status.in_(["APPROVED", "COMPLETED"]),
                )
                .limit(1)
            ):
                raise HTTPException(
                    423, "Legacy unscoped access is suspended by use restriction policy"
                )
    if get_auth_mode() == AuthMode.OIDC:
        from shift_scheduler.api.routers.planning import memberships
        from shift_scheduler.db.session import get_session_factory

        with get_session_factory()() as session:
            active = memberships(session, principal)
            if not active:
                raise HTTPException(403, "No active account membership")
            # Legacy APIs have no department scope: only a single membership is safe.
            if not request.url.path.startswith("/planning"):
                if len(active) != 1:
                    raise HTTPException(403, "Use scoped planning API")
                principal = replace(
                    principal, user_id=active[0].person_id, role=AppRole(active[0].role)
                )
    return principal


def require_roles(*allowed_roles: AppRole) -> Callable[..., UserPrincipal]:
    """指定ロールのみ許可する FastAPI 依存関数を動的生成."""

    if not allowed_roles:
        raise ValueError("allowed_roles must not be empty")

    def _dependency(user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role"
            )
        return user

    return _dependency


def ensure_self_or_roles(
    target_user_id: str,
    allowed_roles: Iterable[AppRole],
    user: UserPrincipal = Depends(get_current_user),
) -> UserPrincipal:
    """自分自身または指定ロールのみ許可する依存関数."""

    if user.user_id == target_user_id or user.role in allowed_roles:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Action not permitted"
    )


__all__ = [
    "AppRole",
    "UserPrincipal",
    "DummyDBSession",
    "get_db_session",
    "get_current_user",
    "require_roles",
    "ensure_self_or_roles",
    "authenticate_mock_user",
    "issue_development_token",
    "InvalidCredentialsError",
]
