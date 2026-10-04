#!/usr/bin/env python3
"""High-level backup/restore orchestration for configs + schedules + PostgreSQL.

This script wraps the existing ``backup_artifacts`` helper and adds PostgreSQL
``pg_dump`` / ``pg_restore`` support so SRE can automate README §5 / Ops §5
requirements end-to-end. Typical usage:

- Nightly backup (both files + DB):
    python scripts/backup_pipeline.py backup --tag prod-nightly
- Restore configs from a tarball and DB from a dump:
    python scripts/backup_pipeline.py restore --tarball backup/20250101_ops.tar.gz \
        --expect-archive-id <archive_id printed at backup> \
        --target-dir /tmp/restore --dump-file backup/20250101_db.pgdump \
        --db-url postgresql://user:pass@db/pharmshift
  The backup summary prints the archive ID and SHA-256 to record; production
  restores require --expect-archive-id or --expect-sha256.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from scripts import backup_artifacts
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from shift_scheduler.db.settings import DatabaseSettings
from shift_scheduler.ops.archive import archive_identity, restore_archive

DEFAULT_OUTPUT_DIR = Path("backup")
DEFAULT_PG_DUMP = os.environ.get("PG_DUMP", "pg_dump")
DEFAULT_PG_RESTORE = os.environ.get("PG_RESTORE", "pg_restore")


def _normalize_db_url(raw: str) -> str:
    if "+" in raw.split("://", 1)[0]:
        scheme, rest = raw.split("://", 1)
        scheme = scheme.split("+", 1)[0]
        return f"{scheme}://{rest}"
    return raw


def _timestamp() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def run_pg_dump(
    db_url: str,
    output_dir: Path,
    tag: str,
    pg_dump: str,
    *,
    factory=None,
    scope=None,
    operation_id=None,
) -> Path:
    if (
        factory is not None
        or os.getenv("PHARMSHIFT_ENV") == "production"
        or os.getenv("PHARMSHIFT_CONTROL_URL")
    ):
        if factory is None:
            from shift_scheduler.db.session import get_session_factory

            factory = get_session_factory()
        return run_managed_pg_dump(factory, db_url, scope, operation_id, pg_dump)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tag):
        raise ValueError("Backup tag must be a bounded filename component")
    output_dir.mkdir(parents=True, exist_ok=True)
    dump_path = output_dir / f"{_timestamp()}_{tag}_{uuid4().hex}.pgdump"
    cmd: list[str] = [
        pg_dump,
        "--format",
        "custom",
        "--file",
        str(dump_path),
        "--no-owner",
        "--no-privileges",
        "--exclude-schema=pharmshift_restore_control",
    ]
    with pg_environment(db_url) as env:
        subprocess.run(cmd, check=True, env=env)
    dump_path.chmod(0o600)
    return dump_path


def run_pg_restore(db_url: str, dump_file: Path, pg_restore: str) -> None:
    from shift_scheduler.control.client import configured_client

    authority = configured_client()
    if authority:
        target_node = os.getenv("PHARMSHIFT_RESTORE_NODE")
        if not target_node:
            raise ValueError(
                "PHARMSHIFT_RESTORE_NODE is required before any restored bytes"
            )
        authority.request("POST", f"/nodes/{target_node}/quarantine")
    url = make_url(db_url)
    if not url.database or not any(
        label in url.database for label in ("restore", "audit")
    ):
        raise ValueError(
            "Restore requires an explicitly named isolated restore/audit database"
        )
    # Hold an exclusive advisory lock across the entire restore and quarantine.
    # Every normal application transaction takes the corresponding shared lock.
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.db.restore_lock import RESTORE_LOCK
    from shift_scheduler.ops.erasure_replay import quarantine

    engine = create_engine(url.set(drivername="postgresql+psycopg"))
    try:
        with engine.connect() as guard:
            acquired = guard.scalar(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": RESTORE_LOCK}
            )
            if not acquired:
                raise ValueError(
                    "Active application transactions prevent isolated restore"
                )
            try:
                count = guard.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
                    )
                )
                if count:
                    raise ValueError(
                        "Restore target must be empty; destructive in-place restore is disabled"
                    )
                guard.execute(text("CREATE SCHEMA pharmshift_restore_control"))
                guard.execute(
                    text(
                        "CREATE TABLE pharmshift_restore_control.gate (state text NOT NULL)"
                    )
                )
                guard.execute(
                    text(
                        "INSERT INTO pharmshift_restore_control.gate VALUES ('QUARANTINED')"
                    )
                )
                guard.commit()  # independent durable gate survives a failed restore
                cmd = [
                    pg_restore,
                    "--exit-on-error",
                    "--single-transaction",
                    "--no-owner",
                    "--no-privileges",
                    "--dbname",
                    url.database,
                    str(dump_file),
                ]
                with pg_environment(db_url) as env:
                    subprocess.run(cmd, check=True, env=env)
                with sessionmaker(engine).begin() as session:
                    quarantine(session)
            finally:
                guard.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": RESTORE_LOCK}
                )
    finally:
        engine.dispose()


@contextmanager
def pg_environment(db_url: str):
    """Keep database credentials out of argv, exceptions and process titles."""
    url = make_url(db_url)
    if url.get_backend_name() != "postgresql":
        raise ValueError("This backup path requires PostgreSQL")
    env = os.environ.copy()
    env.pop("PGPASSWORD", None)
    env.update(
        PGHOST=url.host or "localhost",
        PGPORT=str(url.port or 5432),
        PGDATABASE=url.database or "",
        PGUSER=url.username or "",
    )
    # libpq honours TLS verification settings from the authoritative URL.
    for key in ("sslmode", "sslrootcert", "sslcert", "sslkey"):
        if key in url.query:
            env["PG" + key.upper()] = str(url.query[key])
    with tempfile.TemporaryDirectory(prefix="pharmshift-pgpass-") as directory:
        password_file = Path(directory) / "pgpass"

        def escape(value):
            return str(value).replace("\\", "\\\\").replace(":", "\\:")

        password_file.write_text(
            ":".join(
                escape(value)
                for value in (
                    env["PGHOST"],
                    env["PGPORT"],
                    env["PGDATABASE"],
                    env["PGUSER"],
                    url.password or "",
                )
            )
            + "\n"
        )
        password_file.chmod(0o600)
        env["PGPASSFILE"] = str(password_file)
        yield env


def extract_tarball(
    tarball: Path, target_dir: Path, expected: dict[str, str | None] | None = None
) -> None:
    restore_archive(tarball, target_dir, expected=expected)


def backup_command(args: argparse.Namespace) -> None:
    file_tarball = backup_artifacts.create_backup(args)
    db_dump_path: Path | None = None
    db_url = args.db_url or DatabaseSettings.from_environment().url
    if args.dry_run:
        print("[backup_pipeline] dry-run: skipping pg_dump")
    elif db_url:
        db_dump_path = run_pg_dump(
            db_url,
            args.output_dir,
            args.tag,
            args.pg_dump,
            scope=getattr(args, "scope_id", None),
            operation_id=getattr(args, "database_operation_id", None),
        )

    print("=== Backup summary ===")
    print(f"Files archive : {file_tarball}")
    if file_tarball and Path(file_tarball).exists():
        identity = archive_identity(Path(file_tarball))
        # Record both: restore compares them so an older archive is not substituted.
        print(f"Archive ID    : {identity.get('archive_id', '(format 1: none)')}")
        print(f"Archive SHA-256: {identity['sha256']}")
    if db_dump_path:
        print(f"PostgreSQL dump: {db_dump_path}")
    else:
        print("PostgreSQL dump: skipped")


def restore_command(args: argparse.Namespace) -> None:
    if not args.tarball and not args.dump_file:
        raise SystemExit("tarball or dump-file must be supplied for restore")
    db_url = args.db_url or os.environ.get("RESTORE_DATABASE_URL")
    if args.dump_file and not db_url:
        raise SystemExit("--db-url is required when --dump-file is provided")
    if args.tarball and Path(args.target_dir).exists():
        raise ValueError("Restore files require a new isolated directory")
    from shift_scheduler.control.client import configured_client

    authority = configured_client()
    if authority:
        target_node = os.getenv("PHARMSHIFT_RESTORE_NODE")
        if not target_node:
            raise ValueError(
                "An independent restore node is required before any restored bytes"
            )
        authority.request("POST", f"/nodes/{target_node}/quarantine")
    # The database's durable quarantine and empty-target checks precede file
    # extraction too. Neither path authorizes service release on its own.
    if args.dump_file and db_url:
        run_pg_restore(db_url, Path(args.dump_file), args.pg_restore)
        print("PostgreSQL restore completed")
    if args.tarball:
        expected = {
            field: value
            for field, value in (
                ("archive_id", getattr(args, "expect_archive_id", None)),
                ("sha256", getattr(args, "expect_sha256", None)),
                ("scope", getattr(args, "expect_scope", None)),
            )
            if value is not None
        }
        extract_tarball(Path(args.tarball), Path(args.target_dir), expected)
        print(f"Restored configs to {args.target_dir}; access remains quarantined")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backup/restore orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)

    backup_parser = sub.add_parser("backup", help="Create archives + pg_dump")
    backup_parser.add_argument(
        "--config-dir", default=backup_artifacts.DEFAULT_CONFIG_DIR
    )
    backup_parser.add_argument(
        "--schedules-dir", default=backup_artifacts.DEFAULT_SCHEDULE_DIR
    )
    backup_parser.add_argument(
        "--holiday-dir", default=backup_artifacts.DEFAULT_HOLIDAY_DIR
    )
    backup_parser.add_argument("--extra", action="append", default=[])
    backup_parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    backup_parser.add_argument("--tag", default="ops-backup")
    backup_parser.add_argument("--dry-run", action="store_true")
    backup_parser.add_argument("--db-url", default=None)
    backup_parser.add_argument("--pg-dump", default=DEFAULT_PG_DUMP)
    backup_parser.add_argument("--managed-source-copy", action="append", default=[])
    backup_parser.add_argument("--scope-id", default=None)
    backup_parser.add_argument(
        "--operation-id", help="Managed file archive retry identity"
    )
    backup_parser.add_argument(
        "--database-operation-id",
        help="Independent managed database dump retry identity",
    )
    backup_parser.set_defaults(func=backup_command)

    restore_parser = sub.add_parser(
        "restore", help="Extract archives and pg_restore DB"
    )
    restore_parser.add_argument("--tarball", help="Path to tar.gz produced by backup")
    restore_parser.add_argument("--target-dir", default="restore_output")
    restore_parser.add_argument("--dump-file", help="Path to pg_dump custom file")
    restore_parser.add_argument("--db-url", default=None)
    restore_parser.add_argument("--pg-restore", default=DEFAULT_PG_RESTORE)
    restore_parser.add_argument(
        "--expect-archive-id", help="Archive ID recorded at backup time"
    )
    restore_parser.add_argument(
        "--expect-sha256", help="Archive SHA-256 recorded at backup time"
    )
    restore_parser.add_argument(
        "--expect-scope", help="Scope the archive must belong to"
    )
    restore_parser.set_defaults(func=restore_command)

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        args.func(args)
        return 0
    except FileNotFoundError as exc:
        print(f"[backup_pipeline] missing file: {exc}", file=sys.stderr)
    except subprocess.CalledProcessError as exc:
        print(f"[backup_pipeline] command failed: {exc}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"[backup_pipeline] error: {exc}", file=sys.stderr)
    return 1


def run_managed_pg_dump(factory, db_url, scope, operation_id, pg_dump):
    """Capture one authoritative PostgreSQL schema at an exported snapshot.

    The snapshot remains open until native pg_dump exits. No password enters
    argv and no unregistered dump file is produced. This function does not claim
    that separately backed-up files share the database's consistency point.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from shift_scheduler.application.planning import Conflict
    from shift_scheduler.control.client import require_access
    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.domain.planning import content_hash
    from shift_scheduler.ops import managed_writer

    require_access()
    bind = factory.kw.get("bind")
    if not bind or bind.dialect.name != "postgresql" or make_url(db_url) != bind.url:
        raise ValueError(
            "Native dump must use the exact authoritative database configuration"
        )
    if not scope or "/" not in scope or not operation_id:
        raise ValueError("Scoped backup and a retry-stable operation ID are required")
    # An existing complete/ready capture resumes its registered snapshot output,
    # without exporting a new snapshot under the old operation identity.
    with factory() as session:
        existing = session.get(ManagedCopy, operation_id)
        if existing:
            if (
                existing.scope_id != scope
                or existing.locator.get("route") != "backup.database"
            ):
                raise Conflict("Backup identity belongs to a different operation")
            if not existing.evidence.get("hash_pending"):
                return managed_writer.capture(
                    factory,
                    scope,
                    operation_id,
                    lambda _stream: (_ for _ in ()).throw(
                        Conflict("Committed backup must not be regenerated")
                    ),
                )
            raise Conflict(
                "Interrupted uncommitted database snapshot cannot be recreated; use a new operation ID"
            )
    with (
        bind.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as connection,
        connection.begin(),
    ):
        connection.execute(text("SET TRANSACTION READ ONLY"))
        schema = connection.scalar(text("SELECT current_schema()"))
        if not schema or schema.startswith("pg_") or schema == "information_schema":
            raise ValueError("Explicit application schema required")
        snapshot_id = connection.scalar(text("SELECT pg_export_snapshot()"))
        consistent_at = connection.scalar(text("SELECT transaction_timestamp()"))
        wal_position = connection.scalar(text("SELECT pg_current_wal_lsn()::text"))
        with Session(bind=connection) as observed:
            rows = list(observed.scalars(select(ManagedCopy)))
            prefix = scope.split("/")[0] + "/"
            if any(
                r.scope_id != "__unclassified__" and not r.scope_id.startswith(prefix)
                for r in rows
            ):
                raise Conflict(
                    "Schema contains another facility; scope-separated backup is required"
                )
            sources = {
                r.copy_id: r.content_hash
                for r in rows
                if r.medium == "database"
                and r.state == "PRESENT"
                and not r.locator.get("retained_control")
            }
            if not sources:
                raise ValueError(
                    "No registered authoritative database records; inventory before backup"
                )
        managed_writer.reserve_capture(
            factory, scope, operation_id, "backup.database", sources
        )
        with factory.begin() as session:
            row = session.get(ManagedCopy, operation_id, with_for_update=True)
            row.evidence = {
                **row.evidence,
                "database_snapshot": {
                    "schema": schema,
                    "snapshot_id": snapshot_id,
                    "consistent_at": consistent_at.isoformat(),
                    "wal_position": wal_position,
                    "source_set_hash": content_hash(sources),
                    "file_consistency_proven": False,
                    "control_records_retained": True,
                },
            }

        def native_dump(stream):
            command = [
                pg_dump,
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                "--strict-names",
                '--schema="' + schema.replace('"', '""') + '"',
                "--snapshot=" + snapshot_id,
            ]
            with pg_environment(db_url) as environment:
                subprocess.run(command, check=True, env=environment, stdout=stream)

        return managed_writer.capture(factory, scope, operation_id, native_dump)


if __name__ == "__main__":
    sys.exit(main())
