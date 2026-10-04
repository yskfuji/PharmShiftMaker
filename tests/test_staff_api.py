"""Staff management API tests."""

from __future__ import annotations

import os
from datetime import date

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SHIFT_SCHEDULER_DATA_BACKEND", "db")

from shift_scheduler.api.main import app
from shift_scheduler.db import (
    Base,
    configure_session_factory,
    get_engine,
    session_scope,
)
from shift_scheduler.db.models import ProfileModel

client = TestClient(app)


@pytest.fixture(autouse=True)
def _configure_test_db(tmp_path):
    db_path = tmp_path / "staff_api.db"
    configure_session_factory(f"sqlite+pysqlite:///{db_path}", echo=False)
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def profile_factory():
    def _create(profile_id: str = "general", name: str = "General Pharmacist") -> str:
        with session_scope() as session:
            profile = ProfileModel(
                profile_id=profile_id,
                name=name,
                employment_type="FULL_TIME",
                can_night_duty=True,
                can_on_call=True,
                can_evening=True,
                can_ward_alone=True,
                weekend_allowed=True,
                holiday_allowed=True,
                allowed_weekdays=None,
                max_consecutive_working_days=6,
                night_duty_min=1,
                night_duty_max=4,
                on_call_min=0,
                on_call_max=4,
                evening_min=2,
                evening_max=4,
            )
            session.add(profile)
        return profile_id

    return _create


def _auth_headers(
    username: str = "admin", password: str = "pass-admin"
) -> dict[str, str]:
    response = client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_staff_with_timeline(profile_factory):
    profile_id = profile_factory()
    payload = {
        "person_id": "alice",
        "name": "Alice",
        "role": "PHARMACIST",
        "timeline": [
            {
                "profile_id": profile_id,
                "from_date": "2025-01-01",
                "status": "ACTIVE",
            }
        ],
    }
    response = client.post("/staff", json=payload, headers=_auth_headers())
    assert response.status_code == 201
    data = response.json()
    assert data["person_id"] == "alice"
    assert data["current_profile_id"] == profile_id
    assert data["current_status"] == "ACTIVE"
    assert len(data["timeline"]) == 1


def test_list_staff_respects_include_inactive(profile_factory):
    profile_id = profile_factory()
    headers = _auth_headers()
    client.post(
        "/staff",
        json={
            "person_id": "active",
            "name": "Active Pharmacist",
            "role": "PHARMACIST",
            "timeline": [
                {
                    "profile_id": profile_id,
                    "from_date": "2024-01-01",
                    "status": "ACTIVE",
                }
            ],
        },
        headers=headers,
    )
    client.post(
        "/staff",
        json={
            "person_id": "inactive",
            "name": "Inactive Pharmacist",
            "role": "PHARMACIST",
            "timeline": [
                {
                    "profile_id": profile_id,
                    "from_date": "2020-01-01",
                    "to_date": "2021-12-31",
                    "status": "INACTIVE",
                }
            ],
        },
        headers=headers,
    )

    response = client.get("/staff", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert {item["person_id"] for item in data["items"]} == {"active"}

    response = client.get("/staff?include_inactive=true", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert {item["person_id"] for item in data["items"]} == {"active", "inactive"}


def test_add_timeline_entry_requires_known_profile(profile_factory):
    profile_id = profile_factory()
    headers = _auth_headers()
    client.post(
        "/staff",
        json={
            "person_id": "bob",
            "name": "Bob",
            "role": "PHARMACIST",
            "timeline": [
                {
                    "profile_id": profile_id,
                    "from_date": "2024-04-01",
                    "status": "ACTIVE",
                }
            ],
        },
        headers=headers,
    )

    response = client.post(
        "/staff/bob/timeline",
        json={
            "profile_id": "unknown-profile",
            "from_date": date.today().isoformat(),
            "status": "ACTIVE",
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert "Unknown profile_id" in response.json()["detail"]
