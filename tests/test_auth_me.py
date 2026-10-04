"""Verified display identity is not a display-cookie or session-renewal contract."""

from fastapi.testclient import TestClient

from shift_scheduler.api.auth.settings import AuthMode


def test_identity_uses_session_not_display_cookies_and_never_renews(
    sqlite_session_factory, clock
):
    from shift_scheduler.api.main import app
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(
        app,
        base_url="https://localhost:8000",
        headers={"Origin": "https://localhost:3000"},
    ) as client:
        assert client.get("/auth/me").status_code == 401
        assert (
            client.post(
                "/auth/login", json={"username": "admin", "password": "pass-admin"}
            ).status_code
            == 200
        )
        client.cookies.set("pharmshift_user", "%ZZ")
        client.cookies.set("pharmshift_role", "PHARMACIST")
        clock.offset = 899
        response = client.get("/auth/me")
        assert response.status_code == 200, response.text
        assert response.json() == {
            "user_id": "admin",
            "display_name": "admin",
            "global_role": "ADMIN",
            "identifier_kind": "login_id",
        }
        assert response.headers["cache-control"] == "no-store"
        assert "set-cookie" not in response.headers
        clock.offset = 901
        assert client.get("/auth/me").status_code == 401


def test_identity_oidc_label_revocation_and_control_gate(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api.main import app
    from shift_scheduler.api.routers import auth
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
        token = client.cookies.get("pharmshift_token")
        monkeypatch.setattr(auth, "AUTH_MODE", AuthMode.OIDC)
        assert client.get("/auth/me").json()["identifier_kind"] == "account_id"

        def blocked():
            raise RestoreUnavailable("unavailable")

        with monkeypatch.context() as m:
            m.setattr(control, "require_access", blocked)
            response = client.get("/auth/me")
            assert response.status_code == 503
            assert response.headers["cache-control"] == "no-store"
        client.post("/auth/logout")
        assert (
            client.get(
                "/auth/me", headers={"Authorization": "Bearer " + token}
            ).status_code
            == 401
        )


def test_oidc_account_identity_is_not_legacy_membership_projection(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api import dependencies
    from shift_scheduler.api.main import app
    from shift_scheduler.api.routers import auth
    from shift_scheduler.db.planning_models import AccountMembership
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(
        app,
        base_url="https://localhost:8000",
        headers={"Origin": "https://localhost:3000"},
    ) as client:
        client.post("/auth/login", json={"username": "admin", "password": "pass-admin"})
        # Exercise the actual dependency's OIDC branch, not just the response label.
        monkeypatch.setattr(dependencies, "get_auth_mode", lambda: AuthMode.OIDC)
        monkeypatch.setattr(auth, "AUTH_MODE", AuthMode.OIDC)
        with sqlite_session_factory.begin() as session:
            session.get(AccountMembership, "admin").role = "LEADER"
        me = client.get("/auth/me")
        assert me.json() == {
            "user_id": "admin",
            "display_name": "admin",
            "global_role": "ADMIN",
            "identifier_kind": "account_id",
        }
        assert client.get("/auth/legacy-context").json() == {
            "person_id": "p0",
            "effective_role": "LEADER",
        }
        with sqlite_session_factory.begin() as session:
            session.add(
                AccountMembership(
                    membership_id="second",
                    issuer="mock",
                    subject="admin",
                    person_id="p0",
                    scope_id="hospital/second",
                    role="PHARMACIST",
                    active=True,
                )
            )
        assert client.get("/auth/me").json() == me.json()
        assert client.get("/auth/legacy-context").status_code == 403
        assert client.get("/planning/scopes").status_code == 200
