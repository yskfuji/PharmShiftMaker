"""認証エンドポイント (開発用 + OIDC 本番実装)."""

from __future__ import annotations

from contextlib import suppress
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote, urljoin, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.oidc import (
    OIDCError,
    build_login_state,
    get_oidc_provider,
    get_oidc_state_manager,
)
from shift_scheduler.api.auth.session import get_session_manager
from shift_scheduler.api.auth.settings import (
    AuthMode,
    get_auth_mode,
    get_session_settings,
)
from shift_scheduler.api.dependencies import (
    InvalidCredentialsError,
    authenticate_mock_user,
    get_authenticated_principal,
    get_current_user,
    issue_development_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])
AUTH_MODE = get_auth_mode()
SESSION_SETTINGS = get_session_settings()
SESSION_MANAGER = get_session_manager()


class CurrentIdentity(BaseModel):
    user_id: str
    display_name: str | None
    global_role: AppRole
    identifier_kind: Literal["login_id", "account_id"]


@router.get("/me", response_model=CurrentIdentity)
def current_identity(
    response: Response, principal: UserPrincipal = Depends(get_authenticated_principal)
) -> CurrentIdentity:
    """Read the validated principal without issuing/renewing a session."""
    response.headers["Cache-Control"] = "no-store"
    return CurrentIdentity(
        user_id=principal.user_id,
        display_name=principal.display_name,
        global_role=principal.role,
        identifier_kind="account_id" if AUTH_MODE == AuthMode.OIDC else "login_id",
    )


class LegacyIdentityContext(BaseModel):
    person_id: str
    effective_role: AppRole


@router.get("/legacy-context", response_model=LegacyIdentityContext)
def legacy_identity_context(
    response: Response, principal: UserPrincipal = Depends(get_current_user)
) -> LegacyIdentityContext:
    """Explicit old unscoped API projection; ambiguous memberships remain refused."""
    response.headers["Cache-Control"] = "no-store"
    return LegacyIdentityContext(
        person_id=principal.user_id, effective_role=principal.role
    )


class LoginRequest(BaseModel):
    """開発用ログインリクエスト."""

    username: str = Field(..., description="ユーザーID")
    password: str = Field(..., description="パスワード（開発用ダミー）")


class LoginResponse(BaseModel):
    """擬似トークンレスポンス."""

    access_token: str = Field(..., description="Bearer トークン")
    token_type: str = Field(default="bearer", description="常に bearer")
    role: AppRole
    user_id: str
    issued_at: datetime
    expires_in: int = Field(
        default=3600,
        description="モック環境のトークン寿命（秒）。実運用では IdP 依存。",
    )


def _apply_session_cookie(
    response: Response, token: str, principal: UserPrincipal, max_age: int | None = None
) -> None:
    cookie_kwargs: dict[str, Any] = {
        "max_age": SESSION_SETTINGS.token_ttl_seconds if max_age is None else max_age,
        "secure": SESSION_SETTINGS.cookie_secure,
        "httponly": True,
        "samesite": SESSION_SETTINGS.cookie_samesite,
    }
    if SESSION_SETTINGS.cookie_domain:
        cookie_kwargs["domain"] = SESSION_SETTINGS.cookie_domain
    response.set_cookie(SESSION_SETTINGS.cookie_name, token, **cookie_kwargs)
    display_kwargs: dict[str, Any] = {**cookie_kwargs, "httponly": False}
    response.set_cookie(
        SESSION_SETTINGS.display_cookie_name,
        quote(principal.display_name or principal.user_id, safe=""),
        **display_kwargs,
    )
    response.set_cookie(
        SESSION_SETTINGS.role_cookie_name,
        principal.role.value,
        **display_kwargs,
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        SESSION_SETTINGS.cookie_name, domain=SESSION_SETTINGS.cookie_domain
    )
    response.delete_cookie(
        SESSION_SETTINGS.display_cookie_name, domain=SESSION_SETTINGS.cookie_domain
    )
    response.delete_cookie(
        SESSION_SETTINGS.role_cookie_name, domain=SESSION_SETTINGS.cookie_domain
    )


def _ensure_oidc_enabled() -> None:
    if AUTH_MODE != AuthMode.OIDC:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OIDC is not enabled"
        )


def _sanitize_redirect_path(path: str | None) -> str:
    # Browsers drop tabs and line breaks from URLs and read "\\" as "/", so such
    # values could turn into "//host"; the joined target must also stay on the frontend.
    if (
        not path
        or not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path)
    ):
        return "/dashboard"
    base = SESSION_SETTINGS.frontend_base_url
    if urlsplit(_join_frontend(base, path))[:2] != urlsplit(base)[:2]:
        return "/dashboard"
    return path


def _join_frontend(base: str, path: str) -> str:
    return urljoin(f"{base}/", path.lstrip("/"))


def _build_frontend_redirect(path: str) -> str:
    base = SESSION_SETTINGS.frontend_base_url
    target = _join_frontend(base, path)
    # A stored path is checked again: only the frontend's own origin is a destination.
    if urlsplit(target)[:2] != urlsplit(base)[:2]:
        return _join_frontend(base, "/dashboard")
    return target


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, response: Response) -> LoginResponse:
    """ユーザー名/パスワードで簡易認証し、擬似トークンを発行する (開発モードのみ)."""

    if AUTH_MODE != AuthMode.MOCK:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Username/password login is disabled",
        )
    try:
        principal: UserPrincipal = authenticate_mock_user(
            payload.username, payload.password
        )
    except InvalidCredentialsError as exc:  # pragma: no cover - error branch
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    # One session for both tokens, so signing out revokes the header token too.
    from dataclasses import replace
    from secrets import token_urlsafe

    principal = replace(principal, session_id=principal.session_id or token_urlsafe(16))
    token = issue_development_token(principal)
    # The cookie is the browser session (idle limit); the returned token is for
    # scripts that authenticate with a header and has only the absolute limit.
    _apply_session_cookie(
        response, SESSION_MANAGER.issue(principal, browser=True), principal
    )
    return LoginResponse(
        access_token=token,
        role=principal.role,
        user_id=principal.user_id,
        issued_at=principal.issued_at,
    )


@router.get("/oidc/authorize")
async def start_oidc_login(redirect_to: str | None = "/dashboard") -> Response:
    """OIDC 認証フローを開始する."""

    _ensure_oidc_enabled()
    provider = get_oidc_provider()
    state_manager = get_oidc_state_manager()
    safe_path = _sanitize_redirect_path(redirect_to)
    login_state = build_login_state(safe_path)
    try:
        authorization_url = await provider.build_authorization_url(login_state)
    except OIDCError as exc:  # pragma: no cover - provider failure guard
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    response = RedirectResponse(
        authorization_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )
    cookie_kwargs: dict[str, Any] = {
        "max_age": state_manager.ttl_seconds,
        "httponly": True,
        "secure": SESSION_SETTINGS.cookie_secure,
        "samesite": SESSION_SETTINGS.cookie_samesite,
    }
    if SESSION_SETTINGS.cookie_domain:
        cookie_kwargs["domain"] = SESSION_SETTINGS.cookie_domain
    response.set_cookie(
        state_manager.cookie_name, state_manager.encode(login_state), **cookie_kwargs
    )
    return response


@router.get("/oidc/callback")
async def complete_oidc_login(
    request: Request, code: str | None = None, state: str | None = None
) -> Response:
    """OIDC コールバックでトークンを検証し、アプリ内セッションを確立."""

    _ensure_oidc_enabled()
    if not code or not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state"
        )

    state_manager = get_oidc_state_manager()
    serialized_state = request.cookies.get(state_manager.cookie_name)
    if not serialized_state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing OIDC state cookie"
        )
    try:
        login_state = state_manager.decode(serialized_state)
    except OIDCError as exc:  # pragma: no cover - invalid state guard
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    if login_state.state != state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="State mismatch"
        )

    provider = get_oidc_provider()
    try:
        token_response = await provider.exchange_code(code, login_state.code_verifier)
        id_token = token_response.get("id_token")
        if not isinstance(id_token, str):
            raise OIDCError("Token response missing id_token")
        claims = await provider.verify_id_token(id_token, login_state.nonce)
        principal = provider.build_principal(claims)
    except OIDCError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    token = SESSION_MANAGER.issue(principal, browser=True)
    target_url = _build_frontend_redirect(login_state.redirect_to)
    response = RedirectResponse(target_url, status_code=status.HTTP_302_FOUND)
    _apply_session_cookie(response, token, principal)
    response.delete_cookie(
        state_manager.cookie_name, domain=SESSION_SETTINGS.cookie_domain
    )
    return response


class SessionState(BaseModel):
    idle_timeout_seconds: int
    absolute_expires_at: datetime


@router.post("/refresh", response_model=SessionState)
async def refresh(request: Request, response: Response) -> SessionState:
    """Renew the browser session while the person is working (idle limit).

    Called by the page when there was user activity; background polling must not
    call it. The absolute limit from the first sign-in is kept.
    """
    from datetime import UTC, timedelta

    from shift_scheduler.api.auth.session import SessionTokenError

    token = request.cookies.get(SESSION_SETTINGS.cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session"
        )
    try:
        principal, browser = SESSION_MANAGER.parse_browser(token)
    except SessionTokenError as exc:
        _clear_session_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        ) from exc
    issued = (
        principal.issued_at
        if principal.issued_at.tzinfo
        else principal.issued_at.replace(tzinfo=UTC)
    )
    expires = issued + timedelta(seconds=SESSION_SETTINGS.token_ttl_seconds)
    remaining = max(0, int((expires - datetime.now(UTC)).total_seconds()))
    if browser:
        _apply_session_cookie(
            response,
            SESSION_MANAGER.issue(principal, browser=True),
            principal,
            remaining,
        )
    return SessionState(
        idle_timeout_seconds=SESSION_SETTINGS.idle_timeout_seconds if browser else 0,
        absolute_expires_at=expires,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response) -> Response:
    """セッションクッキーを破棄してサインアウト."""

    token = request.cookies.get(SESSION_SETTINGS.cookie_name)
    authorization = request.headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        token = authorization[7:]
    if token:
        from shift_scheduler.api.auth.session import SessionTokenError

        with suppress(SessionTokenError):
            SESSION_MANAGER.revoke(token)
    _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


__all__ = ["router"]
