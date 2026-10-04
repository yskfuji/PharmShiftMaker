"""S03 shared terminals: browser sessions end after 15 minutes without use, renewal
keeps the absolute limit, sign-out revokes even an idle-expired token, and the
interactive API docs are off (OWASP ASVS 5.0 V7.3.1/7.3.2/7.4.1; user decision
2026-09-27: 15 minutes).
"""

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import itsdangerous.timed
import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.session import SessionTokenError, SessionTokenManager
from shift_scheduler.api.auth.settings import SessionSettings

ROOT = Path(__file__).resolve().parents[1]


def manager(idle=900, ttl=8 * 3600):
    return SessionTokenManager(
        SessionSettings(
            secret="s" * 32,
            token_ttl_seconds=ttl,
            cookie_name="t",
            display_cookie_name="u",
            role_cookie_name="r",
            cookie_domain=None,
            cookie_secure=True,
            cookie_samesite="lax",
            frontend_base_url="https://app.test",
            idle_timeout_seconds=idle,
        )
    )


def principal(issued_at=None):
    return UserPrincipal(
        user_id="admin",
        role=AppRole.ADMIN,
        session_id="sid-1",
        issued_at=issued_at or datetime.now(UTC),
    )


class Clock:
    """Shifts only itsdangerous' signature clock (renewal times)."""

    def __init__(self, offset=0.0):
        self.offset = offset

    def time(self):
        import time

        return time.time() + self.offset


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(itsdangerous.timed, "time", fake)
    return fake


def test_a_browser_token_ends_after_the_idle_limit(clock):
    m = manager(idle=900)
    browser, script = m.issue(principal(), browser=True), m.issue(principal())
    clock.offset = 899
    assert m.parse_browser(browser)[1] is True
    clock.offset = 901
    with pytest.raises(SessionTokenError):
        m.parse(browser)  # also when sent in an Authorization header
    assert m.parse_browser(script) == (m.parse(script), False)


def test_renewal_keeps_the_absolute_limit(clock):
    m = manager(idle=900, ttl=8 * 3600)
    old = principal(issued_at=datetime.now(UTC) - timedelta(hours=8, seconds=1))
    with pytest.raises(SessionTokenError):
        m.parse(m.issue(old, browser=True))  # freshly signed, but the sign-in is 8h old


def test_sign_out_revokes_an_idle_expired_token(clock):
    m = manager(idle=900)
    browser = m.issue(principal(), browser=True)
    script = m.issue(principal())  # same session id
    clock.offset = 1000
    m.revoke(browser)
    clock.offset = 0
    with pytest.raises(SessionTokenError, match="revoked"):
        m.parse(script)


def test_no_idle_limit_when_disabled(clock):
    m = manager(idle=0)
    token = m.issue(principal(), browser=True)
    clock.offset = 3 * 3600
    assert m.parse_browser(token)[1] is False


def test_refresh_renews_the_cookie_and_sign_out_ends_it(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(
        app,
        base_url="https://localhost:8000",
        headers={"Origin": "https://localhost:3000"},
    ) as client:
        login = client.post(
            "/auth/login", json={"username": "admin", "password": "pass-admin"}
        )
        cookie = client.cookies.get("pharmshift_token")
        assert (
            cookie and cookie != login.json()["access_token"]
        )  # the header token has no idle limit
        renewed = client.post("/auth/refresh")
        assert renewed.status_code == 200, renewed.text
        assert renewed.json()["idle_timeout_seconds"] == 900
        assert "pharmshift_token=" in renewed.headers["set-cookie"]
        header = login.json()["access_token"]
        assert client.post("/auth/logout").status_code == 204
        # Both tokens share the session: the header token is revoked as well.
        assert (
            client.get(
                "/planning/scopes", headers={"Authorization": "Bearer " + header}
            ).status_code
            == 401
        )
        client.cookies.set("pharmshift_token", cookie)  # a copied cookie is refused
        assert client.post("/auth/refresh").status_code == 401
        assert (
            client.get(
                "/planning/scopes", headers={"Authorization": "Bearer " + cookie}
            ).status_code
            == 401
        )
        client.cookies.clear()
        assert client.post("/auth/refresh").status_code == 401


def test_the_interactive_docs_are_off_and_production_hides_the_schema(
    sqlite_session_factory,
):
    from shift_scheduler.api.main import app

    with TestClient(app, base_url="https://localhost:8000") as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/openapi.json").status_code == 200
    code = (
        "from shift_scheduler.api.main import app\n"
        "print(app.openapi_url, app.docs_url, app.redoc_url)"
    )
    env = {
        **os.environ,
        "PHARMSHIFT_ENV": "production",
        "DATABASE_URL": "sqlite+pysqlite:///:memory:",
        "SHIFT_SCHEDULER_DB_URL": "sqlite+pysqlite:///:memory:",
    }
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True
    )
    assert out.stdout.split() == ["None", "None", "None"], out.stderr[-500:]


@pytest.mark.asyncio
async def test_oidc_sign_in_always_asks_the_provider_for_credentials():
    # Shared terminals: prompt=login, so a sign-in after sign-out never continues
    # the previous person's identity-provider session.
    from urllib.parse import parse_qs, urlparse

    from shift_scheduler.api.auth.oidc import OIDCProvider, build_login_state
    from shift_scheduler.api.auth.settings import OIDCSettings

    provider = OIDCProvider(
        OIDCSettings(
            metadata_url="https://issuer.invalid/.well-known/openid-configuration",
            client_id="client",
            client_secret="synthetic-test-only",
            redirect_uri="https://app.invalid/callback",
            scopes=("openid",),
            role_claim="roles",
            admin_roles=("admin",),
            developer_roles=(),
            leader_roles=(),
            pharmacist_roles=(),
            default_role=AppRole.PHARMACIST,
            user_id_claims=("sub",),
            email_claims=("email",),
            name_claims=("name",),
            state_cookie_name="state",
            state_ttl_seconds=300,
            jwks_cache_seconds=3600,
            http_timeout=1,
        )
    )
    provider._metadata = {"authorization_endpoint": "https://issuer.invalid/authorize"}
    url = await provider.build_authorization_url(build_login_state("/planning"))
    assert parse_qs(urlparse(url).query)["prompt"] == ["login"]


def test_sign_out_works_while_the_control_state_is_unavailable(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api.main import app
    from shift_scheduler.control import client as control
    from shift_scheduler.db.restore_lock import RestoreUnavailable
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(
        app,
        base_url="https://localhost:8000",
        headers={"Origin": "https://localhost:3000"},
    ) as client:
        client.post("/auth/login", json={"username": "admin", "password": "pass-admin"})
        cookie = client.cookies.get("pharmshift_token")

        def blocked():
            raise RestoreUnavailable("control state unavailable")

        monkeypatch.setattr(control, "require_access", blocked)
        assert client.post("/auth/refresh").status_code == 503  # other operations stop
        assert (
            client.post("/auth/logout").status_code == 204
        )  # sign-out still completes
        monkeypatch.undo()
        client.cookies.set("pharmshift_token", cookie)
        assert client.post("/auth/refresh").status_code == 401
