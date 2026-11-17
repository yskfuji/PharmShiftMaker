#!/usr/bin/env python3
"""CLI helper to convert exported schedules into attendance-system CSVs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from shift_scheduler.ops.attendance_adapter import (
    AttendanceAdapterError,
    convert_schedule_to_attendance,
)

DEFAULT_MAPPING_CANDIDATE = Path("ops/attendance_mapping.yaml")
DEFAULT_EXAMPLE_MAPPING = Path("ops/attendance_mapping.example.yaml")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "export_schedule.py が生成した schedule_YYYY_MM.json を既存勤怠システム向けの"
            "インポート CSV へ変換します。"
        ),
    )
    parser.add_argument(
        "--schedule-json",
        required=True,
        help="schedule_YYYY_MM.json のパス",
    )
    parser.add_argument(
        "--mapping",
        default=str(DEFAULT_MAPPING_CANDIDATE),
        help="person_id / shift_id を勤怠コードへマッピングする YAML (default: ops/attendance_mapping.yaml)",
    )
    parser.add_argument(
        "--output",
        help="出力 CSV のパス (省略時は schedule_xxx_attendance.csv)",
    )
    parser.add_argument(
        "--drop-missing-persons",
        action="store_true",
        help="mapping に無い person_id を自動的にスキップ",
    )
    parser.add_argument(
        "--passthrough-unknown-shifts",
        action="store_true",
        help="mapping に無い shift_id は shift_id をそのまま shift_code として出力",
    )
    parser.add_argument(
        "--skip-shift",
        action="append",
        default=[],
        metavar="SHIFT_ID",
        help="追加で除外したい shift_id (複数指定可)",
    )
    return parser.parse_args()


def resolve_mapping_path(path_str: str) -> Path:
    path = Path(path_str).expanduser()
    if path.exists():
        return path.resolve()
    raise AttendanceAdapterError(f"Mapping file not found: {path}")


def derive_output_path(schedule_json: Path, output_str: str | None) -> Path:
    if output_str:
        return Path(output_str).expanduser().resolve()
    base = schedule_json.with_suffix("")
    return base.with_name(f"{base.name}_attendance.csv").resolve()


def managed_main(argv: list[str] | None = None) -> int:
    """Managed conversion of a registered schedule copy; resumable across processes.

    The operation identity is derived from the scope, the source copy and hash and the
    mapping bytes, so running the same command again resumes the same registered
    attendance output instead of creating another one.
    """
    parser = argparse.ArgumentParser(description=managed_main.__doc__)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--source-copy-id", required=True)
    parser.add_argument("--source-hash", required=True)
    parser.add_argument("--mapping", required=True)
    args = parser.parse_args(argv)
    from shift_scheduler.db.restore_lock import RestoreUnavailable
    from shift_scheduler.db.session import get_session_factory
    from shift_scheduler.ops.attendance_adapter import (
        convert_managed_schedule_to_attendance,
    )

    try:
        mapping_path = resolve_mapping_path(args.mapping)
        # The operation identity is derived inside, from the mapping bytes it checks.
        path = convert_managed_schedule_to_attendance(
            get_session_factory(),
            args.scope,
            args.source_copy_id,
            args.source_hash,
            mapping_path,
        )
    except (
        AttendanceAdapterError,
        ValueError,
        LookupError,
        OSError,
        RestoreUnavailable,
    ) as exc:
        print(
            "[attendance_adapter] 変換に失敗しました。一時的な障害なら同じコマンドで同じ変換を再開します。"
            f"対応表を直した場合は新しい変換になります: {exc}",
            file=sys.stderr,
        )
        return 1
    copy_id = path.name
    print(f"Managed attendance copy : {copy_id}")
    print(f"Output                  : {path}")
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "managed":
        return managed_main(sys.argv[2:])
    args = parse_args()
    schedule_json = Path(args.schedule_json).expanduser().resolve()
    mapping_path = resolve_mapping_path(args.mapping)
    output_csv = derive_output_path(schedule_json, args.output)

    try:
        summary = convert_schedule_to_attendance(
            schedule_json,
            mapping_path,
            output_csv,
            drop_missing_persons=args.drop_missing_persons,
            passthrough_unknown_shifts=args.passthrough_unknown_shifts,
            extra_skip_shift_ids=args.skip_shift,
        )
    except AttendanceAdapterError as exc:
        print(f"[attendance_adapter] 変換に失敗しました: {exc}", file=sys.stderr)
        return 1

    print("=== Attendance CSV generated ===")
    print(f"Schedule JSON : {schedule_json}")
    print(f"Mapping file  : {mapping_path}")
    print(f"Output CSV    : {summary.output_path}")
    print(f"Rows written  : {summary.written_rows}/{summary.total_assignments}")
    if summary.skipped_total:
        print(
            "Skipped       : "
            f"missing_person={summary.skipped_missing_person}, "
            f"missing_shift={summary.skipped_missing_shift}, "
            f"skip_rule={summary.skipped_by_rule}"
        )
    else:
        print("Skipped       : 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
