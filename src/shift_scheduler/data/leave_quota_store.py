"""Persistence helper for per-person leave quotas."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from shift_scheduler.data.loaders import DEFAULT_CONFIG_DIR, USE_DB_BACKEND
from shift_scheduler.db.models import LeaveQuotaModel
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain import HolidayRequestKind, LeaveQuota


class LeaveQuotaStore:
    """Stores annual leave quotas either in YAML or the relational DB."""

    def __init__(self, config_dir: Path | None = None) -> None:
        self._config_path = (
            config_dir or DEFAULT_CONFIG_DIR
        ) / "staff_leave_quotas.yaml"
        self._session_factory: Callable[[], Session] | None = None
        if USE_DB_BACKEND:
            self._session_factory = get_session_factory()

    def list_all(self) -> list[LeaveQuota]:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                rows = session.scalars(select(LeaveQuotaModel)).all()
                return [
                    LeaveQuota(
                        person_id=row.person_id,
                        year=row.year,
                        kind=HolidayRequestKind(row.leave_type),
                        total_days=row.total_days,
                    )
                    for row in rows
                ]
        return self._read_yaml_entries()

    def upsert(self, quota: LeaveQuota) -> LeaveQuota:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                stmt = select(LeaveQuotaModel).where(
                    LeaveQuotaModel.person_id == quota.person_id,
                    LeaveQuotaModel.year == quota.year,
                    LeaveQuotaModel.leave_type == quota.kind.value,
                )
                row = session.scalar(stmt)
                if row is None:
                    row = LeaveQuotaModel(
                        person_id=quota.person_id,
                        year=quota.year,
                        leave_type=quota.kind.value,
                        total_days=quota.total_days,
                    )
                else:
                    row.total_days = quota.total_days
                session.add(row)
                session.commit()
                return quota

        entries = self._read_yaml_entries_raw()
        updated = False
        for entry in entries:
            if (
                entry["person_id"] == quota.person_id
                and int(entry["year"]) == quota.year
                and entry["kind"] == quota.kind.value
            ):
                entry["total_days"] = quota.total_days
                updated = True
                break
        if not updated:
            entries.append(
                {
                    "person_id": quota.person_id,
                    "year": quota.year,
                    "kind": quota.kind.value,
                    "total_days": quota.total_days,
                }
            )
        self._write_yaml_entries(entries)
        return quota

    def delete(self, person_id: str, year: int, kind: HolidayRequestKind) -> None:
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                stmt = delete(LeaveQuotaModel).where(
                    LeaveQuotaModel.person_id == person_id,
                    LeaveQuotaModel.year == year,
                    LeaveQuotaModel.leave_type == kind.value,
                )
                session.execute(stmt)
                session.commit()
            return

        entries = self._read_yaml_entries_raw()
        filtered = [
            entry
            for entry in entries
            if not (
                entry["person_id"] == person_id
                and int(entry["year"]) == year
                and entry["kind"] == kind.value
            )
        ]
        self._write_yaml_entries(filtered)

    # --- YAML helpers -------------------------------------------------

    def _read_yaml_entries(self) -> list[LeaveQuota]:
        return [
            LeaveQuota(
                person_id=entry["person_id"],
                year=int(entry["year"]),
                kind=HolidayRequestKind(entry["kind"]),
                total_days=int(entry.get("total_days", 0)),
            )
            for entry in self._read_yaml_entries_raw()
        ]

    def _read_yaml_entries_raw(self) -> list[dict[str, Any]]:
        if not self._config_path.exists():
            return []
        with self._config_path.open("r", encoding="utf-8") as fp:
            payload = yaml.safe_load(fp) or {}
        items = payload.get("leave_quotas", [])
        if not isinstance(items, list):
            raise ValueError("leave_quotas must be a list")
        normalized: list[dict[str, Any]] = []
        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            normalized.append(
                {
                    "person_id": str(raw_item.get("person_id", "")).strip(),
                    "year": int(raw_item.get("year", 0)),
                    "kind": str(raw_item.get("kind", "")).strip(),
                    "total_days": int(raw_item.get("total_days", 0)),
                }
            )
        return normalized

    def _write_yaml_entries(self, entries: list[dict[str, Any]]) -> None:
        from shift_scheduler.ops.legacy_storage import require_development_storage

        require_development_storage()
        data = {
            "leave_quotas": sorted(
                entries,
                key=lambda item: (item["person_id"], int(item["year"]), item["kind"]),
            )
        }
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        with self._config_path.open("w", encoding="utf-8") as fp:
            yaml.safe_dump(data, fp, allow_unicode=True, sort_keys=False)


__all__ = ["LeaveQuotaStore"]
