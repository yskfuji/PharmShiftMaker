"""Repository for persisted schedule snapshots."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.domain import Assignment

from ..models import ScheduleAssignmentModel, ScheduleSnapshotModel


@dataclass(slots=True, frozen=True)
class ScheduleSnapshot:
    """Lightweight representation of a persisted monthly schedule."""

    year: int
    month: int
    version: int
    updated_at: datetime
    updated_by: str
    assignments: list[Assignment]


class ScheduleRepository:
    """Provides CRUD helpers for persisted schedules."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def load_month(self, year: int, month: int) -> ScheduleSnapshot | None:
        stmt = select(ScheduleSnapshotModel).where(
            ScheduleSnapshotModel.year == year,
            ScheduleSnapshotModel.month == month,
        )
        snapshot = self._session.scalar(stmt)
        if snapshot is None:
            return None
        assignments = [
            Assignment(
                person_id=row.person_id,
                assignment_date=row.assignment_date,
                shift_id=row.shift_id,
            )
            for row in snapshot.assignments
        ]
        assignments.sort(key=lambda a: (a.assignment_date, a.person_id, a.shift_id))
        return ScheduleSnapshot(
            year=snapshot.year,
            month=snapshot.month,
            version=snapshot.version,
            updated_at=snapshot.updated_at,
            updated_by=snapshot.updated_by,
            assignments=assignments,
        )

    def replace_assignments(
        self,
        year: int,
        month: int,
        assignments: Sequence[Assignment],
        version: int,
        updated_by: str,
    ) -> ScheduleSnapshot:
        stmt = select(ScheduleSnapshotModel).where(
            ScheduleSnapshotModel.year == year,
            ScheduleSnapshotModel.month == month,
        )
        snapshot = self._session.scalar(stmt)
        if snapshot is None:
            snapshot = ScheduleSnapshotModel(
                year=year, month=month, version=version, updated_by=updated_by
            )
        snapshot.version = version
        snapshot.updated_by = updated_by
        snapshot.assignments.clear()
        for assignment in assignments:
            snapshot.assignments.append(
                ScheduleAssignmentModel(
                    person_id=assignment.person_id,
                    assignment_date=assignment.assignment_date,
                    shift_id=assignment.shift_id,
                )
            )
        self._session.add(snapshot)
        self._session.flush()
        ordered_assignments = sorted(
            (
                Assignment(
                    person_id=row.person_id,
                    assignment_date=row.assignment_date,
                    shift_id=row.shift_id,
                )
                for row in snapshot.assignments
            ),
            key=lambda a: (a.assignment_date, a.person_id, a.shift_id),
        )
        return ScheduleSnapshot(
            year=year,
            month=month,
            version=snapshot.version,
            updated_at=snapshot.updated_at,
            updated_by=snapshot.updated_by,
            assignments=list(ordered_assignments),
        )

    def current_version(self, year: int, month: int) -> int:
        stmt = select(ScheduleSnapshotModel.version).where(
            ScheduleSnapshotModel.year == year,
            ScheduleSnapshotModel.month == month,
        )
        version = self._session.scalar(stmt)
        return int(version or 0)
