"""Database persistence tests for PharmShift."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.orm import sessionmaker

from shift_scheduler.data import holiday_request_store as holiday_store_module
from shift_scheduler.data import schedule_store as schedule_store_module
from shift_scheduler.data.holiday_request_store import HolidayRequestStore
from shift_scheduler.data.schedule_store import PersistedSchedule, ScheduleStore
from shift_scheduler.db.models import PersonModel
from shift_scheduler.db.repositories import ScheduleRepository
from shift_scheduler.domain import Assignment, HolidayRequest, HolidayRequestKind


def _make_assignments() -> list[Assignment]:
    return [
        Assignment(person_id="alice", assignment_date=date(2025, 2, 1), shift_id="DAY"),
        Assignment(person_id="bob", assignment_date=date(2025, 2, 1), shift_id="NIGHT"),
    ]


def test_schedule_repository_roundtrip(sqlite_session_factory: sessionmaker) -> None:
    assignments = _make_assignments()

    with sqlite_session_factory() as session:
        repo = ScheduleRepository(session)
        snapshot = repo.replace_assignments(
            2025, 2, assignments, version=1, updated_by="leader"
        )
        assert snapshot.version == 1
        assert len(snapshot.assignments) == 2
        session.commit()

    with sqlite_session_factory() as session:
        repo = ScheduleRepository(session)
        loaded = repo.load_month(2025, 2)
        assert loaded is not None
        assert loaded.version == 1
        assert repo.current_version(2025, 2) == 1
        assert {(a.person_id, a.shift_id) for a in loaded.assignments} == {
            ("alice", "DAY"),
            ("bob", "NIGHT"),
        }


def test_schedule_store_uses_database(
    sqlite_session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(schedule_store_module, "USE_DB_BACKEND", True)
    store = ScheduleStore()

    saved: PersistedSchedule = store.save(
        2025, 2, _make_assignments(), version=1, updated_by="leader"
    )
    assert saved.version == 1

    loaded = store.load(2025, 2)
    assert loaded is not None
    assert loaded.updated_by == "leader"
    assert store.current_version(2025, 2) == 1


def test_holiday_request_store_crud(
    sqlite_session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    with sqlite_session_factory() as session:
        session.add(PersonModel(person_id="ph", name="Pharmacist", role="pharmacist"))
        session.commit()

    monkeypatch.setattr(holiday_store_module, "USE_DB_BACKEND", True)
    store = HolidayRequestStore()
    request = HolidayRequest(
        person_id="ph",
        request_date=date(2025, 2, 3),
        kind=HolidayRequestKind.PUBLIC_HOLIDAY_REQUEST,
        order=1,
        is_approved=False,
    )
    stored = store.upsert_request(2025, 2, request)
    assert stored.order == 1

    listed = store.list_requests(2025, 2)
    assert len(listed) == 1

    deleted = store.delete_request(2025, 2, "ph", date(2025, 2, 3))
    assert deleted.person_id == "ph"

    assert store.list_requests(2025, 2) == []
