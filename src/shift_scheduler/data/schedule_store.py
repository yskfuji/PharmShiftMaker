"""永続化済みシフト表をシンプルな JSON で管理するストア."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from shift_scheduler.data.loaders import DEFAULT_CONFIG_DIR, USE_DB_BACKEND
from shift_scheduler.db.repositories import ScheduleRepository
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain import Assignment


@dataclass(frozen=True, slots=True)
class PersistedSchedule:
    """確定済みシフト表 1 か月分を表すエンティティ."""

    year: int
    month: int
    version: int
    assignments: list[Assignment]
    updated_at: datetime
    updated_by: str


class ScheduleStore:
    """/config 配下にシフト確定結果を保存する軽量ストア."""

    def __init__(self, storage_dir: Path | None = None) -> None:
        self._session_factory: Callable[[], Session] | None = None
        if USE_DB_BACKEND:
            self._session_factory = get_session_factory()
            self._storage_dir = DEFAULT_CONFIG_DIR / "schedules"
        else:
            self._storage_dir = storage_dir or (DEFAULT_CONFIG_DIR / "schedules")

    def _file_path(self, year: int, month: int) -> Path:
        return self._storage_dir / f"schedule_{year:04d}_{month:02d}.json"

    def load(self, year: int, month: int) -> PersistedSchedule | None:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = ScheduleRepository(session)
                snapshot = repo.load_month(year, month)
                if snapshot is None:
                    return None
                return PersistedSchedule(
                    year=year,
                    month=month,
                    version=snapshot.version,
                    assignments=snapshot.assignments,
                    updated_at=snapshot.updated_at,
                    updated_by=snapshot.updated_by,
                )

        path = self._file_path(year, month)
        # `_file_path` appends only an integer-formatted basename to the
        # explicitly selected storage root.
        # codeql[py/path-injection]
        if not path.exists():
            return None
        # codeql[py/path-injection]
        with path.open("r", encoding="utf-8") as fp:
            payload: dict[str, Any] = json.load(fp)
        assignments = [
            Assignment.model_validate(item) for item in payload.get("assignments", [])
        ]
        updated_at = datetime.fromisoformat(payload["updated_at"])
        return PersistedSchedule(
            year=year,
            month=month,
            version=int(payload["version"]),
            assignments=assignments,
            updated_at=updated_at,
            updated_by=payload["updated_by"],
        )

    def save(
        self,
        year: int,
        month: int,
        assignments: list[Assignment],
        version: int,
        updated_by: str,
    ) -> PersistedSchedule:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = ScheduleRepository(session)
                snapshot = repo.replace_assignments(
                    year, month, assignments, version, updated_by
                )
                session.commit()
                return PersistedSchedule(
                    year=year,
                    month=month,
                    version=snapshot.version,
                    assignments=snapshot.assignments,
                    updated_at=snapshot.updated_at,
                    updated_by=snapshot.updated_by,
                )
        from shift_scheduler.ops.legacy_storage import require_development_storage

        require_development_storage()
        path = self._file_path(year, month)
        # The storage root is an explicit development configuration; the
        # appended basename cannot contain separators.
        # codeql[py/path-injection]
        path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, object] = {
            "version": version,
            "updated_at": datetime.now(UTC).isoformat(),
            "updated_by": updated_by,
            "assignments": [
                assignment.model_dump(mode="json") for assignment in assignments
            ],
        }
        # codeql[py/path-injection]
        with path.open("w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
        updated_at_value = payload["updated_at"]
        return PersistedSchedule(
            year=year,
            month=month,
            version=version,
            assignments=assignments,
            updated_at=datetime.fromisoformat(str(updated_at_value)),
            updated_by=updated_by,
        )

    def current_version(self, year: int, month: int) -> int:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = ScheduleRepository(session)
                return repo.current_version(year, month)
        persisted = self.load(year, month)
        if persisted is None:
            return 0
        return persisted.version


__all__ = ["ScheduleStore", "PersistedSchedule"]
