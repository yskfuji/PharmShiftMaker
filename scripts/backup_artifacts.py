#!/usr/bin/env python3
"""Utility for packaging config/schedule artifacts into a timestamped tarball.

This script helps the ops team satisfy Phase9 backup automation requirements by
capturing YAML configs, generated schedules, and optional directories in a
single compressed archive. The resulting tarball can be uploaded to S3/NAS or
any long-term storage.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import logging
import os
import sys
import tarfile
from collections.abc import Iterable
from pathlib import Path

from shift_scheduler.ops.archive import create_archive

DEFAULT_CONFIG_DIR = os.environ.get(
    "SHIFT_SCHEDULER_CONFIG_DIR", "src/shift_scheduler/config"
)
DEFAULT_SCHEDULE_DIR = "config/schedules"
DEFAULT_HOLIDAY_DIR = ".storage/holiday_requests"
DEFAULT_OUTPUT_DIR = "backup"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a backup tarball of configs and schedules."
    )
    parser.add_argument(
        "--config-dir",
        default=DEFAULT_CONFIG_DIR,
        help="Path to the active YAML config directory.",
    )
    parser.add_argument(
        "--schedules-dir",
        default=DEFAULT_SCHEDULE_DIR,
        help="Directory that stores confirmed schedule JSON/CSV exports.",
    )
    parser.add_argument(
        "--holiday-dir",
        default=DEFAULT_HOLIDAY_DIR,
        help="Directory that stores persisted holiday request payloads (optional).",
    )
    parser.add_argument(
        "--extra",
        action="append",
        default=[],
        help="Additional directories/files to include (can be specified multiple times).",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where the tarball will be written (created if missing).",
    )
    parser.add_argument(
        "--tag",
        default="ops-backup",
        help="Logical tag included in the filename (e.g., env name or ticket ID).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be archived without creating a tarball.",
    )
    parser.add_argument(
        "--managed-source-copy",
        action="append",
        default=[],
        help="Exact registered copy_id=sha256; repeats allowed",
    )
    parser.add_argument("--scope-id", default="hospital/pharmacy")
    parser.add_argument(
        "--operation-id", help="32-character retry-stable artifact identity"
    )
    return parser.parse_args()


def _resolve_existing(paths: Iterable[str]) -> list[Path]:
    existing: list[Path] = []
    for raw_path in paths:
        if not raw_path:
            continue
        path = Path(raw_path).expanduser().resolve()
        if path.exists():
            existing.append(path)
        else:
            raise FileNotFoundError(f"Required backup source missing: {path}")
    return existing


def _build_tar_name(tag: str) -> str:
    timestamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    sanitized = tag.replace("/", "-")
    return f"{timestamp}_{sanitized}.tar.gz"


def _add_manifest(tar: tarfile.TarFile, sources: list[Path]) -> None:
    now = dt.datetime.now(dt.UTC)
    manifest: dict[str, object] = {
        "created_at": now.isoformat(timespec="seconds"),
        "sources": [str(path) for path in sources],
    }
    payload = json.dumps(manifest, indent=2).encode("utf-8")
    info = tarfile.TarInfo(name="manifest.json")
    info.size = len(payload)
    info.mtime = now.timestamp()
    tar.addfile(info, io.BytesIO(payload))


def create_backup(args: argparse.Namespace) -> Path:
    registered = getattr(args, "managed_source_copy", [])
    if registered:
        from shift_scheduler.db.session import get_session_factory
        from shift_scheduler.ops.archive import create_managed_archive

        sources = {}
        for entry in registered:
            identity, separator, digest = entry.partition("=")
            if not separator or identity in sources:
                raise ValueError("Unique copy_id=sha256 source references required")
            sources[identity] = digest
        if not getattr(args, "operation_id", None):
            raise ValueError(
                "Managed backup requires a stable --operation-id for resume"
            )
        if args.dry_run:
            return Path("dry-run")
        return create_managed_archive(
            get_session_factory(), args.scope_id, sources, args.operation_id
        )
    sources = _resolve_existing(
        [args.config_dir, args.schedules_dir, args.holiday_dir, *args.extra]
    )
    if not sources:
        raise FileNotFoundError(
            "No valid sources to archive. Double-check the provided directories."
        )

    if args.dry_run:
        for src in sources:
            print(f"[dry-run] would archive: {src}")
        return Path("dry-run")

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    tar_name = _build_tar_name(args.tag)
    tar_path = output_dir / tar_name

    create_archive(sources, tar_path)

    logging.info("Backup created: %s", tar_path)
    return tar_path


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    try:
        result = create_backup(args)
        if args.dry_run:
            logging.info("Dry-run completed")
        else:
            print(result)
        return 0
    except Exception as exc:  # noqa: BLE001
        logging.error("Backup failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
