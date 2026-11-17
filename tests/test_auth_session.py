from __future__ import annotations

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.session import SessionTokenManager
from shift_scheduler.api.auth.settings import SessionSettings


def _dummy_settings() -> SessionSettings:
    return SessionSettings(
        secret="test-secret",
        token_ttl_seconds=3600,
        cookie_name="test_token",
        display_cookie_name="test_user",
        role_cookie_name="test_role",
        cookie_domain=None,
        cookie_secure=False,
        cookie_samesite="lax",
        frontend_base_url="https://localhost:3000",
    )


def test_session_manager_roundtrip() -> None:
    manager = SessionTokenManager(_dummy_settings())
    principal = UserPrincipal(
        user_id="alice",
        role=AppRole.LEADER,
        display_name="Alice Example",
        email="alice@example.com",
        oid="0000-1111",
    )

    token = manager.issue(principal)
    parsed = manager.parse(token)

    assert parsed.user_id == principal.user_id
    assert parsed.role == principal.role
    assert parsed.display_name == principal.display_name
    assert parsed.email == principal.email
    assert parsed.oid == principal.oid
    assert parsed.session_id is not None
