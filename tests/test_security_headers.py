"""S03: security headers, CORS and cookie-write origin checks (SQLite, no Docker)."""

from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare

REQUIRED = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}


def assert_protected(response):
    for name, value in REQUIRED.items():
        assert response.headers.get(name) == value, (name, response.status_code)


def test_public_authenticated_and_error_responses_carry_security_headers(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        assert_protected(client.get("/healthz"))
        admin = token(client)
        ok = client.get(BASE + "/grant-assessments/context" + QUERY, headers=admin)
        assert ok.status_code == 200
        assert_protected(ok)
        missing = client.get(BASE + "/does-not-exist" + QUERY, headers=admin)
        assert missing.status_code == 404
        assert_protected(missing)
        client.cookies.clear()  # the login above left a session cookie
        unauthenticated = client.get(BASE + "/grant-assessments/context" + QUERY)
        assert unauthenticated.status_code in (401, 403)
        assert_protected(unauthenticated)


def test_cors_reflects_only_configured_origins(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:

        def preflight(origin):
            return client.options(
                BASE + "/grant-assessments" + QUERY,
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )

        allowed = preflight("https://localhost:3000")
        assert (
            allowed.headers.get("access-control-allow-origin")
            == "https://localhost:3000"
        )
        assert allowed.headers.get("access-control-allow-credentials") == "true"
        foreign = preflight("https://evil.example")
        assert foreign.headers.get("access-control-allow-origin") is None
        simple = client.get("/healthz", headers={"Origin": "https://evil.example"})
        assert simple.headers.get("access-control-allow-origin") is None


def test_cookie_authenticated_write_from_untrusted_origin_is_refused(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        token(client)  # leaves the session cookie in the client
        assert client.cookies, "login must set a session cookie for this check"
        refused = client.post(
            BASE + "/grant-assessments" + QUERY,
            json={},
            headers={"Origin": "https://evil.example"},
        )
        assert refused.status_code == 403
        assert "trusted Origin" in refused.json()["detail"]
        assert_protected(refused)  # early refusals carry the headers too
        empty_origin = client.post(
            BASE + "/grant-assessments" + QUERY, json={}, headers={"Origin": ""}
        )
        assert empty_origin.status_code == 403
        client.headers.pop("Origin", None)  # the shared client default sets one
        absent = client.post(BASE + "/grant-assessments" + QUERY, json={})
        assert absent.status_code == 403
