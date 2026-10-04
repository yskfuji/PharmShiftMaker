"""FastAPI を用いたスケジュール生成 API の結合テスト."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from shift_scheduler.data import LoadedConfig
from shift_scheduler.data.schedule_store import ScheduleStore
from shift_scheduler.domain import (
    Assignment,
    DayInfo,
    DayType,
    EmploymentType,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)
from shift_scheduler.optimizer.solver import SolverError

client = TestClient(app)


# pyright: ignore[reportUnusedFunction]
@pytest.fixture(autouse=True)
def reset_schedule_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> ScheduleStore:
    store = ScheduleStore(storage_dir=tmp_path)
    monkeypatch.setattr("shift_scheduler.api.routers.schedules.SCHEDULE_STORE", store)
    return store


def _auth_headers(
    username: str = "admin", password: str = "pass-admin"
) -> dict[str, str]:
    response = client.post(
        "/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _build_day_infos() -> list[DayInfo]:
    start = date(2025, 2, 3)
    day_types = [
        DayType.WEEKDAY,
        DayType.HOLIDAY,
        DayType.WEEKDAY,
        DayType.HOLIDAY,
        DayType.WEEKDAY,
        DayType.SATURDAY,
        DayType.SUNDAY,
    ]
    return [
        DayInfo(
            day_date=start + timedelta(days=offset),
            day_type=day_types[offset],
            is_business_day=True,
        )
        for offset in range(len(day_types))
    ]


@pytest.mark.parametrize("path", ["/schedules/10000/1", "/schedules/2025/13"])
def test_confirmed_schedule_period_path_is_bounded(path: str) -> None:
    response = client.get(path, headers=_auth_headers())
    assert response.status_code == 422


def _build_shift_types() -> list[ShiftType]:
    return [
        ShiftType(
            shift_id="DAY",
            name="日勤",
            category=ShiftCategory.DAY_SHIFT,
            required_count=1,
            applicable_day_types=[
                DayType.WEEKDAY,
                DayType.HOLIDAY,
                DayType.SATURDAY,
                DayType.SUNDAY,
            ],
        ),
        ShiftType(
            shift_id="NIGHT",
            name="夜勤",
            category=ShiftCategory.NIGHT_DUTY,
            required_count=1,
            applicable_day_types=[DayType.WEEKDAY],
        ),
    ]


def _build_people_profiles() -> tuple[list[Person], list[Profile]]:
    people = [
        Person(person_id="alice", name="アリス", role=Role.PHARMACIST),
        Person(person_id="bob", name="ボブ", role=Role.PHARMACIST),
        Person(person_id="dave", name="デイブ", role=Role.PHARMACIST),
        Person(person_id="emma", name="エマ", role=Role.PHARMACIST),
    ]
    profiles = [
        Profile(
            profile_id="night_full",
            name="夜勤可能正社員",
            employment_type=EmploymentType.PART_TIME,
            can_night_duty=True,
            can_evening=True,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            max_consecutive_working_days=6,
            night_duty_min=1,
            night_duty_max=3,
            on_call_min=0,
            on_call_max=0,
            evening_min=0,
            evening_max=4,
        ),
        Profile(
            profile_id="day_full",
            name="日勤のみ正社員",
            employment_type=EmploymentType.FULL_TIME,
            can_night_duty=False,
            can_evening=True,
            can_ward_alone=True,
            weekend_allowed=True,
            holiday_allowed=True,
            max_consecutive_working_days=6,
        ),
    ]
    return people, profiles


def _build_timelines() -> list[TimelineEntry]:
    start = date(2025, 1, 1)
    return [
        TimelineEntry(
            person_id="alice",
            from_date=start,
            to_date=None,
            profile_id="night_full",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="dave",
            from_date=start,
            to_date=None,
            profile_id="night_full",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="emma",
            from_date=start,
            to_date=None,
            profile_id="night_full",
            status=TimelineStatus.ACTIVE,
        ),
        TimelineEntry(
            person_id="bob",
            from_date=start,
            to_date=None,
            profile_id="day_full",
            status=TimelineStatus.ACTIVE,
        ),
    ]


def _build_loaded_config() -> LoadedConfig:
    people, profiles = _build_people_profiles()
    return LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=_build_timelines(),
        day_infos=_build_day_infos(),
        shift_types=_build_shift_types(),
        holiday_requests=[],
        leave_quotas=[],
    )


def _patch_load_all(monkeypatch: pytest.MonkeyPatch, config: LoadedConfig) -> None:
    def _load_all(
        year: int, month: int
    ) -> LoadedConfig:  # pragma: no cover - simple stub
        return config

    monkeypatch.setattr("shift_scheduler.api.routers.schedules.load_all", _load_all)


def _persist_schedule(monkeypatch: pytest.MonkeyPatch) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)
    from shift_scheduler.api.routers.schedules import SCHEDULE_STORE

    SCHEDULE_STORE.save(
        2025,
        2,
        [
            Assignment(
                person_id="alice", assignment_date=date(2025, 2, 3), shift_id="DAY"
            )
        ],
        1,
        "legacy-fixture",
    )
    client.cookies.clear()


def test_generate_schedule_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)

    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2},
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["year"] == 2025
    assert payload["month"] == 2
    assert payload["lock_version"] == 0


def test_legacy_generate_cannot_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2, "trial_mode": False, "expected_version": 0},
        headers=_auth_headers(),
    )
    assert response.status_code == 410
    assert "/planning" in response.json()["detail"]


def test_generate_schedule_returns_422_when_solver_infeasible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)

    def _fail(_: LoadedConfig) -> list[Assignment]:  # pragma: no cover - simple stub
        raise SolverError("No feasible schedule found (status=INFEASIBLE)")

    monkeypatch.setattr("shift_scheduler.api.routers.schedules.solve_schedule", _fail)

    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2},
        headers=_auth_headers(),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error_code"] == "schedule.infeasible"
    assert "solver_message" in detail


def test_legacy_manual_cannot_bypass_review(
    reset_schedule_store: ScheduleStore,
) -> None:
    response = client.post(
        "/schedules/generate",
        json={
            "year": 2025,
            "month": 2,
            "trial_mode": False,
            "expected_version": 0,
            "manual_assignments": [
                {
                    "person_id": "unknown",
                    "assignment_date": "2025-02-03",
                    "shift_id": "CUSTOM",
                }
            ],
        },
        headers=_auth_headers(),
    )
    assert response.status_code == 410
    assert reset_schedule_store.load(2025, 2) is None


def test_manual_assignments_emit_validation_warnings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)

    manual_assignments = [
        {"person_id": "alice", "assignment_date": "2025-02-03", "shift_id": "DAY"}
    ]

    response = client.post(
        "/schedules/generate",
        json={
            "year": 2025,
            "month": 2,
            "trial_mode": True,
            "manual_assignments": manual_assignments,
        },
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.json()
    warning_codes = {warning["code"] for warning in payload["warnings"]}
    assert "MANUAL_COVERAGE_MISMATCH" in warning_codes
    coverage_warning = next(
        w for w in payload["warnings"] if w["code"] == "MANUAL_COVERAGE_MISMATCH"
    )
    assert coverage_warning["context"]["date"] == "2025-02-03"


def test_get_confirmed_schedule_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    _persist_schedule(monkeypatch)
    response = client.get("/schedules/2025/2")
    assert response.status_code == 401


def test_get_confirmed_schedule_returns_persisted(
    monkeypatch: pytest.MonkeyPatch,
    reset_schedule_store: ScheduleStore,
) -> None:
    _persist_schedule(monkeypatch)
    response = client.get("/schedules/2025/2", headers=_auth_headers())
    assert response.status_code == 200
    payload = response.json()
    assert payload["trial_mode"] is False
    assert payload["lock_version"] == 1
    assert payload["total_assignments"] == len(payload["assignments"])


def test_pharmacist_can_read_confirmed_schedule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_schedule(monkeypatch)
    response = client.get(
        "/schedules/2025/2",
        headers=_auth_headers("pharmacist", "pass-ph"),
    )
    assert response.status_code == 200


def test_pharmacist_only_sees_own_assignments(
    reset_schedule_store: ScheduleStore,
) -> None:
    assignments = [
        Assignment(
            person_id="pharmacist", assignment_date=date(2025, 2, 3), shift_id="DAY"
        ),
        Assignment(
            person_id="alice", assignment_date=date(2025, 2, 3), shift_id="NIGHT"
        ),
    ]
    reset_schedule_store.save(2025, 2, assignments, version=1, updated_by="admin")

    response = client.get(
        "/schedules/2025/2",
        headers=_auth_headers("pharmacist", "pass-ph"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_assignments"] == 1
    assert len(payload["assignments"]) == 1
    assert payload["assignments"][0]["person_id"] == "pharmacist"


def test_generate_schedule_returns_404_when_config_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing_config(_: int, __: int) -> LoadedConfig:  # pragma: no cover - stub
        raise FileNotFoundError("calendar not found")

    monkeypatch.setattr(
        "shift_scheduler.api.routers.schedules.load_all", _missing_config
    )

    response = client.post(
        "/schedules/generate",
        json={"year": 2099, "month": 1},
        headers=_auth_headers(),
    )

    assert response.status_code == 404
    assert "calendar" in response.json()["detail"]


def test_generate_schedule_requires_expected_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)

    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2, "trial_mode": False},
        headers=_auth_headers(),
    )

    assert response.status_code == 410
    assert "/planning" in response.json()["detail"]


def test_generate_schedule_detects_version_conflict(
    monkeypatch: pytest.MonkeyPatch,
    reset_schedule_store: ScheduleStore,
) -> None:
    config = _build_loaded_config()
    _patch_load_all(monkeypatch, config)

    # 既存シフトを version=1 で保存し、expected_version=0 で競合を起こす
    reset_schedule_store.save(
        2025,
        2,
        [
            Assignment(
                person_id="alice", assignment_date=date(2025, 2, 3), shift_id="DAY"
            )
        ],
        version=1,
        updated_by="admin",
    )

    response = client.post(
        "/schedules/generate",
        json={"year": 2025, "month": 2, "trial_mode": False, "expected_version": 0},
        headers=_auth_headers(),
    )

    assert response.status_code == 410


def test_get_confirmed_schedule_returns_404_when_missing(
    reset_schedule_store: ScheduleStore,
) -> None:
    # 強制的に空のストアを使うだけで十分
    response = client.get(
        "/schedules/2025/2",
        headers=_auth_headers(),
    )

    assert response.status_code == 404
