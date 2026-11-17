"""Disposable PostgreSQL restore drill; refuses containers without audit ownership label."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from tests.fixtures.reviewed_planning import reviewed_planning_snapshot as snapshot
from tests.test_planning_lifecycle import publish


def main():
    container = "pharmshift-audit-20260921"
    info = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    if info["Config"].get("Labels", {}).get("pharmshift.audit") != "20260921":
        raise RuntimeError("Refusing non-audit container")
    raw_url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    url = make_url(raw_url)
    if url.database != "pharmshift_audit":
        raise RuntimeError("Refusing non-audit database")
    schema = "audit_" + uuid4().hex
    target = "pharmshift_audit_restore_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    source = create_engine(
        url.update_query_dict({"options": "-csearch_path=" + schema})
    )
    restored = create_engine(
        url.set(database=target).update_query_dict(
            {"options": "-csearch_path=" + schema}
        )
    )
    with admin.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'CREATE DATABASE "{target}"'))
    try:
        source_url = source.url.render_as_string(hide_password=False)
        os.environ.update(DATABASE_URL=source_url, SHIFT_SCHEDULER_DB_URL=source_url)
        command.upgrade(Config("alembic.ini"), "head")
        with sessionmaker(source).begin() as session:
            publish(session, snapshot(2, 2))
        last_commit = datetime.now(UTC)
        started = time.perf_counter()
        dump = subprocess.check_output(
            [
                "docker",
                "exec",
                container,
                "pg_dump",
                "-U",
                "audit",
                "-d",
                "pharmshift_audit",
                "--schema",
                schema,
                "--format=custom",
                "--no-owner",
                "--no-privileges",
            ]
        )
        backup_time = datetime.now(UTC)
        subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                container,
                "pg_restore",
                "-U",
                "audit",
                "-d",
                target,
                "--no-owner",
                "--no-privileges",
                "--exit-on-error",
                "--single-transaction",
            ],
            input=dump,
            check=True,
        )
        tables = inspect(source).get_table_names(schema=schema)
        comparison = {}
        for table in tables:
            statement = text(
                f'SELECT to_jsonb(t)::text FROM "{schema}"."{table}" t ORDER BY to_jsonb(t)::text'
            )
            with source.connect() as connection:
                before = list(connection.scalars(statement))
            with restored.connect() as connection:
                after = list(connection.scalars(statement))
            if before != after:
                raise AssertionError(f"Restore mismatch: {table}")
            comparison[table] = {
                "rows": len(before),
                "sha256": hashlib.sha256(json.dumps(before).encode()).hexdigest(),
            }
        report = {
            "kind": "isolated_synthetic_restore",
            "database": "PostgreSQL 16",
            "tables": comparison,
            "dump_bytes": len(dump),
            "dump_sha256": hashlib.sha256(dump).hexdigest(),
            "backup_to_verified_restore_seconds": time.perf_counter() - started,
            "synthetic_recovery_point_age_seconds": (
                backup_time - last_commit
            ).total_seconds(),
            "production_rpo_rto_acceptance": "UNVERIFIED: representative data, offsite media, IdP and human drill required",
        }
        Path("audit/implementation-2026-09-21/restore.json").write_text(
            json.dumps(report, indent=2)
        )
        print(json.dumps(report, indent=2))
    finally:
        source.dispose()
        restored.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{target}"'))
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    main()
