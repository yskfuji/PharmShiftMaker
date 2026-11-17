#!/usr/bin/env python3
"""CLI helper to export confirmed schedules to JSON/CSV."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from shift_scheduler.ops.exporter import ExporterError, ExportOptions, export_schedule
from shift_scheduler.security.secrets import get_secret


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="公開済み勤務表を登録・検証して JSON/CSV として保存するユーティリティ",
    )
    parser.add_argument("--base-url", help="FastAPI サーバーのベース URL")
    parser.add_argument("--username", help="API ログイン用ユーザー名")
    parser.add_argument("--password", help="API ログイン用パスワード")
    parser.add_argument("--year", type=int, required=True, help="対象年 (例: 2025)")
    parser.add_argument("--month", type=int, required=True, help="対象月 (1-12)")
    parser.add_argument(
        "--scope-id", default="hospital/pharmacy", help="許可された施設／部署"
    )
    parser.add_argument("--output-dir", default="export", help="出力ディレクトリ")
    parser.add_argument(
        "--generate",
        action="store_true",
        help="先に /schedules/generate を実行して最新結果を取得する",
    )
    parser.add_argument(
        "--finalize",
        action="store_true",
        help="--generate と併用。trial_mode=False で確定保存してからエクスポート",
    )
    parser.add_argument(
        "--template-mode",
        choices=["long", "wide", "both"],
        default="both",
        help="CSV 出力形式 (long=1行1割当, wide=病棟別カラム, both=両方保存)",
    )
    parser.add_argument(
        "--timeout", type=float, default=30.0, help="HTTP タイムアウト(秒)"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    trial_mode = not args.finalize
    base_url = (
        args.base_url
        or get_secret("EXPORTER_BASE_URL")
        or get_secret("NEXT_PUBLIC_API_BASE_URL")
        or "http://127.0.0.1:8000"
    )
    username = args.username or get_secret("EXPORTER_USERNAME") or "admin"
    password = args.password or get_secret("EXPORTER_PASSWORD") or "pass-admin"

    options = ExportOptions(
        base_url=base_url,
        username=username,
        password=password,
        year=args.year,
        month=args.month,
        output_dir=output_dir,
        scope_id=args.scope_id,
        generate=args.generate or args.finalize,
        trial_mode=trial_mode,
        timeout=args.timeout,
        template_mode=args.template_mode,
    )

    try:
        result = export_schedule(options)
    except ExporterError as exc:
        print(f"[export_schedule] 失敗: {exc}", file=sys.stderr)
        return 1

    mode_label = "trial" if result.trial_mode else "final"
    print("=== Export completed ===")
    print(f"Mode           : {mode_label}")
    print(f"Assignments    : {result.total_assignments}")
    print(f"Warnings       : {result.total_warnings}")
    print(f"JSON output    : {result.json_path}")
    if result.csv_long_path:
        print(f"CSV (long)     : {result.csv_long_path}")
    if result.csv_wide_path:
        print(f"CSV (template) : {result.csv_wide_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
