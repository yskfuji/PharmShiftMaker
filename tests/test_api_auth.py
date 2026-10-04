"""認証・認可 API の動作テスト."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.auth.settings import AuthMode
from shift_scheduler.api.main import app
from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import Assignment

client = TestClient(app)


def _install_schedule_stubs(monkeypatch: pytest.MonkeyPatch) -> None:
    config = LoadedConfig(
        people=[],
        profiles=[],
        timeline_entries=[],
        day_infos=[],
        shift_types=[],
        holiday_requests=[],
        leave_quotas=[],
    )

    def _load_all(
        year: int, month: int
    ) -> LoadedConfig:  # pragma: no cover - simple stub
        return config

    def _solve_schedule(
        _: LoadedConfig,
    ) -> list[Assignment]:  # pragma: no cover - simple stub
        return [
            Assignment(
                person_id="alice", assignment_date=date(2025, 2, 3), shift_id="DAY"
            )
        ]

    monkeypatch.setattr("shift_scheduler.api.routers.schedules.load_all", _load_all)
    monkeypatch.setattr(
        "shift_scheduler.api.routers.schedules.solve_schedule", _solve_schedule
    )


def _login(username: str, password: str) -> str:
    response = client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.mark.parametrize(
    "username,password,expected_role",
    [
        ("pharmacist", "pass-ph", "PHARMACIST"),
        ("leader", "pass-lead", "LEADER"),
        ("admin", "pass-admin", "ADMIN"),
        ("developer", "pass-dev", "DEVELOPER"),
    ],
)
def test_login_returns_token(username: str, password: str, expected_role: str) -> None:
    response = client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["role"] == expected_role


def test_generate_schedule_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_schedule_stubs(monkeypatch)
    response = client.post("/schedules/generate", json={"year": 2025, "month": 2})
    assert response.status_code == 401


def test_pharmacist_cannot_generate_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_schedule_stubs(monkeypatch)
    token = _login("pharmacist", "pass-ph")
    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403


def test_admin_can_generate_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_schedule_stubs(monkeypatch)
    token = _login("admin", "pass-admin")
    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_assignments"] == len(body["assignments"])


def test_developer_can_generate_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_schedule_stubs(monkeypatch)
    token = _login("developer", "pass-dev")
    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_assignments"] == len(body["assignments"])


def test_login_rejects_invalid_password() -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "totally-wrong"},
    )
    assert response.status_code == 401
    assert "invalid" in response.json()["detail"]


def test_login_returns_404_when_mock_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shift_scheduler.api.routers.auth.AUTH_MODE", AuthMode.OIDC)
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "pass-admin"},
    )
    assert response.status_code == 404
    assert "disabled" in response.json()["detail"]
