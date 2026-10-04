"""希望休(YAML)の読み書きを担当する簡易ストア実装."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import date
from pathlib import Path

import yaml
from sqlalchemy.orm import Session

from shift_scheduler.data.loaders import (
    DEFAULT_CONFIG_DIR,
    USE_DB_BACKEND,
    load_holiday_requests,
    period_component,
)
from shift_scheduler.db.repositories import HolidayRequestRepository
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain import HolidayRequest


class HolidayRequestStore:
    """月単位で希望休データを管理するストア."""

    def __init__(self, config_dir: Path | None = None) -> None:
        self._session_factory: Callable[[], Session] | None = None
        if USE_DB_BACKEND:
            self._session_factory = get_session_factory()
            self._config_dir = DEFAULT_CONFIG_DIR
        else:
            self._config_dir = config_dir or DEFAULT_CONFIG_DIR

    @property
    def config_dir(self) -> Path:
        return self._config_dir

    def _file_path(self, year: int, month: int) -> Path:
        return (
            self._config_dir / f"holiday_requests_{period_component(year, month)}.yaml"
        )

    def list_requests(self, year: int, month: int) -> list[HolidayRequest]:
        """指定年月の希望休を読み込む. ファイルが無ければ空リスト."""

        period_component(year, month)
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = HolidayRequestRepository(session)
                return repo.list_for_month(year, month)
        path = self._file_path(year, month)
        # `_file_path` formats integer year/month values into a fixed basename;
        # neither value can introduce a path separator.
        # codeql[py/path-injection]
        if not path.exists():
            return []
        return load_holiday_requests(year, month, self._config_dir)

    def save_requests(
        self, year: int, month: int, requests: Sequence[HolidayRequest]
    ) -> None:
        period_component(year, month)
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = HolidayRequestRepository(session)
                repo.replace_month(year, month, sorted(requests, key=lambda r: r.order))
                session.commit()
            return
        from shift_scheduler.ops.legacy_storage import require_development_storage

        require_development_storage()
        path = self._file_path(year, month)
        # The caller-selected development root is intentional; the appended
        # basename is composed only from formatted integers.
        # codeql[py/path-injection]
        path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, list[dict[str, object]]] = {"requests": []}
        for req in sorted(requests, key=lambda r: r.order):
            entry: dict[str, object] = {
                "person_id": req.person_id,
                "date": req.request_date.isoformat(),
                "kind": req.kind.value,
                "order": req.order,
            }
            if req.is_approved:
                entry["is_approved"] = req.is_approved
            payload["requests"].append(entry)
        # codeql[py/path-injection]
        with path.open("w", encoding="utf-8") as fp:
            yaml.safe_dump(payload, fp, allow_unicode=True, sort_keys=False)

    def upsert_request(
        self, year: int, month: int, request: HolidayRequest
    ) -> HolidayRequest:
        """希望休を追加または更新して保存する."""
        period_component(year, month)
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = HolidayRequestRepository(session)
                result = repo.upsert(request)
                session.commit()
                return result

        requests = self.list_requests(year, month)
        updated = False
        new_list: list[HolidayRequest] = []
        for existing in requests:
            if (
                existing.person_id == request.person_id
                and existing.request_date == request.request_date
            ):
                replacement = request.model_copy(
                    update={
                        "order": existing.order,
                        "is_approved": existing.is_approved,
                    }
                )
                new_list.append(replacement)
                updated = True
            else:
                new_list.append(existing)
        if not updated:
            next_order = max((req.order for req in requests), default=0) + 1
            request = request.model_copy(update={"order": next_order})
            new_list.append(request)
        self.save_requests(year, month, new_list)
        return request

    def delete_request(
        self, year: int, month: int, person_id: str, request_date: date
    ) -> HolidayRequest:
        """指定の希望休を削除し、削除したレコードを返す."""

        period_component(year, month)
        if USE_DB_BACKEND:
            if self._session_factory is None:  # pragma: no cover - defensive
                raise RuntimeError("Session factory is not configured")
            with self._session_factory() as session:
                repo = HolidayRequestRepository(session)
                db_deleted = repo.delete(person_id, request_date)
                if db_deleted is None:
                    raise KeyError("Holiday request not found")
                session.commit()
                return db_deleted

        requests = self.list_requests(year, month)
        deleted: HolidayRequest | None = None
        remaining: list[HolidayRequest] = []
        for req in requests:
            if req.person_id == person_id and req.request_date == request_date:
                deleted = req
                continue
            remaining.append(req)
        if deleted is None:
            raise KeyError("Holiday request not found")
        self.save_requests(year, month, remaining)
        return deleted


__all__ = ["HolidayRequestStore"]
