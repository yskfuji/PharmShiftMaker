"""The OIDC sign-in returns only to the frontend's own origin (open-redirect guard)."""

from urllib.parse import urlsplit

import pytest

from shift_scheduler.api.routers import auth


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "dashboard",
        "//evil.example",
        "/\\evil.example",
        "/\t//evil.example",
        "/\n//evil.example",
        "/https://evil.example/x",
        "/http://evil.example",
    ],
)
def test_foreign_or_malformed_destinations_fall_back(value):
    assert auth._sanitize_redirect_path(value) == "/dashboard"


@pytest.mark.parametrize(
    "value",
    [
        "/dashboard",
        "/planning/workflows/leave?scope=hospital%2Fward",
        "/.//evil.example",
    ],
)
def test_the_target_stays_on_the_frontend(value):
    base = urlsplit(auth.SESSION_SETTINGS.frontend_base_url)
    target = urlsplit(
        auth._build_frontend_redirect(auth._sanitize_redirect_path(value))
    )
    assert (target.scheme, target.netloc) == (base.scheme, base.netloc)


def test_a_stored_foreign_destination_is_not_followed():
    base = urlsplit(auth.SESSION_SETTINGS.frontend_base_url)
    target = urlsplit(auth._build_frontend_redirect("/https://evil.example/x"))
    assert (target.scheme, target.netloc, target.path) == (
        base.scheme,
        base.netloc,
        "/dashboard",
    )
