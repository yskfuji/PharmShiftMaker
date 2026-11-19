"""Desktop profile: local accounts, first-run setup and fail-closed configuration."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.api.auth import local
from shift_scheduler.api.auth import settings as auth_settings
from shift_scheduler.api.auth.settings import AuthMode

TOKEN = "s" * 40
ADMIN = {
    "login_id": "head.pharmacist",
    "display_name": "管理者",
    "password": "correct horse battery",
    "facility_id": "hospital",
    "department_id": "pharmacy",
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: Any) -> TestClient:
    monkeypatch.setenv("AUTH_MODE", "local")
    monkeypatch.setenv("PHARMSHIFT_SETUP_TOKEN", TOKEN)
    monkeypatch.setenv("PHARMSHIFT_INSTALL_ID", "test-install-0001")
    auth_settings.get_auth_mode.cache_clear()
    monkeypatch.setattr("shift_scheduler.api.routers.auth.AUTH_MODE", AuthMode.LOCAL)
    # Keep the hashes fast in tests; stored parameters are still honoured on verify.
    monkeypatch.setattr(local, "SCRYPT_N", 2**10)
    monkeypatch.setattr(local, "_DUMMY_HASH", None)
    from shift_scheduler.api.main import app

    test_client = TestClient(app)
    test_client.headers["Origin"] = "https://localhost:3000"
    yield test_client
    auth_settings.get_auth_mode.cache_clear()


def _bootstrap(client: TestClient) -> dict[str, Any]:
    response = client.post("/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": TOKEN})
    assert response.status_code == 201, response.text
    return response.json()


def _login(client: TestClient, login_id: str, password: str) -> Any:
    client.cookies.clear()
    return client.post("/auth/login", json={"username": login_id, "password": password})


def test_password_hash_roundtrip_uses_owasp_scrypt_parameters() -> None:
    encoded = local.hash_password("correct horse battery")
    scheme, n, r, p, _salt, _digest = encoded.split("$")
    assert (scheme, int(n), int(r), int(p)) == ("scrypt", 2**17, 8, 1)
    assert local.verify_password("correct horse battery", encoded)
    assert not local.verify_password("correct horse batterY", encoded)
    assert not local.verify_password("x", "md5$broken")


@pytest.mark.parametrize(
    "password", ["short", "aaaaaaaaaaaaaaaa", "head.pharmacist-2026"]
)
def test_password_policy_rejects_weak_passwords(password: str) -> None:
    with pytest.raises(local.PasswordPolicyError):
        local.check_policy(password, "head.pharmacist")


def test_bootstrap_needs_the_shell_token_and_runs_only_once(client: TestClient) -> None:
    assert client.get("/setup/status").json() == {"initialized": False}
    assert client.post("/setup/bootstrap", json=ADMIN).status_code == 403
    assert (
        client.post("/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": "w" * 40}).status_code
        == 403
    )
    result = _bootstrap(client)
    assert result["scope_id"] == "hospital/pharmacy"
    again = client.post("/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": TOKEN})
    assert again.status_code == 409
    assert client.get("/setup/status").json() == {"initialized": True}


def test_bootstrap_without_configured_token_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PHARMSHIFT_SETUP_TOKEN", "short")
    response = client.post("/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": "short"})
    assert response.status_code == 403


def test_login_locks_after_five_failures_and_hides_which_part_failed(
    client: TestClient, sqlite_session_factory: Any
) -> None:
    _bootstrap(client)
    unknown = _login(client, "nobody", "whatever-password")
    wrong = _login(client, ADMIN["login_id"], "wrong password!!")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()
    for _ in range(4):
        assert _login(client, ADMIN["login_id"], "wrong password!!").status_code == 401
    # Locked: even the correct password is refused for fifteen minutes.
    assert _login(client, ADMIN["login_id"], ADMIN["password"]).status_code == 401
    from shift_scheduler.db.planning_models import LocalAccount

    with sqlite_session_factory.begin() as session:
        account = session.scalar(select(LocalAccount))
        assert account.locked_until is not None
        account.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    assert _login(client, ADMIN["login_id"], ADMIN["password"]).status_code == 200


def test_new_account_must_change_password_before_using_the_api(client: TestClient) -> None:
    _bootstrap(client)
    assert _login(client, ADMIN["login_id"], ADMIN["password"]).status_code == 200
    created = client.post(
        "/local-accounts",
        json={
            "login_id": "pharmacist.a",
            "display_name": "薬剤師A",
            "role": "PHARMACIST",
            "scope_id": "hospital/pharmacy",
        },
    )
    assert created.status_code == 201, created.text
    temporary = created.json()["temporary_password"]
    signed_in = _login(client, "pharmacist.a", temporary)
    assert signed_in.status_code == 200
    assert signed_in.json()["password_change_required"] is True
    assert client.get("/planning/scopes").status_code == 403
    changed = client.post(
        "/auth/password",
        json={"current_password": temporary, "new_password": "a much better passphrase"},
    )
    assert changed.status_code == 204, changed.text
    assert client.get("/planning/scopes").status_code == 200
    assert client.get("/auth/me").json()["identifier_kind"] == "account_id"


def test_non_admin_cannot_manage_accounts(client: TestClient) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    created = client.post(
        "/local-accounts",
        json={
            "login_id": "leader.b",
            "display_name": "リーダーB",
            "role": "LEADER",
            "scope_id": "hospital/pharmacy",
        },
    ).json()
    _login(client, "leader.b", created["temporary_password"])
    client.post(
        "/auth/password",
        json={
            "current_password": created["temporary_password"],
            "new_password": "leader passphrase 2026",
        },
    )
    assert client.get("/local-accounts").status_code == 403


def test_admin_cannot_deactivate_self_or_the_last_admin(client: TestClient) -> None:
    result = _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    assert client.post(f"/local-accounts/{result['account_id']}/deactivate").status_code == 409
    listed = client.get("/local-accounts").json()
    assert [a["login_id"] for a in listed] == [ADMIN["login_id"]]
    assert listed[0]["memberships"] == [
        {"scope_id": "hospital/pharmacy", "role": "ADMIN", "active": True}
    ]


def test_logout_is_persisted_for_local_sessions(
    client: TestClient, sqlite_session_factory: Any
) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    token = client.cookies.get("pharmshift_token")
    assert client.post("/auth/logout").status_code == 204
    from shift_scheduler.db.planning_models import RevokedSession

    with sqlite_session_factory() as session:
        assert session.scalar(select(RevokedSession))
    client.cookies.set("pharmshift_token", token)
    assert client.get("/auth/me").status_code == 401


# --- fail-closed desktop configuration -------------------------------------------


@pytest.fixture
def desktop_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> dict[str, str]:
    storage = tmp_path / "storage"
    storage.mkdir(mode=0o700)
    env = {
        "PHARMSHIFT_ENV": "desktop",
        "SHIFT_SCHEDULER_DATA_BACKEND": "db",
        "AUTH_MODE": "local",
        "DATABASE_URL": "postgresql+psycopg://app:pw@127.0.0.1:18516/pharmshift",
        "AUTH_JWT_SECRET": "k" * 48,
        "AUTH_COOKIE_SECURE": "1",
        "AUTH_COOKIE_SAMESITE": "strict",
        "FRONTEND_BASE_URL": "https://127.0.0.1:18513",
        "API_CORS_ALLOW_ORIGINS": "https://127.0.0.1:18513",
        "PHARMSHIFT_BIND_HOST": "127.0.0.1",
        "PHARMSHIFT_CONTROL_URL": "https://127.0.0.1:18515",
        "PHARMSHIFT_INSTALL_ID": "install-0123456789abcdef",
        "PHARMSHIFT_MANAGED_STORAGE": str(storage),
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("SHIFT_SCHEDULER_DB_URL", raising=False)
    monkeypatch.setattr("shift_scheduler.control.client.configured_client", lambda: None)
    auth_settings.get_auth_mode.cache_clear()
    auth_settings.get_session_settings.cache_clear()
    yield env
    auth_settings.get_auth_mode.cache_clear()
    auth_settings.get_session_settings.cache_clear()


def test_valid_desktop_configuration_passes(desktop_env: dict[str, str]) -> None:
    from shift_scheduler.config.desktop import check_desktop

    check_desktop()


@pytest.mark.parametrize(
    "key,value",
    [
        ("AUTH_MODE", "mock"),
        ("SHIFT_SCHEDULER_DATA_BACKEND", "yaml"),
        ("DATABASE_URL", "sqlite:///x.db"),
        ("DATABASE_URL", "postgresql+psycopg://app:pw@10.0.0.5:5432/pharmshift"),
        ("AUTH_JWT_SECRET", "too-short"),
        ("AUTH_COOKIE_SECURE", "0"),
        ("AUTH_COOKIE_SAMESITE", "lax"),
        ("FRONTEND_BASE_URL", "http://127.0.0.1:18513"),
        ("API_CORS_ALLOW_ORIGINS", "https://127.0.0.1:18513,https://evil.example"),
        ("PHARMSHIFT_BIND_HOST", "0.0.0.0"),
        ("PHARMSHIFT_CONTROL_URL", "http://127.0.0.1:18515"),
        ("PHARMSHIFT_INSTALL_ID", "short"),
    ],
)
def test_each_unsafe_desktop_setting_stops_start_up(
    desktop_env: dict[str, str], monkeypatch: pytest.MonkeyPatch, key: str, value: str
) -> None:
    from shift_scheduler.config.desktop import check_desktop

    monkeypatch.setenv(key, value)
    auth_settings.get_auth_mode.cache_clear()
    auth_settings.get_session_settings.cache_clear()
    with pytest.raises(RuntimeError):
        check_desktop()


def test_shared_storage_permissions_stop_start_up(
    desktop_env: dict[str, str], tmp_path: Any
) -> None:
    import os

    from shift_scheduler.config.desktop import check_desktop

    if os.name != "posix":
        pytest.skip("POSIX permission bits")
    os.chmod(desktop_env["PHARMSHIFT_MANAGED_STORAGE"], 0o770)
    with pytest.raises(RuntimeError):
        check_desktop()


def test_desktop_profile_is_hardened_like_production(desktop_env: dict[str, str]) -> None:
    from shift_scheduler.config.profile import is_hardened
    from shift_scheduler.ops.legacy_storage import require_development_storage

    assert is_hardened()
    with pytest.raises(RuntimeError):
        require_development_storage()
