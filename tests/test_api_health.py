"""Health API endpoint tests."""

from __future__ import annotations

from types import TracebackType
from typing import Any

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app

client = TestClient(app)


def test_livez_returns_ok() -> None:
    response = client.get("/livez")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_healthz_skips_database_when_not_db_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SHIFT_SCHEDULER_DATA_BACKEND", raising=False)
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["details"]["database"] == "skipped"


def test_healthz_checks_database_when_backend_is_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SHIFT_SCHEDULER_DATA_BACKEND", "db")

    executed: dict[str, Any] = {"count": 0}

    class _DummyConnection:
        def __enter__(self) -> _DummyConnection:
            return self

        def __exit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            tb: TracebackType | None,
        ) -> None:  # pragma: no cover - nothing to clean
            return None

        def execute(self, statement: object) -> None:  # pragma: no cover - simple stub
            executed["count"] += 1

    class _DummyEngine:
        def connect(self) -> _DummyConnection:  # pragma: no cover - simple stub
            return _DummyConnection()

    monkeypatch.setattr(
        "shift_scheduler.api.routers.health.get_engine", lambda: _DummyEngine()
    )

    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["details"]["database"] == "ok"
    assert executed["count"] == 1


def test_healthz_returns_503_when_database_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SHIFT_SCHEDULER_DATA_BACKEND", "db")

    def _broken_engine() -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("shift_scheduler.api.routers.health.get_engine", _broken_engine)

    response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["detail"] == "database_unavailable"
