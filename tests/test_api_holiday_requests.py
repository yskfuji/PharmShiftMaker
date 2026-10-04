"""希望休 API の結合テスト."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.api.routers import holiday_requests as holiday_router
from shift_scheduler.data.holiday_request_store import HolidayRequestStore

client = TestClient(app)


def _auth_headers(username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# pyright: ignore[reportUnusedFunction]
@pytest.fixture(autouse=True)
def _temporary_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:  # pyright: ignore[reportUnusedFunction]
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    calendar_path = config_dir / "calendar_2025_02.yaml"
    calendar_path.write_text(
        """days:
  - date: 2025-02-01
    day_type: WEEKDAY
  - date: 2025-02-02
    day_type: WEEKDAY
  - date: 2025-02-03
    day_type: WEEKDAY
  - date: 2025-02-04
    day_type: WEEKDAY
  - date: 2025-02-05
    day_type: WEEKDAY
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(holiday_router, "_STORE", HolidayRequestStore(config_dir))


def test_pharmacist_can_create_and_delete_own_request() -> None:
    headers = _auth_headers("pharmacist", "pass-ph")
    payload = {"date": "2025-02-03", "kind": "PUBLIC_HOLIDAY_REQUEST"}
    response = client.post("/holiday-requests/2025/2", json=payload, headers=headers)
    assert response.status_code == 201
    created = response.json()
    assert created["person_id"] == "pharmacist"

    list_response = client.get("/holiday-requests/2025/2", headers=headers)
    assert list_response.status_code == 200
    items = list_response.json()["requests"]
    assert len(items) == 1

    delete_response = client.request(
        "DELETE",
        "/holiday-requests/2025/2",
        json={"date": "2025-02-03"},
        headers=headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["person_id"] == "pharmacist"


def test_personal_limit_is_enforced() -> None:
    headers = _auth_headers("pharmacist", "pass-ph")
    dates = ["2025-02-01", "2025-02-02", "2025-02-03", "2025-02-04"]
    for date in dates:
        response = client.post(
            "/holiday-requests/2025/2",
            json={"date": date, "kind": "PUBLIC_HOLIDAY_REQUEST"},
            headers=headers,
        )
        assert response.status_code == 201

    fifth = client.post(
        "/holiday-requests/2025/2",
        json={"date": "2025-02-05", "kind": "PUBLIC_HOLIDAY_REQUEST"},
        headers=headers,
    )
    assert fifth.status_code == 400


def test_day_limit_rejects_fourth_request_on_weekday() -> None:
    headers = _auth_headers("leader", "pass-lead")
    persons = ["alice", "bob", "carol"]
    for person in persons:
        response = client.post(
            "/holiday-requests/2025/2",
            json={
                "date": "2025-02-03",
                "kind": "PUBLIC_HOLIDAY_REQUEST",
                "person_id": person,
            },
            headers=headers,
        )
        assert response.status_code == 201

    fourth = client.post(
        "/holiday-requests/2025/2",
        json={
            "date": "2025-02-03",
            "kind": "PUBLIC_HOLIDAY_REQUEST",
            "person_id": "dave",
        },
        headers=headers,
    )
    assert fourth.status_code == 400


def test_pharmacist_cannot_modify_other_person_request() -> None:
    leader_headers = _auth_headers("leader", "pass-lead")
    client.post(
        "/holiday-requests/2025/2",
        json={
            "date": "2025-02-02",
            "kind": "PUBLIC_HOLIDAY_REQUEST",
            "person_id": "other",
        },
        headers=leader_headers,
    )

    pharmacist_headers = _auth_headers("pharmacist", "pass-ph")
    delete_response = client.request(
        "DELETE",
        "/holiday-requests/2025/2",
        json={"date": "2025-02-02", "person_id": "other"},
        headers=pharmacist_headers,
    )
    assert delete_response.status_code == 403

    update_response = client.post(
        "/holiday-requests/2025/2",
        json={"date": "2025-02-02", "kind": "PAID_LEAVE_REQUEST", "person_id": "other"},
        headers=pharmacist_headers,
    )
    assert update_response.status_code == 403
