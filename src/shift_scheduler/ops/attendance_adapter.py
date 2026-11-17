"""Adapter utilities to convert schedule exports into attendance CSVs."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any, cast

import yaml

if TYPE_CHECKING:
    from sqlalchemy.orm import Session, sessionmaker

DEFAULT_OUTPUT_COLUMNS: tuple[str, ...] = (
    "date",
    "employee_code",
    "person_id",
    "person_name",
    "shift_id",
    "shift_code",
    "start_time",
    "end_time",
    "break_minutes",
    "department_code",
    "location_code",
    "notes",
)
# Optional columns that are only written when listed in output_columns.
# end_day_offset is "1" when the shift ends on the next calendar day.
OPTIONAL_OUTPUT_COLUMNS: tuple[str, ...] = ("end_day_offset",)
KNOWN_OUTPUT_COLUMNS = frozenset(DEFAULT_OUTPUT_COLUMNS + OPTIONAL_OUTPUT_COLUMNS)


class AttendanceAdapterError(RuntimeError):
    """Raised when schedule → attendance conversion fails."""


@dataclass(slots=True)
class PersonMapping:
    """Per-person overrides for attendance exports."""

    employee_code: str
    department_code: str | None = None
    location_code: str | None = None
    person_name: str | None = None
    notes: str | None = None


@dataclass(slots=True)
class ShiftMapping:
    """Shift → attendance attributes mapping."""

    attendance_code: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    break_minutes: int | None = None
    department_code: str | None = None
    location_code: str | None = None
    notes: str | None = None
    # 1 when the shift ends on the next day. Required for a 24-hour duty whose
    # start and end times are equal (09:00 -> 09:00); inferred otherwise.
    end_day_offset: int | None = None


@dataclass(slots=True)
class AdapterDefaults:
    """Fallback attributes applied when mapping entries omit fields."""

    department_code: str | None = None
    location_code: str | None = None
    break_minutes: int | None = None
    skip_shift_ids: tuple[str, ...] = ("OFF",)
    output_columns: tuple[str, ...] = DEFAULT_OUTPUT_COLUMNS


def _person_mapping_factory() -> dict[str, PersonMapping]:
    return {}


def _shift_mapping_factory() -> dict[str, ShiftMapping]:
    return {}


@dataclass(slots=True)
class AdapterConfig:
    """Container for mapping tables and defaults."""

    people: dict[str, PersonMapping] = field(default_factory=_person_mapping_factory)
    shifts: dict[str, ShiftMapping] = field(default_factory=_shift_mapping_factory)
    defaults: AdapterDefaults = field(default_factory=AdapterDefaults)


@dataclass(slots=True)
class ConversionSummary:
    """Metadata describing conversion outcome."""

    output_path: Path
    total_assignments: int
    written_rows: int
    skipped_missing_person: int = 0
    skipped_missing_shift: int = 0
    skipped_by_rule: int = 0

    @property
    def skipped_total(self) -> int:
        return (
            self.skipped_missing_person
            + self.skipped_missing_shift
            + self.skipped_by_rule
        )


def load_adapter_config(path: Path) -> AdapterConfig:
    """Load YAML/JSON mapping file."""

    if not path.exists():
        raise AttendanceAdapterError(f"Mapping file not found: {path}")

    try:
        raw_data: Any = yaml.safe_load(_read_utf8(path))
    except (yaml.YAMLError, ValueError, RecursionError) as exc:
        # ValueError: e.g. an impossible date such as 2026-02-30 in a YAML timestamp.
        raise AttendanceAdapterError(
            f"Mapping file is not valid YAML/JSON: {path}"
        ) from exc
    if raw_data is None:
        raw_data = {}
    if not isinstance(raw_data, Mapping):
        raise AttendanceAdapterError("Mapping file must contain a mapping at top-level")

    root = cast(Mapping[str, Any], raw_data)

    people_section = _get_mapping_section(root, "people")
    shifts_section = _get_mapping_section(root, "shifts")
    defaults_section = _get_mapping_section(root, "defaults")
    defaults_mapping: Mapping[str, Any] = (
        defaults_section if defaults_section is not None else {}
    )

    people = {
        person_id: PersonMapping(
            employee_code=_require_str(data, "employee_code", f"people.{person_id}"),
            department_code=_optional_str(data, "department_code"),
            location_code=_optional_str(data, "location_code"),
            person_name=_optional_str(data, "person_name"),
            notes=_optional_str(data, "notes"),
        )
        for person_id, data in _iter_mapping(people_section, "people")
    }

    shifts = {
        shift_id: ShiftMapping(
            attendance_code=_optional_str(data, "attendance_code"),
            start_time=_optional_str(data, "start_time"),
            end_time=_optional_str(data, "end_time"),
            break_minutes=_optional_int(data, "break_minutes"),
            department_code=_optional_str(data, "department_code"),
            location_code=_optional_str(data, "location_code"),
            notes=_optional_str(data, "notes"),
            end_day_offset=_day_offset(data, f"shifts.{shift_id}"),
        )
        for shift_id, data in _iter_mapping(shifts_section, "shifts")
    }

    defaults = AdapterDefaults(
        department_code=_optional_str(defaults_mapping, "department_code"),
        location_code=_optional_str(defaults_mapping, "location_code"),
        break_minutes=_optional_int(defaults_mapping, "break_minutes"),
        skip_shift_ids=tuple(
            _list_of_str(defaults_mapping.get("skip_shift_ids", ("OFF",)) or ())
        ),
        output_columns=_build_output_columns(defaults_mapping.get("output_columns")),
    )

    return AdapterConfig(people=people, shifts=shifts, defaults=defaults)


def load_assignments_from_json(path: Path) -> list[Mapping[str, Any]]:
    """Extract assignments list from schedule export json."""

    if not path.exists():
        raise AttendanceAdapterError(f"Schedule file not found: {path}")
    try:
        payload_obj = json.loads(_read_utf8(path))
    except (json.JSONDecodeError, RecursionError) as exc:
        raise AttendanceAdapterError(
            f"Schedule file is not valid JSON: {path}"
        ) from exc
    if not isinstance(payload_obj, Mapping):
        raise AttendanceAdapterError("JSON ルートは mapping である必要があります")
    payload = cast(Mapping[str, Any], payload_obj)
    assignments = payload.get("assignments")
    if assignments is None:
        raise AttendanceAdapterError("JSON に assignments が含まれていません")
    if not isinstance(assignments, list):
        raise AttendanceAdapterError("assignments は list である必要があります")
    assignments_list = assignments
    normalized: list[Mapping[str, Any]] = []
    for idx, item in enumerate(assignments_list):
        if not isinstance(item, Mapping):
            raise AttendanceAdapterError(
                f"assignments[{idx}] は mapping である必要があります"
            )
        normalized.append(cast(Mapping[str, Any], item))
    return normalized


def build_attendance_rows(
    assignments: Sequence[Mapping[str, Any]],
    config: AdapterConfig,
    *,
    drop_missing_persons: bool = False,
    passthrough_unknown_shifts: bool = False,
    extra_skip_shift_ids: Sequence[str] | None = None,
) -> tuple[list[dict[str, str]], ConversionSummary]:
    """Transform assignments into attendance rows."""

    rows: list[dict[str, str]] = []
    skipped_missing_person = 0
    skipped_missing_shift = 0
    skipped_by_rule = 0

    skip_shift_ids = set(config.defaults.skip_shift_ids)
    if extra_skip_shift_ids:
        skip_shift_ids.update(extra_skip_shift_ids)

    seen: set[tuple[str, str, str]] = set()
    for assignment in assignments:
        shift_id = str(assignment.get("shift_id", ""))
        if shift_id in skip_shift_ids:
            skipped_by_rule += 1
            continue

        person_id = str(assignment.get("person_id", ""))
        person_cfg = config.people.get(person_id)
        if person_cfg is None:
            if drop_missing_persons:
                skipped_missing_person += 1
                continue
            raise AttendanceAdapterError(
                f"person_id '{person_id}' が mapping に存在しません"
            )

        shift_cfg = config.shifts.get(shift_id)
        if shift_cfg is None:
            if passthrough_unknown_shifts:
                shift_cfg = ShiftMapping(attendance_code=shift_id)
            else:
                raise AttendanceAdapterError(
                    f"shift_id '{shift_id}' が mapping に存在しません"
                )

        iso_date = _ensure_iso_date(assignment.get("assignment_date"))
        # The same shift twice on one day would be counted twice by the
        # attendance system; refuse it instead of writing a duplicate row.
        key = (iso_date, person_id, shift_id)
        if key in seen:
            raise AttendanceAdapterError(
                f"duplicate assignment: {iso_date} {person_id} {shift_id}"
            )
        seen.add(key)
        row = _build_row(
            iso_date, person_id, person_cfg, shift_id, shift_cfg, config.defaults
        )
        rows.append(row)

    rows.sort(
        key=lambda item: (item["date"], item["employee_code"], item["shift_code"])
    )

    summary = ConversionSummary(
        output_path=Path(),
        total_assignments=len(assignments),
        written_rows=len(rows),
        skipped_missing_person=skipped_missing_person,
        skipped_missing_shift=skipped_missing_shift,
        skipped_by_rule=skipped_by_rule,
    )
    return rows, summary


def write_attendance_csv(
    path: Path, rows: Sequence[Mapping[str, str]], columns: Sequence[str]
) -> None:
    """Write attendance rows to CSV."""

    from shift_scheduler.ops.legacy_storage import require_development_storage

    require_development_storage()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=list(columns))
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in columns})


def convert_schedule_to_attendance(
    schedule_json: Path,
    mapping_path: Path,
    output_csv: Path,
    *,
    drop_missing_persons: bool = False,
    passthrough_unknown_shifts: bool = False,
    extra_skip_shift_ids: Sequence[str] | None = None,
) -> ConversionSummary:
    """High level helper used by CLI and tests."""

    config = load_adapter_config(mapping_path)
    assignments = load_assignments_from_json(schedule_json)
    rows, summary = build_attendance_rows(
        assignments,
        config,
        drop_missing_persons=drop_missing_persons,
        passthrough_unknown_shifts=passthrough_unknown_shifts,
        extra_skip_shift_ids=extra_skip_shift_ids,
    )

    write_attendance_csv(output_csv, rows, config.defaults.output_columns)

    return ConversionSummary(
        output_path=output_csv,
        total_assignments=summary.total_assignments,
        written_rows=len(rows),
        skipped_missing_person=summary.skipped_missing_person,
        skipped_missing_shift=summary.skipped_missing_shift,
        skipped_by_rule=summary.skipped_by_rule,
    )


def _build_row(
    iso_date: str,
    person_id: str,
    person_cfg: PersonMapping,
    shift_id: str,
    shift_cfg: ShiftMapping,
    defaults: AdapterDefaults,
) -> dict[str, str]:
    department_code = (
        person_cfg.department_code
        or shift_cfg.department_code
        or defaults.department_code
        or ""
    )
    location_code = (
        person_cfg.location_code
        or shift_cfg.location_code
        or defaults.location_code
        or ""
    )

    break_minutes = shift_cfg.break_minutes
    if break_minutes is None:
        break_minutes = defaults.break_minutes

    if break_minutes is not None and (
        isinstance(break_minutes, bool) or break_minutes < 0
    ):
        raise AttendanceAdapterError("break_minutes must be a non-negative integer")
    parsed_times: list[time] = []
    for value in (shift_cfg.start_time, shift_cfg.end_time):
        if value is not None:
            try:
                parsed = time.fromisoformat(value)
                if parsed.tzinfo is not None or len(value) != 5:
                    raise ValueError("expected HH:MM")
            except ValueError as exc:
                raise AttendanceAdapterError("shift time must be HH:MM") from exc
            parsed_times.append(parsed)
    end_day_offset = ""
    declared = shift_cfg.end_day_offset
    if declared is not None and len(parsed_times) != 2:
        raise AttendanceAdapterError(
            f"shift '{shift_id}' end_day_offset requires start_time and end_time"
        )
    if len(parsed_times) == 2:
        start, end = parsed_times
        if start == end:
            # 0h or 24h cannot be told apart from HH:MM alone: a 24-hour duty
            # must be declared, a zero-length shift is refused.
            if declared != 1:
                raise AttendanceAdapterError(
                    f"shift '{shift_id}' start and end are identical; "
                    "declare end_day_offset: 1 for a 24-hour duty"
                )
            if "end_day_offset" not in defaults.output_columns:
                # Without the column the importer cannot tell 24h from 0h.
                raise AttendanceAdapterError(
                    f"shift '{shift_id}' is a 24-hour duty; add end_day_offset to output_columns"
                )
            offset, minutes = 1, 24 * 60
        else:
            offset = 1 if end < start else 0
            if declared is not None and declared != offset:
                raise AttendanceAdapterError(
                    f"shift '{shift_id}' end_day_offset {declared} contradicts its times"
                )
            minutes = (
                datetime.combine(date.min, end) - datetime.combine(date.min, start)
            ).seconds // 60
        end_day_offset = str(offset)
        if break_minutes is not None and break_minutes >= minutes:
            raise AttendanceAdapterError(
                f"shift '{shift_id}' break_minutes must be shorter than the shift"
            )

    person_name = person_cfg.person_name or person_id
    shift_code = shift_cfg.attendance_code or shift_id

    notes = ", ".join(filter(None, [person_cfg.notes, shift_cfg.notes]))
    # Free text may be opened in a spreadsheet. Values are never rewritten (this
    # is a machine import), so a formula-like start is refused instead.
    for label, text in (
        ("person_name", person_name),
        ("notes", notes),
        ("employee_code", person_cfg.employee_code),
        ("shift_code", shift_code),
        ("department_code", department_code),
        ("location_code", location_code),
    ):
        if formula_like(text):
            raise AttendanceAdapterError(
                f"{label} for '{person_id}' must not start like a spreadsheet formula"
            )

    return {
        "date": iso_date,
        "employee_code": person_cfg.employee_code,
        "person_id": person_id,
        "person_name": person_name,
        "shift_id": shift_id,
        "shift_code": shift_code,
        "start_time": shift_cfg.start_time or "",
        "end_time": shift_cfg.end_time or "",
        "break_minutes": str(break_minutes) if break_minutes is not None else "",
        "department_code": department_code,
        "location_code": location_code,
        "notes": notes,
        "end_day_offset": end_day_offset,
    }


def _ensure_iso_date(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
            if value != parsed.isoformat():
                raise ValueError("expected YYYY-MM-DD")
            return parsed.isoformat()
        except ValueError as exc:
            raise AttendanceAdapterError("assignment_date must be YYYY-MM-DD") from exc
    raise AttendanceAdapterError(
        "assignment_date は ISO8601 文字列である必要があります"
    )


# Excel accepts whitespace (even a newline) between a function name and "("
# (checked: "-SUM (A1)" became a formula in Excel 16.99 for Mac).
_FUNCTION_CALL = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*\s*\(")


def formula_like(text: str) -> bool:
    """Whether a value could run as a spreadsheet formula when opened by a person.

    Leading spaces and invisible format characters (Unicode Cf) are skipped, and
    each part separated by ";" is judged (locales that use ";" as the separator).

    "=" and "@" (after leading spaces) and a leading tab/CR/LF always start a
    formula. A leading "-" or "+" is ordinary text ("- 応援", "+81 (3) 1234") unless
    the rest calls a function (a name immediately followed by "(", e.g. SUM( or
    HYPERLINK() or uses DDE / another sheet ("|" or "!"), as in the OWASP CSV
    injection payloads -2+3+cmd|' /C calc'!A0 and +HYPERLINK(...). Plain
    arithmetic such as -2+3 may become a formula but cannot reach outside the cell.
    """
    if ";" in text:
        # Where ";" is the list separator, each part may open as its own cell.
        head, *parts = text.split(";")
        return formula_like(head) or any(formula_like(part) for part in parts)
    if text.startswith(("\t", "\r", "\n")):
        return True
    # Invisible format characters (zero-width space, BOM, ...) and spaces in any
    # order do not hide a formula.
    stripped = text
    while stripped and (
        (stripped[0].isspace() and stripped[0] not in "\t\r\n")
        or unicodedata.category(stripped[0]) == "Cf"
    ):
        stripped = stripped[1:]
    if stripped.startswith(("\t", "\r", "\n")):
        return True
    head = unicodedata.normalize("NFKC", stripped[:1])
    if head in ("=", "@"):
        return True
    if head not in ("-", "+"):
        return False
    # Excel folds full-width characters inside a formula (checked: "-SUM（A1）" and
    # "-HYPERLINK（...）" became function calls), so the rest is always normalised.
    # Japanese text before a bracket ("- 応援（午前）") is still not a function name.
    rest = unicodedata.normalize("NFKC", stripped[1:])
    return "|" in rest or "!" in rest or _FUNCTION_CALL.search(rest) is not None


def _day_offset(data: Mapping[str, Any], context: str) -> int | None:
    value = _optional_int(data, "end_day_offset")
    if value not in (None, 0, 1):
        raise AttendanceAdapterError(f"{context}.end_day_offset must be 0 or 1")
    return value


def _read_utf8(path: Path) -> str:
    """UTF-8 only (a leading BOM is accepted, RFC 8259 8.1); never guess other encodings."""
    try:
        return path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AttendanceAdapterError(f"{path.name} must be UTF-8 encoded") from exc


def _require_str(data: Mapping[str, Any], key: str, context: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise AttendanceAdapterError(f"{context}.{key} は必須の文字列です")
    return value


def _optional_str(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise AttendanceAdapterError(f"{key} は文字列である必要があります")
    return value


def _optional_int(data: Mapping[str, Any], key: str) -> int | None:
    value = data.get(key)
    if value is None:
        return None
    if isinstance(value, bool):  # bool is subclass of int, reject to avoid confusion
        raise AttendanceAdapterError(f"{key} は整数で指定してください")
    if isinstance(value, int):
        return value
    raise AttendanceAdapterError(f"{key} は整数で指定してください")


def _iter_mapping(
    section: Mapping[str, Any] | None, label: str
) -> list[tuple[str, Mapping[str, Any]]]:
    if section is None:
        return []
    items: list[tuple[str, Mapping[str, Any]]] = []
    for key, value in section.items():
        if not isinstance(value, Mapping):
            raise AttendanceAdapterError(
                f"{label}.{key} は mapping である必要があります"
            )
        items.append((str(key), cast(Mapping[str, Any], value)))
    return items


def _get_mapping_section(root: Mapping[str, Any], key: str) -> Mapping[str, Any] | None:
    value = root.get(key)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise AttendanceAdapterError(f"{key} セクションは mapping である必要があります")
    return cast(Mapping[str, Any], value)


def _list_of_str(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, (list, tuple)):
        sequence = cast(Sequence[Any], values)
        result: list[str] = []
        for item in sequence:
            if not isinstance(item, str):
                raise AttendanceAdapterError(
                    "skip_shift_ids には文字列のみ指定してください"
                )
            result.append(item)
        return result
    raise AttendanceAdapterError("skip_shift_ids は list で指定してください")


def _build_output_columns(value: Any) -> tuple[str, ...]:
    if value is None:
        return DEFAULT_OUTPUT_COLUMNS
    if isinstance(value, (list, tuple)):
        sequence = cast(Sequence[Any], value)
        columns: list[str] = [str(item) for item in sequence]
        unknown = sorted(set(columns) - KNOWN_OUTPUT_COLUMNS)
        if unknown:
            # A misspelt column would otherwise be written as an empty column.
            raise AttendanceAdapterError(
                f"unknown output_columns: {', '.join(unknown)}"
            )
        if len(set(columns)) != len(columns):
            raise AttendanceAdapterError("output_columns must not repeat a column")
        if "date" not in columns:
            columns.insert(0, "date")
        if "employee_code" not in columns:
            columns.insert(1, "employee_code")
        return tuple(columns)
    raise AttendanceAdapterError("output_columns は list で指定してください")


__all__ = [
    "AdapterConfig",
    "AdapterDefaults",
    "AttendanceAdapterError",
    "ConversionSummary",
    "PersonMapping",
    "ShiftMapping",
    "build_attendance_rows",
    "convert_schedule_to_attendance",
    "formula_like",
    "load_adapter_config",
    "load_assignments_from_json",
    "write_attendance_csv",
]


def managed_attendance_copy_id(
    scope: str, source_copy_id: str, source_hash: str, mapping_path: str | Path
) -> str:
    """Deterministic operation identity: a rerun from another process resumes it."""
    import hashlib

    mapping_hash = hashlib.sha256(Path(mapping_path).read_bytes()).hexdigest()
    return hashlib.sha256(
        "|".join([scope, source_copy_id, source_hash, mapping_hash]).encode()
    ).hexdigest()[:32]


def convert_managed_schedule_to_attendance(
    factory: sessionmaker[Session],
    scope: str,
    source_copy_id: str,
    source_hash: str,
    mapping_path: str | Path,
    copy_id: str | None = None,
) -> Path:
    """Convert exact registered schedule bytes to a registered attendance artifact.

    The mapping hash is part of operation identity. This prevents retry under a
    changed employee/shift mapping from silently replacing an existing output.
    """
    import hashlib
    import io

    from shift_scheduler.application.copies import checked_file
    from shift_scheduler.application.planning import Conflict
    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.ops import managed_writer

    mapping_hash = hashlib.sha256(Path(mapping_path).read_bytes()).hexdigest()
    if copy_id is None:
        # Derived from the same mapping bytes that are checked below (no gap between
        # choosing the identity and reading the mapping).
        copy_id = hashlib.sha256(
            "|".join([scope, source_copy_id, source_hash, mapping_hash]).encode()
        ).hexdigest()[:32]
    with factory() as session:
        source = session.get(ManagedCopy, source_copy_id)
        if (
            not source
            or source.scope_id != scope
            or source.medium != "file"
            or source.content_hash != source_hash
            or source.state != "PRESENT"
        ):
            raise Conflict("Managed schedule source changed or is unavailable")
        source_path = checked_file(source.locator["relative_path"])
    managed_writer.reserve_capture(
        factory, scope, copy_id, "attendance.csv", {source_copy_id: source_hash}
    )
    with factory.begin() as session:
        row = session.get(ManagedCopy, copy_id, with_for_update=True)
        if row is None:  # reserve_capture above registered it
            raise Conflict("Managed capture reservation missing")
        old = row.evidence.get("mapping_hash")
        if old is not None and old != mapping_hash:
            raise Conflict("Attendance mapping changed; use a new operation")
        row.evidence = {**row.evidence, "mapping_hash": mapping_hash}

    def produce(stream: IO[bytes]) -> None:
        if hashlib.sha256(Path(mapping_path).read_bytes()).hexdigest() != mapping_hash:
            raise Conflict("Attendance mapping changed during conversion")
        config = load_adapter_config(Path(mapping_path))
        rows, _ = build_attendance_rows(load_assignments_from_json(source_path), config)
        output = io.StringIO(newline="")
        csv_writer = csv.DictWriter(
            output, fieldnames=list(config.defaults.output_columns)
        )
        csv_writer.writeheader()
        for row in rows:
            csv_writer.writerow(
                {col: row.get(col, "") for col in config.defaults.output_columns}
            )
        stream.write(output.getvalue().encode("utf-8"))
        if hashlib.sha256(Path(mapping_path).read_bytes()).hexdigest() != mapping_hash:
            raise Conflict("Attendance mapping changed during conversion")

    return managed_writer.capture(factory, scope, copy_id, produce)
