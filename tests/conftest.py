"""Shared pytest fixtures for PharmShift test suite."""

from __future__ import annotations

import importlib
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

import shift_scheduler.db.session as db_session_module
from shift_scheduler.db.base import Base
from shift_scheduler.db.session import (
    configure_session_factory,
    get_engine,
    get_session_factory,
)

# These fixtures are shared by integration tests that deliberately keep their
# implementation next to the corresponding boundary tests.  Register the
# modules explicitly so a full-suite run does not depend on collection order or
# on individual test modules re-exporting a fixture.
pytest_plugins = (
    "tests.test_control_authority",
    "tests.test_generation_witness",
    "tests.test_planning_postgres",
    "tests.test_session_idle",
)

_API_TEST_MODULES = (
    "tests.test_api_auth",
    "tests.test_api_schedules",
    "tests.test_api_holiday_requests",
    "tests.test_staff_api",
)


def _resolve_testclients() -> list[Any]:
    clients: list[Any] = []
    for module_name in _API_TEST_MODULES:
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError:  # pragma: no cover - defensive guard
            continue
        client = getattr(module, "client", None)
        if client is not None:
            clients.append(client)
    return clients


_API_TEST_CLIENTS = _resolve_testclients()


@pytest.fixture(autouse=True)
def _isolate_legacy_api_database(request: pytest.FixtureRequest) -> None:
    """Legacy route guards must never inspect the developer's default database."""
    if request.module.__name__ in _API_TEST_MODULES:
        request.getfixturevalue("sqlite_session_factory")


# pyright: ignore[reportUnusedFunction]
@pytest.fixture(autouse=True)
def _clear_testclient_cookies() -> (
    Generator[None, None, None]
):  # pyright: ignore[reportUnusedFunction]
    """Ensure every TestClient starts each test with a clean cookie jar."""

    for client in _API_TEST_CLIENTS:
        client.cookies.clear()
        client.headers["Origin"] = "https://localhost:3000"
    try:
        yield
    finally:
        for client in _API_TEST_CLIENTS:
            client.cookies.clear()
        client.headers["Origin"] = "https://localhost:3000"


# pyright: ignore[reportUnusedFunction]
@pytest.fixture
def sqlite_session_factory(
    tmp_path: Path,
) -> Generator[Any, None, None]:  # pyright: ignore[reportUnusedFunction]
    """Provision a fresh SQLite database for DB persistence tests."""

    db_path = tmp_path / "pharmshift.db"
    configure_session_factory(f"sqlite+pysqlite:///{db_path}")
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        yield get_session_factory()
    finally:
        db_session_module._SessionFactory = (
            None  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        )
        db_session_module._ENGINE = (
            None  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        )
