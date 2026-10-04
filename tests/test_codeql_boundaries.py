"""反証可能な形で、静的解析が追跡しにくい保存境界を確認する。"""

from __future__ import annotations

import stat
from pathlib import Path

import pytest
from scripts.backup_pipeline import pg_environment
from sqlalchemy.engine import URL

import shift_scheduler.data.holiday_request_store as holiday_store
import shift_scheduler.data.schedule_store as schedule_store


def test_pgpass_is_private_ephemeral_and_absent_from_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    password = "synthetic:p\\ass"
    ambient_secrets = {
        "DATABASE_URL": "postgresql://app:ambient-secret@app.invalid/pharmshift",
        "SHIFT_SCHEDULER_DB_URL": "postgresql://legacy:legacy-secret@db.invalid/app",
        "RESTORE_DATABASE_URL": "postgresql://restore:restore-secret@db.invalid/audit",
        "VAULT_TOKEN": "synthetic-vault-token",
        "AWS_SECRET_ACCESS_KEY": "synthetic-aws-secret",
        "PGPASSWORD": "synthetic-pg-password",
    }
    for key, value in ambient_secrets.items():
        monkeypatch.setenv(key, value)
    audit_container = "pharmshift-storage-closure-synthetic"
    monkeypatch.setenv("PHARMSHIFT_AUDIT_PG_CONTAINER", audit_container)
    database_url = URL.create(
        "postgresql+psycopg",
        username="synthetic-user",
        password=password,
        host="db.example.invalid",
        port=5432,
        database="synthetic-db",
    ).render_as_string(hide_password=False)

    with pg_environment(database_url) as environment:
        password_file = Path(environment["PGPASSFILE"])
        password_directory = password_file.parent
        assert "PGPASSWORD" not in environment
        assert ambient_secrets.keys().isdisjoint(environment)
        assert environment["PHARMSHIFT_AUDIT_PG_CONTAINER"] == audit_container
        assert not any(
            secret in value
            for secret in ambient_secrets.values()
            for value in environment.values()
        )
        assert password not in "\n".join(environment.values())
        assert stat.S_IMODE(password_directory.stat().st_mode) == 0o700
        assert stat.S_IMODE(password_file.stat().st_mode) == 0o600
        assert password_file.read_text(encoding="utf-8") == (
            "db.example.invalid:5432:synthetic-db:synthetic-user:"
            "synthetic\\:p\\\\ass\n"
        )

    assert not password_file.exists()
    assert not password_directory.exists()


def test_integer_periods_cannot_escape_legacy_storage_roots(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(holiday_store, "USE_DB_BACKEND", False)
    monkeypatch.setattr(schedule_store, "USE_DB_BACKEND", False)
    holiday = holiday_store.HolidayRequestStore(config_dir=tmp_path)
    schedule = schedule_store.ScheduleStore(storage_dir=tmp_path)

    for year, month in ((2026, 1), (1, 12), (9999, 12)):
        for path in (holiday._file_path(year, month), schedule._file_path(year, month)):
            assert path.parent == tmp_path
            assert path.relative_to(tmp_path).parts == (path.name,)
            assert "/" not in path.name and "\\" not in path.name

    for year, month in ((0, 1), (10_000, 1), (2026, 0), (2026, 13), (10**300, 1)):
        with pytest.raises(ValueError, match="valid four-digit calendar period"):
            holiday._file_path(year, month)
        with pytest.raises(ValueError, match="valid four-digit calendar period"):
            schedule._file_path(year, month)


def test_invalid_periods_are_rejected_before_database_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_session():
        raise AssertionError("invalid periods must not reach the database")

    monkeypatch.setattr(holiday_store, "USE_DB_BACKEND", True)
    monkeypatch.setattr(schedule_store, "USE_DB_BACKEND", True)
    monkeypatch.setattr(
        holiday_store, "get_session_factory", lambda: unexpected_session
    )
    monkeypatch.setattr(
        schedule_store, "get_session_factory", lambda: unexpected_session
    )
    holiday = holiday_store.HolidayRequestStore()
    schedule = schedule_store.ScheduleStore()

    with pytest.raises(ValueError, match="valid four-digit calendar period"):
        holiday.list_requests(10_000, 1)
    with pytest.raises(ValueError, match="valid four-digit calendar period"):
        holiday.save_requests(2026, 13, [])
    with pytest.raises(ValueError, match="valid four-digit calendar period"):
        schedule.load(10_000, 1)
    with pytest.raises(ValueError, match="valid four-digit calendar period"):
        schedule.current_version(2026, 13)
