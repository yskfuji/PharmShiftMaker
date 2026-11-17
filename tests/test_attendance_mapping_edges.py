"""F08: attendance mapping edges and file handling (no database needed).

The attendance CSV is a machine import: values are written unchanged and only
quoted by the csv module. Formula escaping is limited to human-view CSVs
(spreadsheet_cell), because prefixing an ID would change what is imported.
"""

import csv
import io
import json

import pytest

from shift_scheduler.ops.attendance_adapter import (
    DEFAULT_OUTPUT_COLUMNS,
    AdapterConfig,
    AdapterDefaults,
    AttendanceAdapterError,
    PersonMapping,
    ShiftMapping,
    build_attendance_rows,
    formula_like,
    load_adapter_config,
    load_assignments_from_json,
    write_attendance_csv,
)
from shift_scheduler.ops.exporter import spreadsheet_cell


def config(shift, *, default_break=None, columns=None):
    defaults = AdapterDefaults(break_minutes=default_break)
    if columns is not None:
        defaults.output_columns = columns
    return AdapterConfig(
        people={"p": PersonMapping(employee_code="E1")},
        shifts={"S": shift},
        defaults=defaults,
    )


def one(shift, **kwargs):
    rows, _ = build_attendance_rows(
        [{"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}],
        config(shift, **kwargs),
    )
    return rows[0]


def test_overnight_shift_is_marked_as_ending_next_day():
    row = one(ShiftMapping(start_time="22:00", end_time="06:00", break_minutes=60))
    assert (row["start_time"], row["end_time"], row["end_day_offset"]) == (
        "22:00",
        "06:00",
        "1",
    )
    same_day = one(ShiftMapping(start_time="08:30", end_time="17:15", break_minutes=60))
    assert same_day["end_day_offset"] == "0"
    assert (
        one(ShiftMapping(attendance_code="X"))["end_day_offset"] == ""
    )  # no times, nothing inferred


def test_identical_start_and_end_is_refused_unless_declared_as_24_hours():
    with pytest.raises(AttendanceAdapterError, match="declare end_day_offset: 1"):
        one(ShiftMapping(start_time="09:00", end_time="09:00"))
    with pytest.raises(AttendanceAdapterError, match="declare end_day_offset: 1"):
        one(ShiftMapping(start_time="09:00", end_time="09:00", end_day_offset=0))
    # Without the end_day_offset output column the importer could not tell 24h from 0h.
    with pytest.raises(
        AttendanceAdapterError, match="add end_day_offset to output_columns"
    ):
        one(ShiftMapping(start_time="09:00", end_time="09:00", end_day_offset=1))
    columns = DEFAULT_OUTPUT_COLUMNS + ("end_day_offset",)
    row = one(
        ShiftMapping(
            start_time="09:00", end_time="09:00", end_day_offset=1, break_minutes=120
        ),
        columns=columns,
    )
    assert (row["start_time"], row["end_time"], row["end_day_offset"]) == (
        "09:00",
        "09:00",
        "1",
    )
    with pytest.raises(AttendanceAdapterError, match="shorter than the shift"):
        one(
            ShiftMapping(
                start_time="09:00",
                end_time="09:00",
                end_day_offset=1,
                break_minutes=1440,
            ),
            columns=columns,
        )
    assert (
        one(
            ShiftMapping(
                start_time="09:00",
                end_time="09:00",
                end_day_offset=1,
                break_minutes=1439,
            ),
            columns=columns,
        )["break_minutes"]
        == "1439"
    )


@pytest.mark.parametrize(
    "start,end,declared", [("22:00", "06:00", 0), ("09:00", "17:00", 1)]
)
def test_declared_day_offset_must_agree_with_the_times(start, end, declared):
    with pytest.raises(AttendanceAdapterError, match="contradicts"):
        one(ShiftMapping(start_time=start, end_time=end, end_day_offset=declared))
    with pytest.raises(AttendanceAdapterError, match="requires start_time"):
        one(ShiftMapping(start_time=start, end_day_offset=declared))


def test_day_offset_in_mapping_file_is_read_and_limited_to_0_or_1(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text(
        json.dumps(
            {
                "shifts": {
                    "DUTY24": {
                        "start_time": "09:00",
                        "end_time": "09:00",
                        "end_day_offset": 1,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    assert load_adapter_config(path).shifts["DUTY24"].end_day_offset == 1
    path.write_text(
        json.dumps({"shifts": {"X": {"end_day_offset": 2}}}), encoding="utf-8"
    )
    with pytest.raises(AttendanceAdapterError, match="0 or 1"):
        load_adapter_config(path)


@pytest.mark.parametrize(
    "start,end,minutes,ok",
    [
        ("09:00", "10:00", 59, True),
        ("09:00", "10:00", 60, False),  # break as long as the shift leaves no work
        ("23:30", "00:30", 59, True),  # overnight length is 60 minutes, not negative
        ("23:30", "00:30", 60, False),
    ],
)
def test_break_must_be_shorter_than_the_shift(start, end, minutes, ok):
    shift = ShiftMapping(start_time=start, end_time=end, break_minutes=minutes)
    if ok:
        assert one(shift)["break_minutes"] == str(minutes)
    else:
        with pytest.raises(AttendanceAdapterError, match="shorter than the shift"):
            one(shift)


def test_default_break_is_checked_against_the_shift_too():
    with pytest.raises(AttendanceAdapterError, match="shorter than the shift"):
        one(ShiftMapping(start_time="09:00", end_time="09:30"), default_break=60)


def test_duplicate_assignment_is_refused_but_two_shifts_a_day_are_allowed():
    cfg = config(ShiftMapping(start_time="09:00", end_time="12:00"))
    cfg.shifts["T"] = ShiftMapping(start_time="13:00", end_time="17:00")
    base = {"assignment_date": "2026-04-01", "person_id": "p"}
    rows, _ = build_attendance_rows(
        [dict(base, shift_id="S"), dict(base, shift_id="T")], cfg
    )
    assert [r["shift_id"] for r in rows] == ["S", "T"]
    with pytest.raises(AttendanceAdapterError, match="duplicate assignment"):
        build_attendance_rows([dict(base, shift_id="S"), dict(base, shift_id="S")], cfg)
    # Skipped rows (OFF) are not written, so repeating them is harmless.
    rows, summary = build_attendance_rows([dict(base, shift_id="OFF")] * 2, cfg)
    assert rows == [] and summary.skipped_by_rule == 2


def mapping_file(tmp_path, columns):
    path = tmp_path / "m.yaml"
    path.write_text(
        json.dumps({"defaults": {"output_columns": columns}}), encoding="utf-8"
    )
    return path


def test_unknown_or_repeated_output_columns_are_refused(tmp_path):
    with pytest.raises(
        AttendanceAdapterError, match="unknown output_columns: employe_code"
    ):
        load_adapter_config(mapping_file(tmp_path, ["date", "employe_code"]))
    with pytest.raises(AttendanceAdapterError, match="repeat"):
        load_adapter_config(
            mapping_file(tmp_path, ["date", "employee_code", "notes", "notes"])
        )
    cfg = load_adapter_config(mapping_file(tmp_path, ["notes", "end_day_offset"]))
    assert cfg.defaults.output_columns == (
        "date",
        "employee_code",
        "notes",
        "end_day_offset",
    )


def test_utf8_bom_is_accepted_and_other_encodings_fail_closed(tmp_path):
    schedule = {
        "assignments": [
            {"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}
        ]
    }
    bom = tmp_path / "bom.json"
    bom.write_bytes(b"\xef\xbb\xbf" + json.dumps(schedule).encode())
    assert len(load_assignments_from_json(bom)) == 1
    mapping = tmp_path / "bom.yaml"
    mapping.write_bytes("﻿people:\n  p: {employee_code: 社員1}\n".encode())
    assert load_adapter_config(mapping).people["p"].employee_code == "社員1"
    sjis = tmp_path / "sjis.yaml"
    sjis.write_bytes("people:\n  p: {employee_code: 社員1}\n".encode("shift_jis"))
    with pytest.raises(AttendanceAdapterError, match="UTF-8"):
        load_adapter_config(sjis)
    sjis_json = tmp_path / "sjis.json"
    sjis_json.write_bytes(
        json.dumps({"assignments": [], "note": "勤務"}, ensure_ascii=False).encode(
            "shift_jis"
        )
    )
    with pytest.raises(AttendanceAdapterError, match="UTF-8"):
        load_assignments_from_json(sjis_json)


def test_free_text_starting_like_a_formula_is_refused_not_rewritten():
    cfg = config(
        ShiftMapping(start_time="09:00", end_time="17:00", notes="=HYPERLINK(1)")
    )
    with pytest.raises(AttendanceAdapterError, match="notes"):
        build_attendance_rows(
            [{"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}], cfg
        )
    cfg = config(ShiftMapping(start_time="09:00", end_time="17:00"))
    cfg.people["p"].person_name = "@x"
    with pytest.raises(AttendanceAdapterError, match="person_name"):
        build_attendance_rows(
            [{"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}], cfg
        )
    # IDs and codes stay unchanged, and ordinary text may start with "-" or "+".
    cfg = config(
        ShiftMapping(
            attendance_code="-N", start_time="09:00", end_time="17:00", notes="- 応援"
        )
    )
    cfg.people["p"].employee_code = "-001"
    cfg.people["p"].person_name = "+81 連絡先"
    rows, _ = build_attendance_rows(
        [{"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}], cfg
    )
    assert (
        rows[0]["employee_code"],
        rows[0]["shift_code"],
        rows[0]["notes"],
        rows[0]["person_name"],
    ) == ("-001", "-N", "- 応援", "+81 連絡先")


@pytest.mark.parametrize(
    "text,refused",
    [
        ("- 応援", False),
        ("-2", False),
        ("+81-3-1234", False),
        ("日勤 -A", False),
        ("", False),
        ("+81 (3) 1234", False),
        ("-(1)", False),
        ("-2+3", False),  # no function call: arithmetic at most
        ("+ SUM(A1)", True),
        ("-cmd|x", True),
        ("-Sheet1!A1", True),
        ("+_xlfn.WEBSERVICE(1)", True),
        # Found by review and confirmed in Excel 16.99 for Mac (spreadsheet-probe*.json):
        ("-SUM (A1)", True),
        ("-HYPERLINK\n(1)", True),
        ("-SUM（A1）", True),
        ('-HYPERLINK（"x"）', True),
        ("-ＨＹＰＥＲＬＩＮＫ(1)", True),
        ("-cmd｜x", True),
        ("- 応援（午前）", False),
        ("- 応援（午前）", False),  # full-width parentheses are not a function call
        ("=1", True),
        ("  =1", True),
        ("@SUM(A1)", True),
        ("\t=1", True),
        ("\r1", True),
        ("-2+3+cmd|' /C calc'!A0", True),
        ('+HYPERLINK("http://x")', True),
        ("-SUM(A1)", True),
        ("＝HYPERLINK（1）", True),
        ("＠SUM（A1）", True),  # full-width = and @ start a formula too
        ("－SUM（A1）", True),
        ("＋cmd｜x！A0", True),  # full-width sign with full-width call/DDE
        ("－ 応援", False),
    ],
)
def test_formula_like_refuses_formulas_but_not_ordinary_dashes(text, refused):
    assert formula_like(text) is refused


def test_malformed_or_missing_files_raise_adapter_errors(tmp_path):
    broken = tmp_path / "broken.json"
    broken.write_text('{"assignments": [', encoding="utf-8")
    with pytest.raises(AttendanceAdapterError, match="not valid JSON"):
        load_assignments_from_json(broken)
    with pytest.raises(AttendanceAdapterError, match="not found"):
        load_assignments_from_json(tmp_path / "absent.json")
    bad_yaml = tmp_path / "bad.yaml"
    bad_yaml.write_text("people: [unclosed", encoding="utf-8")
    with pytest.raises(AttendanceAdapterError, match="not valid YAML"):
        load_adapter_config(bad_yaml)
    impossible_date = tmp_path / "date.yaml"
    impossible_date.write_text("defaults: {note: 2026-02-30}\n", encoding="utf-8")
    with pytest.raises(AttendanceAdapterError, match="not valid YAML"):
        load_adapter_config(impossible_date)
    deep = tmp_path / "deep.json"
    deep.write_text("[" * 100_000, encoding="utf-8")
    with pytest.raises(AttendanceAdapterError, match="not valid JSON"):
        load_assignments_from_json(deep)


def test_machine_csv_keeps_values_exactly_and_quotes_separators(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "shift_scheduler.ops.legacy_storage.require_development_storage", lambda: None
    )
    tricky = {
        "date": "2026-04-01",
        "employee_code": "-001",
        "person_name": '=HYPERLINK("x")',
        "notes": 'a,b\n"c"',
    }
    path = tmp_path / "out.csv"
    write_attendance_csv(
        path, [tricky], ["date", "employee_code", "person_name", "notes"]
    )
    read_back = list(
        csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"), newline=""))
    )
    assert read_back == [tricky]  # machine import: no prefix, exact round trip


@pytest.mark.parametrize(
    "value,expected",
    [
        ("=1+1", "'=1+1"),
        ("+81", "'+81"),
        ("-2", "'-2"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("  =1", "'  =1"),  # leading spaces do not hide a formula
        ("\t=1", "'\t=1"),
        ("\r1", "'\r1"),
        ("\n1", "'\n1"),
        ("A=1", "A=1"),
        ("", ""),
        ("佐藤", "佐藤"),
        ("'=1", "'=1"),
    ],
)
def test_spreadsheet_cell_escapes_formula_starts_only(value, expected):
    assert spreadsheet_cell(value) == expected
