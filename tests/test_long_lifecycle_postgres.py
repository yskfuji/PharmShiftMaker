"""The 25 full-month publication/history trial on real migrated PostgreSQL."""

from tests.test_long_lifecycle_v3 import (
    test_25_month_publication_history_and_late_actual as run_months,
)
from tests.test_planning_postgres import pg as _pg

pg = _pg


def test_full_month_history_on_postgres(pg, monkeypatch):
    run_months(pg, monkeypatch)


def test_nonzero_twelve_month_burden_after_25_months(pg, monkeypatch):
    from tests.test_long_lifecycle_v3 import run_months

    run_months(pg, monkeypatch, night=True)
