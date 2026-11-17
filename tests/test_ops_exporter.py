"""Unit tests for schedule export helper utilities."""

from __future__ import annotations

from datetime import date

import pytest

from shift_scheduler.ops import exporter


def test_build_long_rows_sorts_and_formats_iso_dates() -> None:
    assignments: list[dict[str, object]] = [
        {"assignment_date": "2025-02-02", "shift_id": "3B", "person_id": "nurse-b"},
        {
            "assignment_date": date(2025, 2, 1),
            "shift_id": "DAY",
            "person_id": "nurse-a",
        },
        {"assignment_date": "2025-02-01", "shift_id": "EVE", "person_id": "nurse-c"},
    ]

    rows = exporter.build_long_rows(assignments)

    assert rows == [
        {"date": "2025-02-01", "shift_id": "DAY", "person_id": "nurse-a"},
        {"date": "2025-02-01", "shift_id": "EVE", "person_id": "nurse-c"},
        {"date": "2025-02-02", "shift_id": "3B", "person_id": "nurse-b"},
    ]


def test_build_long_rows_invalid_date_type() -> None:
    with pytest.raises(exporter.ExporterError):
        exporter.build_long_rows(
            [{"assignment_date": 123, "shift_id": "DAY", "person_id": "nurse"}]
        )


def test_build_wide_rows_creates_shift_columns() -> None:
    assignments: list[dict[str, str]] = [
        {"assignment_date": "2025-02-01", "shift_id": "2A", "person_id": "alice"},
        {"assignment_date": "2025-02-01", "shift_id": "3B", "person_id": "bob"},
        {"assignment_date": "2025-02-02", "shift_id": "2A", "person_id": "carol"},
    ]

    rows, headers = exporter.build_wide_rows(assignments)

    assert headers == ["2A", "3B"]
    assert rows[0]["date"] == "2025-02-01"
    assert rows[0]["2A"] == "alice"
    assert rows[0]["3B"] == "bob"
    assert rows[0]["weekday"] == "土"  # 2025-02-01 is Saturday
    assert rows[1]["2A"] == "carol"
    assert rows[1]["3B"] == ""


def test_wide_rows_handles_empty_shift_list() -> None:
    rows, headers = exporter.build_wide_rows([])
    assert headers == []
    assert rows == []
