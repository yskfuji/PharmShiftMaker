"""Read-only complete schema observations and narrowly classified restore checks."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError


def _normal(value):
    if isinstance(value, dict):
        return {str(k): _normal(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normal(v) for v in value]
    if isinstance(value, (datetime, date, time)):
        return {"type": type(value).__name__, "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"type": "decimal", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"type": "bytes", "value": base64.b64encode(bytes(value)).decode()}
    if isinstance(value, UUID):
        return {"type": "uuid", "value": str(value)}
    if value is None or isinstance(value, (str, int, bool, float)):
        return value
    raise TypeError("Unregistered database value type: " + type(value).__name__)


def _encoded(value):
    return json.dumps(
        _normal(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def _digest(value):
    return hashlib.sha256(_encoded(value)).hexdigest()


def snapshot_database(factory):
    """Observe every actual base table and its schema in ONE read-only snapshot.

    No ORM table allowlist; unknown application tables are included. Schema is
    intentionally omitted from logical identity so a separately named restored
    schema can be compared. Cross-schema FK targets remain explicit.
    """
    engine = factory.kw["bind"]
    if engine.dialect.name != "postgresql":
        raise ValueError("Real PostgreSQL required")
    tables = {}
    with (
        engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn,
        conn.begin(),
    ):
        conn.execute(text("SET TRANSACTION READ ONLY"))
        schema = conn.scalar(text("SELECT current_schema()"))
        inspector = inspect(conn)
        names = sorted(inspector.get_table_names(schema=schema))
        quote = conn.dialect.identifier_preparer.quote
        for name in names:
            columns = inspector.get_columns(name, schema=schema)
            normalized_columns = [{**c, "type": str(c["type"])} for c in columns]
            fks = inspector.get_foreign_keys(name, schema=schema)
            for fk in fks:
                if fk.get("referred_schema") == schema:
                    fk["referred_schema"] = "<current>"
            definition = {
                "columns": normalized_columns,
                "primary_key": inspector.get_pk_constraint(name, schema=schema),
                "unique": sorted(
                    inspector.get_unique_constraints(name, schema=schema),
                    key=lambda v: v.get("name") or "",
                ),
                "checks": sorted(
                    inspector.get_check_constraints(name, schema=schema),
                    key=lambda v: v.get("name") or "",
                ),
                "foreign_keys": sorted(fks, key=lambda v: v.get("name") or ""),
                "indexes": sorted(
                    inspector.get_indexes(name, schema=schema),
                    key=lambda v: v.get("name") or "",
                ),
            }
            rows = conn.execute(
                text(f"SELECT * FROM {quote(schema)}.{quote(name)}")
            ).mappings()
            row_hashes = sorted(
                hashlib.sha256(_encoded(dict(row))).hexdigest() for row in rows
            )
            tables[name] = {
                "row_count": len(row_hashes),
                "rows_sha256": _digest(row_hashes),
                "schema_sha256": _digest(definition),
                "definition": _normal(definition),
            }
        return {
            "tables": tables,
            "table_count": len(tables),
            "sha256": _digest(tables),
            "observation": "repeatable_read_read_only_all_actual_base_tables",
            "excluded": [
                "sequence current values",
                "views",
                "roles and grants",
                "WAL bytes",
            ],
        }


def is_explicit_hba_rejection(error):
    """Do not classify timeout, wrong password, or arbitrary exception as isolation."""
    if not isinstance(error, OperationalError):
        return False
    original = error.orig
    code = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    # libpq connect failures can lack SQLSTATE; require the server's exact HBA wording.
    message = str(original).lower()
    return code in (None, "28000") and (
        "pg_hba.conf rejects connection for host" in message
        or "no pg_hba.conf entry for host" in message
    )


def durable_copy(source, destination, expected_sha256):
    """Create new exact file only, reject symlinks/collision and sync file+directory."""
    source, destination = Path(source), Path(destination)
    if len(expected_sha256) != 64 or any(
        c not in "0123456789abcdef" for c in expected_sha256
    ):
        raise ValueError("Expected SHA256 required")
    if not destination.parent.is_dir() or destination.parent.is_symlink():
        raise ValueError("Unverified destination directory")
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    target_fd = None
    try:
        if not stat.S_ISREG(os.fstat(source_fd).st_mode):
            raise ValueError("Source is not a regular file")
        with os.fdopen(source_fd, "rb", closefd=False) as stream:
            raw = stream.read()
        if hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise ValueError("Independent artifact hash mismatch")
        target_fd = os.open(
            destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(target_fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(target_fd)
        directory = os.open(
            destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if target_fd is not None:
            os.close(target_fd)
        os.close(source_fd)
    return {"sha256": expected_sha256, "size": len(raw)}
