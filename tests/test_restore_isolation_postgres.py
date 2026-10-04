import pytest
from sqlalchemy import create_engine, text

from shift_scheduler.db.restore_lock import (
    RESTORE_LOCK,
    RestoreUnavailable,
    protect_engine,
)
from tests.test_planning_postgres import pg as _pg

pg = _pg


def test_restore_lock_excludes_application_before_restored_schema(pg):
    engine = pg.kw["bind"]
    protected = create_engine(engine.url)
    protect_engine(protected)
    try:
        with engine.connect() as operator:
            assert operator.scalar(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": RESTORE_LOCK}
            )
            try:
                with pytest.raises(RestoreUnavailable):
                    with protected.begin() as request:
                        request.execute(text("SELECT 1"))
            finally:
                operator.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": RESTORE_LOCK}
                )
        with protected.begin() as request:
            assert request.scalar(text("SELECT 1")) == 1
    finally:
        protected.dispose()


def test_quarantine_blocks_even_after_exclusive_lock_released(pg):
    engine = pg.kw["bind"]
    protected = create_engine(engine.url)
    protect_engine(protected)
    try:
        with engine.begin() as operator:
            operator.execute(
                text(
                    "INSERT INTO restore_gates(gate_id,state) VALUES ('restore','QUARANTINED')"
                )
            )
        with pytest.raises(RestoreUnavailable), protected.begin() as request:
            request.execute(text("SELECT 1"))
        with engine.begin() as operator:
            operator.execute(text("UPDATE restore_gates SET state='REPLAYED'"))
        with protected.begin() as request:
            assert request.scalar(text("SELECT 1")) == 1
    finally:
        protected.dispose()
