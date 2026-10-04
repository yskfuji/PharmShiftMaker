"""Owned local containers/processes only. No real data; no overwriting evidence.

Separate PostgreSQL authority + real HTTP + source PostgreSQL transaction.
This is a control-protocol fault trial, NOT the complete 25-month acceptance.
"""

import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from scripts.control_reconcile import reconcile
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.transaction import stage_control
from shift_scheduler.db.compliance_models import ControlCommit, PrivacyCase
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash


def run(output, app_url):
    if "pharmshift_audit" not in app_url:
        raise ValueError("Only an explicitly isolated audit application DB is allowed")
    output.mkdir(parents=True, exist_ok=False)
    container = "pharmshift-control-trial-" + uuid4().hex[:10]
    schema = "control_trial_" + uuid4().hex
    engine = scoped = process = None
    events = []

    def record(name, **detail):
        events.append({"name": name, "monotonic": time.monotonic(), **detail})
        with (output / "events.jsonl").open("a") as stream:
            stream.write(json.dumps(events[-1], ensure_ascii=False) + "\n")

    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True).strip()

    def blocked(client, label):
        try:
            client.require_access()
        except RestoreUnavailable:
            record(label, blocked=True)
        else:
            raise AssertionError(label + ": unexpectedly allowed")

    try:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            pg_port = sock.getsockname()[1]
        docker(
            "run",
            "-d",
            "--name",
            container,
            "--label",
            "pharmshift.synthetic-audit=true",
            "-e",
            "POSTGRES_USER=audit",
            "-e",
            "POSTGRES_PASSWORD=isolated-control-test",
            "-e",
            "POSTGRES_DB=pharmshift_control_audit",
            "-p",
            f"127.0.0.1:{pg_port}:5432",
            "postgres:16",
        )
        port = docker("port", container, "5432/tcp").rsplit(":", 1)[1]
        for _ in range(120):
            if (
                subprocess.run(
                    ["docker", "exec", container, "pg_isready", "-U", "audit"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ).returncode
                == 0
            ):
                break
            time.sleep(0.25)
        else:
            raise TimeoutError("Owned authority database failed to start")
        key = Ed25519PrivateKey.generate()
        credentials = {
            r: {"role": r, "token": secrets.token_hex(32)}
            for r in ("source", "operator", "restore")
        }
        control_url = f"postgresql+psycopg://audit:isolated-control-test@127.0.0.1:{port}/pharmshift_control_audit"
        env = {
            **os.environ,
            "PHARMSHIFT_ENV": "development",
            "PHARMSHIFT_AUTHORITY_DB_URL": control_url,
            "PHARMSHIFT_AUTHORITY_PRIVATE_KEY": key.private_bytes_raw().hex(),
            "PHARMSHIFT_AUTHORITY_CREDENTIALS": json.dumps(credentials),
        }
        log = (output / "authority.log").open("w")
        subprocess.run(
            [sys.executable, "-m", "scripts.control_authority"],
            env=env,
            stdout=log,
            stderr=log,
            check=True,
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            http_port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{http_port}"

        def start():
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "scripts.control_authority:build_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(http_port),
                ],
                env=env,
                stdout=log,
                stderr=log,
            )
            for _ in range(100):
                try:
                    if httpx.get(base + "/healthz", timeout=0.5).status_code == 200:
                        return proc
                except httpx.HTTPError:
                    pass
                if proc.poll() is not None:
                    raise RuntimeError("Authority process exited")
                time.sleep(0.1)
            proc.kill()
            proc.wait()
            raise TimeoutError("Authority HTTP startup")

        process = start()
        clients = {
            r: AuthorityClient(
                base, r, c["token"], key.public_key().public_bytes_raw().hex()
            )
            for r, c in credentials.items()
        }
        source, operator, restore = (
            clients[r] for r in ("source", "operator", "restore")
        )
        for role in ("source", "restore"):
            operator.request("POST", "/nodes", {"node_id": role, "role": role})
        assert source.require_access()["generation"] == 0
        engine = create_engine(app_url)
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped_url = app_url + "?options=-csearch_path%3D" + schema
        with patch.dict(
            os.environ,
            {"DATABASE_URL": scoped_url, "SHIFT_SCHEDULER_DB_URL": scoped_url},
        ):
            command.upgrade(Config("alembic.ini"), "head")
        scoped = create_engine(scoped_url)
        factory = sessionmaker(scoped, expire_on_commit=False)
        original = source.request

        def stop_before_confirmation(method, path, body=None):
            if path.endswith("/commit"):
                process.kill()
                process.wait(timeout=10)
                record("SIGKILL_after_source_commit_before_control_confirmation")
            return original(method, path, body)

        with (
            patch(
                "shift_scheduler.control.transaction.configured_client",
                return_value=source,
            ),
            patch.dict(
                os.environ,
                {
                    "PHARMSHIFT_ERASURE_MANIFEST_KEY": "synthetic-independent-manifest-key-0000"
                },
            ),
        ):
            source.request = stop_before_confirmation
            try:
                with factory.begin() as session:
                    session.add(
                        PrivacyCase(
                            case_id="synthetic-restrict",
                            scope_id="hospital/pharmacy",
                            person_id="p0",
                            kind="restrict",
                            status="APPROVED",
                            revision=1,
                            payload={"reason": "synthetic request"},
                        )
                    )
                    stage_control(session)
            except RestoreUnavailable:
                record("source_response_failed_with_committed_receipt")
            else:
                raise AssertionError("Real disconnection was not reported")
        source.request = original
        blocked(source, "service_stopped")
        with factory() as session:
            assert session.get(PrivacyCase, "synthetic-restrict") is not None
            receipt = session.scalar(select(ControlCommit))
            assert receipt is not None
        process = start()
        blocked(source, "pending_survives_service_restart")
        blocked(restore, "pending_blocks_restore")
        assert (
            source.request("GET", "/status")["pending_operation_id"]
            == receipt.operation_id
        )
        result = reconcile(factory, source)
        assert result["generation"] == 1
        assert source.require_access()["generation"] == 1
        record(
            "source_receipt_reconciled", generation=1, receipt_hash=receipt.receipt_hash
        )
        manifest = operator.request("GET", "/manifest")
        # The former hash-only release must no longer open any target, even for
        # an authenticated operator. Measured positive cases run separately.
        release = {
            "expected_generation": 1,
            "manifest_hash": manifest["manifest_hash"],
            "verification_hash": content_hash({"synthetic": True}),
        }
        try:
            operator.request("POST", "/nodes/restore/release", release)
        except RestoreUnavailable:
            record("legacy_hash_only_release_rejected", blocked=True)
        else:
            raise AssertionError("Unmeasured legacy release was accepted")
        blocked(restore, "unmeasured_restore_remains_quarantined")
        docker("stop", "-t", "1", container)
        blocked(source, "authority_database_stopped")
        blocked(restore, "authority_database_stopped_restore_denied")
        docker("start", container)
        for _ in range(100):
            try:
                assert source.require_access()["generation"] == 1
                break
            except RestoreUnavailable:
                time.sleep(0.2)
        else:
            raise TimeoutError("Authority DB did not recover")
        operation = uuid4().hex
        source.request(
            "POST",
            "/operations/prepare",
            {
                "operation_id": operation,
                "expected_generation": 1,
                "manifest": manifest["manifest"],
            },
        )
        try:
            operator.request("POST", "/nodes/restore/release", release)
        except RestoreUnavailable:
            record("new_preparation_blocks_restore_release", blocked=True)
        else:
            raise AssertionError("Pending release accepted")
        source.request(
            "POST",
            f"/operations/{operation}/commit",
            {"manifest_hash": manifest["manifest_hash"], "receipt_hash": "f" * 64},
        )
        blocked(restore, "stale_restore_generation")
        control_engine = create_engine(control_url)
        with control_engine.connect() as connection:
            durability = {
                name: connection.scalar(text("SHOW " + name))
                for name in ("fsync", "synchronous_commit", "full_page_writes")
            }
            version = connection.scalar(text("SELECT version()"))
        control_engine.dispose()
        assert all(value == "on" for value in durability.values())
        record(
            "completed",
            postgres=version,
            image=docker("inspect", "--format={{.Image}}", container),
            durability=durability,
            limitation="Control protocol and rejection of old hash-only release; no positive restore opening in this trial; not full restore, all storage or 25-month acceptance",
        )
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        if scoped:
            scoped.dispose()
        if engine:
            with engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            engine.dispose()
        subprocess.run(
            ["docker", "rm", "-f", "-v", container],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        (output / "result.json").write_text(
            json.dumps(
                {
                    "events": events,
                    "completed": bool(events and events[-1]["name"] == "completed"),
                },
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--application-db", required=True)
    args = parser.parse_args()
    run(args.output, args.application_db)
