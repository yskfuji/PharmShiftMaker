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
    response = client.post(
        "/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": TOKEN}
    )
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
        client.post(
            "/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": "w" * 40}
        ).status_code
        == 403
    )
    result = _bootstrap(client)
    assert result["scope_id"] == "hospital/pharmacy"
    again = client.post(
        "/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": TOKEN}
    )
    assert again.status_code == 409
    assert client.get("/setup/status").json() == {"initialized": True}


def test_bootstrap_without_configured_token_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PHARMSHIFT_SETUP_TOKEN", "short")
    response = client.post(
        "/setup/bootstrap", json=ADMIN, headers={"X-Setup-Token": "short"}
    )
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


def test_new_account_must_change_password_before_using_the_api(
    client: TestClient,
) -> None:
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
        json={
            "current_password": temporary,
            "new_password": "a much better passphrase",
        },
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
    assert (
        client.post(f"/local-accounts/{result['account_id']}/deactivate").status_code
        == 409
    )
    listed = client.get("/local-accounts").json()
    assert [(a["login_id"], a["scope_id"]) for a in listed] == [
        (ADMIN["login_id"], "hospital/pharmacy")
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


def _new_user(
    admin: TestClient, login_id: str, role: str = "PHARMACIST"
) -> dict[str, Any]:
    created = admin.post(
        "/local-accounts",
        json={
            "login_id": login_id,
            "display_name": login_id,
            "role": role,
            "scope_id": "hospital/pharmacy",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()


def _second_client() -> TestClient:
    from shift_scheduler.api.main import app

    other = TestClient(app)
    other.headers["Origin"] = "https://localhost:3000"
    return other


def test_reset_and_deactivation_end_every_existing_session(client: TestClient) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    user = _new_user(client, "pharmacist.c")
    member = _second_client()
    member.post(
        "/auth/login",
        json={"username": "pharmacist.c", "password": user["temporary_password"]},
    )
    member.post(
        "/auth/password",
        json={
            "current_password": user["temporary_password"],
            "new_password": "member passphrase 2026",
        },
    )
    assert member.get("/planning/scopes").status_code == 200
    reset = client.post(f"/local-accounts/{user['account_id']}/reset-password")
    assert reset.status_code == 200
    # The session signed before the reset no longer works anywhere.
    assert member.get("/planning/scopes").status_code == 401
    assert member.get("/auth/me").status_code == 401
    member.cookies.clear()
    member.post(
        "/auth/login",
        json={
            "username": "pharmacist.c",
            "password": reset.json()["temporary_password"],
        },
    )
    assert member.get("/auth/me").status_code == 200
    assert (
        client.post(f"/local-accounts/{user['account_id']}/deactivate").status_code
        == 204
    )
    assert member.get("/auth/me").status_code == 401


def test_pending_change_allows_only_the_change_endpoints(client: TestClient) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    user = _new_user(client, "pharmacist.d")
    _login(client, "pharmacist.d", user["temporary_password"])
    assert client.get("/auth/me").status_code == 200
    assert client.get("/auth/legacy-context").status_code == 403
    assert client.get("/planning/scopes").status_code == 403


def test_local_login_returns_no_token_and_ignores_id_case(client: TestClient) -> None:
    _bootstrap(client)
    response = _login(client, "HEAD.Pharmacist", ADMIN["password"])
    assert response.status_code == 200
    assert response.json()["access_token"] is None
    assert client.cookies.get("pharmshift_token")


def test_wrong_current_password_on_change_counts_towards_the_lock(
    client: TestClient,
) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    for _ in range(5):
        wrong = client.post(
            "/auth/password",
            json={"current_password": "not the password", "new_password": "x" * 20},
        )
        assert wrong.status_code == 401
    assert _login(client, ADMIN["login_id"], ADMIN["password"]).status_code == 401


def test_desktop_requires_the_app_origin_for_every_write(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _bootstrap(client)
    monkeypatch.setenv("PHARMSHIFT_ENV", "desktop")
    monkeypatch.setattr("shift_scheduler.control.client.require_access", lambda: None)
    del client.headers["Origin"]
    no_origin = client.post(
        "/auth/login",
        json={"username": ADMIN["login_id"], "password": ADMIN["password"]},
    )
    assert no_origin.status_code == 403
    foreign = client.post(
        "/auth/login",
        json={"username": ADMIN["login_id"], "password": ADMIN["password"]},
        headers={"Origin": "https://evil.example"},
    )
    assert foreign.status_code == 403
    own = client.post(
        "/auth/login",
        json={"username": ADMIN["login_id"], "password": ADMIN["password"]},
        headers={"Origin": "https://localhost:3000"},
    )
    assert own.status_code == 200


def test_unknown_profile_name_stops_start_up(monkeypatch: pytest.MonkeyPatch) -> None:
    from shift_scheduler.config.profile import validate_environment

    monkeypatch.setenv("PHARMSHIFT_ENV", "prodution")
    with pytest.raises(RuntimeError):
        validate_environment()
    monkeypatch.setenv("PHARMSHIFT_ENV", "desktop")
    validate_environment()


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
    monkeypatch.setattr(
        "shift_scheduler.control.client.configured_client", lambda: None
    )
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


def test_network_share_storage_stops_start_up(
    desktop_env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from shift_scheduler.config.desktop import check_desktop

    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", "\\\\server\\share\\pharmshift")
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


def test_desktop_profile_is_hardened_like_production(
    desktop_env: dict[str, str],
) -> None:
    from shift_scheduler.config.profile import is_hardened
    from shift_scheduler.ops.legacy_storage import require_development_storage

    assert is_hardened()
    with pytest.raises(RuntimeError):
        require_development_storage()


# --- second review: audit store, staff link, refresh, load and storage ------------


def test_account_events_stay_out_of_the_notification_outbox(
    client: TestClient, sqlite_session_factory: Any
) -> None:
    from shift_scheduler.db.planning_models import LocalAccountEvent, PlanningOutbox

    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    _login(client, ADMIN["login_id"], "wrong passphrase 0000")
    _login(client, ADMIN["login_id"], ADMIN["password"])
    _new_user(client, "pharmacist.e")
    with sqlite_session_factory() as session:
        kinds = sorted(session.scalars(select(LocalAccountEvent.kind)))
        assert session.scalars(select(PlanningOutbox)).all() == []
    assert kinds == sorted(
        [
            "local_account.bootstrap",
            "local_account.signed_in",
            "local_account.signed_in",
            "local_account.created",
        ]
    )


def _register_person(factory: Any, person_id: str) -> None:
    from uuid import uuid4

    from shift_scheduler.db.compliance_models import ComplianceEntity

    with factory.begin() as session:
        session.add(
            ComplianceEntity(
                key=uuid4().hex,
                scope_id="hospital/pharmacy",
                kind="person",
                entity_id=person_id,
                payload={},
            )
        )


def test_admin_links_an_account_to_a_staff_member_once(
    client: TestClient, sqlite_session_factory: Any
) -> None:
    from shift_scheduler.db.planning_models import AccountMembership

    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    user = _new_user(client, "pharmacist.f")
    other = _new_user(client, "pharmacist.g")
    _register_person(sqlite_session_factory, "P-001")
    path = f"/local-accounts/{user['account_id']}/person"
    # Only a staff member of the account's own department can be linked.
    assert client.post(path, json={"person_id": "P-999"}).status_code == 422
    assert client.post(path, json={"person_id": "P-001"}).status_code == 204
    # The link is never moved, and one person has one account.
    assert client.post(path, json={"person_id": "P-001"}).status_code == 409
    taken = client.post(
        f"/local-accounts/{other['account_id']}/person", json={"person_id": "P-001"}
    )
    assert taken.status_code == 409
    with sqlite_session_factory() as session:
        membership = session.scalar(
            select(AccountMembership).where(
                AccountMembership.subject == user["account_id"]
            )
        )
        assert membership is not None and membership.person_id == "P-001"
    listed = {a["login_id"]: a for a in client.get("/local-accounts").json()}
    assert listed["pharmacist.f"]["person_id"] == "P-001"
    assert listed["pharmacist.g"]["person_id"] is None


def test_refresh_does_not_renew_an_ended_session(client: TestClient) -> None:
    _bootstrap(client)
    _login(client, ADMIN["login_id"], ADMIN["password"])
    user = _new_user(client, "pharmacist.h")
    member = _second_client()
    member.post(
        "/auth/login",
        json={"username": "pharmacist.h", "password": user["temporary_password"]},
    )
    assert member.post("/auth/refresh").status_code == 200
    assert (
        client.post(f"/local-accounts/{user['account_id']}/deactivate").status_code
        == 204
    )
    assert member.post("/auth/refresh").status_code == 401


def test_busy_password_hashing_answers_429(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading

    _bootstrap(client)
    monkeypatch.setattr(local, "_HASH_SLOTS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(local, "_HASH_WAIT_SECONDS", 0.01)
    local._HASH_SLOTS.acquire()
    try:
        response = _login(client, ADMIN["login_id"], ADMIN["password"])
    finally:
        local._HASH_SLOTS.release()
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "2"
    assert _login(client, ADMIN["login_id"], ADMIN["password"]).status_code == 200


def test_foreign_origin_is_refused_before_the_control_lookup(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []
    monkeypatch.setenv("PHARMSHIFT_ENV", "desktop")
    monkeypatch.setattr(
        "shift_scheduler.control.client.require_access", lambda: calls.append(1)
    )
    response = client.post(
        "/auth/login",
        json={"username": "x", "password": "y"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert calls == []


def test_storage_behind_a_link_stops_start_up(
    desktop_env: dict[str, str], monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    import os

    from shift_scheduler.config.desktop import check_desktop

    if os.name != "posix":
        pytest.skip("POSIX links")
    real = tmp_path / "real"
    (real / "storage").mkdir(parents=True, mode=0o700)
    os.chmod(real, 0o700)
    (tmp_path / "alias").symlink_to(real)
    monkeypatch.setenv(
        "PHARMSHIFT_MANAGED_STORAGE", str(tmp_path / "alias" / "storage")
    )
    with pytest.raises(RuntimeError, match="link"):
        check_desktop()


def test_storage_on_a_network_file_system_stops_start_up(
    desktop_env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    from shift_scheduler.config import desktop

    if os.name != "posix":
        pytest.skip("POSIX file systems")
    monkeypatch.setattr(desktop, "_local_filesystem", lambda _path: False)
    with pytest.raises(RuntimeError, match="share"):
        desktop.check_desktop()


def test_linux_mount_type_uses_the_innermost_mount() -> None:
    from shift_scheduler.config.desktop import mount_type

    mountinfo = "\n".join(
        [
            "22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw",
            "40 22 0:50 / /home/user/share rw shared:9 - cifs //nas/share rw",
            "41 22 0:51 / /home/user/share\\040b rw shared:9 - nfs4 nas:/b rw",
        ]
    )
    assert mount_type(mountinfo, "/home/user/data") == "ext4"
    assert mount_type(mountinfo, "/home/user/share/pharmshift") == "cifs"
    assert mount_type(mountinfo, "/home/user/share b/x") == "nfs4"
    assert mount_type(mountinfo, "/home/user/shareX") == "ext4"
    assert mount_type("", "/x") is None
