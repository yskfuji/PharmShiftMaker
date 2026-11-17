from __future__ import annotations

import json
from pathlib import Path

import pytest

from shift_scheduler.ops.attendance_adapter import (
    AdapterConfig,
    AdapterDefaults,
    AttendanceAdapterError,
    PersonMapping,
    ShiftMapping,
    build_attendance_rows,
    convert_schedule_to_attendance,
)


def write_mapping(tmp_path: Path) -> Path:
    mapping = {
        "defaults": {
            "department_code": "PHARM",
            "break_minutes": 60,
            "skip_shift_ids": ["OFF"],
        },
        "people": {
            "sato": {"employee_code": "EMP-001", "person_name": "佐藤"},
            "yahagi": {"employee_code": "EMP-002", "person_name": "矢作"},
        },
        "shifts": {
            "DAY": {
                "attendance_code": "DAY",
                "start_time": "08:30",
                "end_time": "17:15",
                "break_minutes": 60,
            },
            "NIGHT": {
                "attendance_code": "NIGHT",
                "start_time": "17:00",
                "end_time": "09:30",
            },
        },
    }
    path = tmp_path / "mapping.yaml"
    path.write_text(json.dumps(mapping), encoding="utf-8")
    return path


def test_convert_schedule_to_attendance_basic(tmp_path: Path) -> None:
    mapping_path = write_mapping(tmp_path)
    schedule_json = tmp_path / "schedule_2025_02.json"
    payload = {
        "assignments": [
            {"person_id": "sato", "shift_id": "DAY", "assignment_date": "2025-02-01"},
            {"person_id": "yahagi", "shift_id": "OFF", "assignment_date": "2025-02-01"},
            {
                "person_id": "yahagi",
                "shift_id": "NIGHT",
                "assignment_date": "2025-02-02",
            },
        ],
        "warnings": [],
    }
    schedule_json.write_text(json.dumps(payload), encoding="utf-8")

    output_csv = tmp_path / "attendance.csv"
    summary = convert_schedule_to_attendance(
        schedule_json,
        mapping_path,
        output_csv,
        drop_missing_persons=False,
        passthrough_unknown_shifts=False,
    )

    assert summary.total_assignments == 3
    assert summary.written_rows == 2  # OFF が skip される
    assert summary.skipped_by_rule == 1
    assert output_csv.exists()

    rows = output_csv.read_text(encoding="utf-8").strip().splitlines()
    assert rows[0].startswith("date,employee_code")
    assert "2025-02-01,EMP-001" in rows[1]


def test_build_attendance_rows_skip_flags() -> None:
    config = AdapterConfig(
        people={
            "sato": PersonMapping(employee_code="EMP-001"),
        },
        shifts={
            "DAY": ShiftMapping(attendance_code="DAY"),
        },
        defaults=AdapterDefaults(skip_shift_ids=()),
    )
    assignments = [
        {"person_id": "missing", "shift_id": "DAY", "assignment_date": "2025-02-01"},
        {"person_id": "sato", "shift_id": "UNKNOWN", "assignment_date": "2025-02-02"},
    ]

    with pytest.raises(AttendanceAdapterError, match="UNKNOWN"):
        build_attendance_rows(
            assignments,
            config,
            drop_missing_persons=True,
            passthrough_unknown_shifts=False,
        )

    rows, summary = build_attendance_rows(
        assignments,
        config,
        drop_missing_persons=True,
        passthrough_unknown_shifts=True,
    )
    assert summary.skipped_missing_shift == 0
    assert len(rows) == 1


def test_build_attendance_rows_missing_person_raises() -> None:
    config = AdapterConfig(
        people={},
        shifts={"DAY": ShiftMapping(attendance_code="DAY")},
        defaults=AdapterDefaults(skip_shift_ids=()),
    )
    assignments = [
        {"person_id": "unknown", "shift_id": "DAY", "assignment_date": "2025-02-01"},
    ]
    with pytest.raises(AttendanceAdapterError):
        build_attendance_rows(assignments, config)
