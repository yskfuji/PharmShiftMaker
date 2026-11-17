#!/usr/bin/env python3
"""Local test-only pg_dump/pg_restore bridge to the dedicated PostgreSQL container.

No application data or production credentials are accepted. Files stay on the host;
the container receives a stream over docker exec, without network upload.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def main():
    database = os.environ.get("PGDATABASE", "")
    container = os.environ.get(
        "PHARMSHIFT_AUDIT_PG_CONTAINER", "pharmshift-remediation-20260922-db-1"
    )
    port = os.environ.get("PGPORT")
    if container != "pharmshift-remediation-20260922-db-1":
        if not container.startswith("pharmshift-storage-closure-"):
            raise RuntimeError(
                "Only an owned storage-closure audit container is allowed"
            )
        inspected = json.loads(
            subprocess.check_output(["docker", "inspect", container], text=True)
        )[0]
        ports = inspected["NetworkSettings"]["Ports"].get("5432/tcp", [])
        if inspected["Config"].get("Labels", {}).get(
            "pharmshift.synthetic-audit"
        ) != "true" or not any(
            p["HostIp"] == "127.0.0.1" and p["HostPort"] == port for p in ports
        ):
            raise RuntimeError("Audit container ownership or loopback binding mismatch")
    elif port != "55441":
        raise RuntimeError("Dedicated remediation port required")
    arguments = sys.argv[1:]
    restore_database = bool(
        re.fullmatch(r"pharmshift_audit_restore_[a-f0-9]{32}", database)
    )
    source_schema = next(
        (a.removeprefix("--schema=") for a in arguments if a.startswith("--schema=")),
        None,
    )
    scoped_native_dump = (
        database == "pharmshift_audit_full_20260923"
        and container == "pharmshift-storage-closure-20260923-r1"
        and port == "55443"
        and source_schema is not None
        and re.fullmatch(r'"audit_[a-f0-9]{32}"', source_schema)
        and "--format=custom" in arguments
        and "--strict-names" in arguments
    )
    if not restore_database and not scoped_native_dump:
        raise RuntimeError(
            "Only owned UUID restore databases or the explicit UUID-schema audit dump are allowed"
        )
    user = os.getenv("PGUSER", "audit")
    if user not in {"audit", "audit_full_20260923"} or os.getenv("PGHOST") not in {
        "127.0.0.1",
        "localhost",
    }:
        raise RuntimeError("Only owned audit identities over loopback are allowed")
    if (
        "--dbname" in arguments
        and arguments[arguments.index("--dbname") + 1] != database
    ):
        raise RuntimeError("Native argument/database mismatch")
    # No caller-supplied native connection/role override can escape the inspected
    # local server. Only the three command forms produced by this repository are
    # accepted, with no generic pg_dump/pg_restore passthrough.
    if "--file" in arguments:
        at = arguments.index("--file")
        sanitized = arguments[:at] + arguments[at + 2 :]
        if sanitized != [
            "--format",
            "custom",
            "--no-owner",
            "--no-privileges",
            "--exclude-schema=pharmshift_restore_control",
        ]:
            raise RuntimeError("Unexpected audit file-dump arguments")
    elif "--format=custom" in arguments:
        fixed = {"--format=custom", "--no-owner", "--no-privileges", "--strict-names"}
        variable = [a for a in arguments if a not in fixed]
        if (
            len(arguments) != 6
            or len(variable) != 2
            or not any(a.startswith("--schema=") for a in variable)
            or not any(re.fullmatch(r"--snapshot=[A-Fa-f0-9-]+", a) for a in variable)
        ):
            raise RuntimeError("Unexpected audit stdout-dump arguments")
    elif len(arguments) != 7 or arguments[:5] != [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        "--dbname",
    ]:
        raise RuntimeError("Unexpected audit restore arguments")
    base = [
        "docker",
        "exec",
        "-i",
        "-e",
        "PGUSER=" + user,
        "-e",
        "PGDATABASE=" + database,
        container,
    ]
    if "--file" in arguments:
        index = arguments.index("--file")
        output = Path(arguments[index + 1])
        args = arguments[:index] + arguments[index + 2 :]
        with output.open("xb") as stream:
            subprocess.run([*base, "pg_dump", *args], stdout=stream, check=True)
    elif "--format=custom" in arguments:
        # Registered managed_writer owns stdout/staging; no extra artifact here.
        subprocess.run([*base, "pg_dump", *arguments], check=True)
    else:
        source = Path(arguments[-1])
        with source.open("rb") as stream:
            subprocess.run(
                [*base, "pg_restore", *arguments[:-1]], stdin=stream, check=True
            )


if __name__ == "__main__":
    main()
