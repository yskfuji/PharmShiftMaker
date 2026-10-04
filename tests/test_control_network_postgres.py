"""Opt-in actual TCP ACK loss with independent PostgreSQL/control processes.

No MockTransport is used. The local proxy drops an already-received HTTP reply,
so the upstream commit has happened while the downstream caller sees EOF.
This is not a physical power-loss or complete-restore acceptance test.
"""

import json
import os
import secrets
import socket
import socketserver
import subprocess
import sys
import time
from pathlib import Path
from threading import Lock, Thread
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.service import ControlBase, Head, Node, Operation
from shift_scheduler.control.witness import (
    Checkpoint,
    IntentResolution,
    WitnessBase,
    authority_digest,
)
from shift_scheduler.db.compliance_models import ControlCommit
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class AckLossProxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, target):
        self.target = target
        self.drop = None
        self.events = []
        self.guard = Lock()
        super().__init__(("127.0.0.1", 0), AckHandler)

    def arm(self, prefix):
        with self.guard:
            assert self.drop is None
            self.drop = prefix


class AckHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        request = self.read_message(self.request)
        if not request:
            return
        first = request.split(b"\r\n", 1)[0].decode("ascii")
        with socket.create_connection(self.server.target, timeout=10) as upstream:
            upstream.sendall(request)
            response = self.read_message(upstream)
        with self.server.guard:
            matched = self.server.drop and first.startswith(self.server.drop)
            if matched:
                self.server.drop = None
                self.server.events.append(
                    {
                        "request": first,
                        "upstream_status": response.split(b"\r\n", 1)[0].decode(
                            "ascii"
                        ),
                        "upstream_bytes": len(response),
                        "downstream_bytes": 0,
                    }
                )
        if not matched:
            self.request.sendall(response)
        # Actual socket close discards the acknowledged upstream response.

    @staticmethod
    def read_message(sock):
        data = b""
        while b"\r\n\r\n" not in data:
            part = sock.recv(65536)
            if not part:
                return data
            data += part
        header, body = data.split(b"\r\n\r\n", 1)
        headers = {
            k.strip().lower(): v.strip()
            for k, v in (
                line.split(b":", 1)
                for line in header.split(b"\r\n")[1:]
                if b":" in line
            )
        }
        size = int(headers.get(b"content-length", b"0"))
        if headers.get(b"transfer-encoding"):
            raise AssertionError(
                "This bounded JSON fault harness requires Content-Length"
            )
        while len(body) < size:
            part = sock.recv(min(65536, size - len(body)))
            if not part:
                raise EOFError("Partial upstream message")
            body += part
        return header + b"\r\n\r\n" + body


def test_actual_three_db_http_ack_loss_recovery_writer_fencing_and_signing_key_rotation(
    tmp_path,
):
    if os.getenv("PHARMSHIFT_TEST_NETWORK_FAULTS") != "1":
        pytest.skip("Explicit owned Docker/network fault test opt-in required")
    containers, processes, engines, streams = [], [], [], []
    proof = {
        "scope": "Actual HTTP response loss and PostgreSQL commits; not complete restore, host crash or physical media erasure",
        "checks": [],
        "separate_database_servers": 3,
    }
    proxy = None

    def record(name, **facts):
        proof["checks"].append({"name": name, **facts})

    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True).strip()

    def database(kind):
        name = "pharmshift-control-network-" + kind + "-" + uuid4().hex[:8]
        containers.append(name)
        port = free_port()
        password = secrets.token_hex(24)
        docker(
            "run",
            "-d",
            "--name",
            name,
            "--label",
            "pharmshift.synthetic-audit=true",
            "-e",
            "POSTGRES_USER=audit",
            "-e",
            "POSTGRES_PASSWORD=" + password,
            "-e",
            "POSTGRES_DB=pharmshift_" + kind,
            "-p",
            f"127.0.0.1:{port}:5432",
            "postgres:16",
        )
        for _ in range(120):
            if (
                subprocess.run(
                    ["docker", "exec", name, "pg_isready", "-U", "audit"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ).returncode
                == 0
            ):
                break
            time.sleep(0.1)
        else:
            raise TimeoutError("Owned database startup")
        url = (
            f"postgresql+psycopg://audit:{password}@127.0.0.1:{port}/pharmshift_{kind}"
        )
        engine = create_engine(url)
        engines.append(engine)
        # Image bootstrap briefly exposes its Unix socket before the final TCP
        # server exists. Readiness is the exact application TCP/DB/credential.
        for _ in range(150):
            try:
                with engine.connect() as connection:
                    assert connection.scalar(text("SELECT 1")) == 1
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise TimeoutError("Owned PostgreSQL TCP/database readiness failed")
        return url, engine, sessionmaker(engine)

    def server(module, environment, port, label):
        log = (tmp_path / (label + "-" + uuid4().hex + ".log")).open("x")
        streams.append(log)
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                module,
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            env=environment,
            stdout=log,
            stderr=log,
        )
        processes.append(proc)
        import httpx

        for _ in range(150):
            if proc.poll() is not None:
                raise RuntimeError("Owned service failed startup; log " + log.name)
            try:
                if (
                    httpx.get(
                        f"http://127.0.0.1:{port}/openapi.json", timeout=0.3
                    ).status_code
                    == 200
                ):
                    return proc
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        raise TimeoutError("Owned HTTP service startup")

    try:
        app_url, app_engine, app_db = database("application")
        control_url, control_engine, control_db = database("control")
        witness_url, witness_engine, witness_db = database("witness")
        ControlCommit.__table__.create(app_engine)
        ControlBase.metadata.create_all(control_engine)
        WitnessBase.metadata.create_all(witness_engine)
        with control_db.begin() as session:
            session.add(Head(id=1, generation=0))
            digest = authority_digest(session)
        with witness_db.begin() as session:
            session.add(Checkpoint(id=1, sequence=0, digest=digest))
        ckey, wkey = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        credentials = {
            key: {"role": role, "token": secrets.token_hex(32)}
            for key, role in [
                ("source", "source"),
                ("successor", "source"),
                ("operator", "operator"),
                ("restore", "restore"),
            ]
        }
        witness_port, control_port = free_port(), free_port()
        proxy = AckLossProxy(("127.0.0.1", witness_port))
        thread = Thread(target=proxy.serve_forever, daemon=True)
        thread.start()
        env = {
            **os.environ,
            "PHARMSHIFT_ENV": "development",
            "DATABASE_URL": app_url,
            "SHIFT_SCHEDULER_DB_URL": app_url,
            "PHARMSHIFT_AUTHORITY_DB_URL": control_url,
            "PHARMSHIFT_WITNESS_DB_URL": witness_url,
            "PHARMSHIFT_AUTHORITY_PRIVATE_KEY": ckey.private_bytes_raw().hex(),
            "PHARMSHIFT_AUTHORITY_CREDENTIALS": json.dumps(credentials),
            "PHARMSHIFT_WITNESS_PRIVATE_KEY": wkey.private_bytes_raw().hex(),
            "PHARMSHIFT_WITNESS_URL": f"http://127.0.0.1:{proxy.server_address[1]}",
            "PHARMSHIFT_WITNESS_CLIENT": "authority",
            "PHARMSHIFT_WITNESS_TOKEN": secrets.token_hex(32),
            "PHARMSHIFT_WITNESS_PUBLIC_KEY": wkey.public_key().public_bytes_raw().hex(),
        }
        server("scripts.control_witness:build_app", env, witness_port, "witness")
        authority = server(
            "scripts.control_authority:build_app", env, control_port, "authority"
        )

        def clients(key):
            return {
                name: AuthorityClient(
                    f"http://127.0.0.1:{control_port}",
                    name,
                    item["token"],
                    key.public_key().public_bytes_raw().hex(),
                )
                for name, item in credentials.items()
            }

        current = clients(ckey)
        source, operator = current["source"], current["operator"]
        operator.request("POST", "/nodes", {"node_id": "source", "role": "source"})
        operator.request("POST", "/nodes", {"node_id": "restore", "role": "restore"})
        assert source.require_access()["generation"] == 0
        operation = uuid4().hex
        proxy.arm("POST /prepare ")
        with pytest.raises(RestoreUnavailable):
            source.request(
                "POST",
                "/operations/prepare",
                {
                    "operation_id": operation,
                    "expected_generation": 0,
                    "manifest": {"synthetic": 1},
                },
            )
        with control_db() as session:
            assert (
                session.get(Head, 1).pending is None
                and session.get(Operation, operation) is None
            )
        with witness_db() as session:
            pending = session.get(Checkpoint, 1).pending
            assert pending
        with pytest.raises(RestoreUnavailable):
            source.require_access()
        with pytest.raises(RestoreUnavailable):
            source.request("POST", "/witness/reconcile")
        reconciled = operator.request("POST", "/witness/reconcile")
        assert reconciled["state"] == "ABORTED"
        with witness_db() as session:
            receipt = session.get(IntentResolution, pending)
            assert receipt and len(receipt.verification_hash) == 64
            sequence = session.get(Checkpoint, 1).sequence
        assert source.require_access()["allowed"]
        record(
            "before_image_ack_loss_requires_operator_locked_proof", sequence=sequence
        )
        # Restart authority after recovery, proving receipts are not process memory.
        authority.terminate()
        authority.wait(timeout=10)
        authority = server(
            "scripts.control_authority:build_app",
            env,
            control_port,
            "authority-restarted",
        )
        assert source.require_access()["allowed"]
        operation = uuid4().hex
        manifest = {"synthetic": 2}
        manifest_hash = content_hash(manifest)
        source.request(
            "POST",
            "/operations/prepare",
            {"operation_id": operation, "expected_generation": 0, "manifest": manifest},
        )
        receipt_body = {
            "operation_id": operation,
            "source_id": "source",
            "expected_generation": 0,
            "manifest_hash": manifest_hash,
        }
        receipt_hash = content_hash(receipt_body)
        with app_db.begin() as session:
            session.add(ControlCommit(**receipt_body, receipt_hash=receipt_hash))
        proxy.arm("POST /commit/")
        with pytest.raises(RestoreUnavailable):
            source.request(
                "POST",
                "/operations/" + operation + "/commit",
                {"manifest_hash": manifest_hash, "receipt_hash": receipt_hash},
            )
        with control_db() as session:
            assert (
                session.get(Head, 1).generation == 1
                and session.get(Operation, operation).state == "COMMITTED"
            )
        assert operator.request("POST", "/witness/reconcile")["state"] == "CONSISTENT"
        retry = source.request(
            "POST",
            "/operations/" + operation + "/commit",
            {"manifest_hash": manifest_hash, "receipt_hash": receipt_hash},
        )
        assert retry["generation"] == 1 and source.require_access()["generation"] == 1
        with app_db() as session:
            assert len(list(session.scalars(select(ControlCommit)))) == 1
        record(
            "after_image_ack_loss_retries_once",
            application_receipts=1,
            control_generation=1,
        )
        latest = operator.request("GET", "/manifest")
        with pytest.raises(RestoreUnavailable):
            operator.request(
                "POST",
                "/nodes/restore/release",
                {
                    "expected_generation": 1,
                    "manifest_hash": latest["manifest_hash"],
                    "verification_hash": "c" * 64,
                },
            )
        with pytest.raises(RestoreUnavailable):
            current["restore"].require_access()
        record("legacy_hash_only_release_rejected", restore_open=False)
        fence = uuid4().hex
        operator.request(
            "POST",
            "/nodes/source/fence",
            {
                "operation_id": fence,
                "expected_generation": 1,
                "reason": "Synthetic verified operator writer replacement",
            },
        )
        with pytest.raises(RestoreUnavailable):
            source.require_access()
        replaced = operator.request(
            "POST",
            "/nodes/source/replace-writer",
            {"fence_id": fence, "new_node_id": "successor", "expected_generation": 1},
        )
        assert (
            replaced["state"] == "REPLACED"
            and current["successor"].require_access()["allowed"]
        )
        with pytest.raises(RestoreUnavailable):
            source.require_access()
        with pytest.raises(RestoreUnavailable):
            source.request(
                "POST",
                "/operations/prepare",
                {
                    "operation_id": uuid4().hex,
                    "expected_generation": 1,
                    "manifest": {"stale": True},
                },
            )
        with control_db() as session:
            assert session.get(Node, "source").role == "retired_source"
            assert (
                sum(
                    n.role == "source" and n.open for n in session.scalars(select(Node))
                )
                == 1
            )
        record(
            "writer_fence_and_replace", active_writers=1, old_writer="retired_source"
        )
        authority.terminate()
        authority.wait(timeout=10)
        newkey = Ed25519PrivateKey.generate()
        env = {
            **env,
            "PHARMSHIFT_AUTHORITY_PRIVATE_KEY": newkey.private_bytes_raw().hex(),
        }
        authority = server(
            "scripts.control_authority:build_app",
            env,
            control_port,
            "authority-new-key",
        )
        with pytest.raises(RestoreUnavailable):
            current["successor"].require_access()
        assert clients(newkey)["successor"].require_access()["allowed"]
        record(
            "signing_key_restart_rejects_old_public_key",
            old_key_rejected=True,
            new_key_allowed=True,
        )
        assert len(proxy.events) == 2 and all(
            e["upstream_status"] == "HTTP/1.1 200 OK" and e["downstream_bytes"] == 0
            for e in proxy.events
        )
        proof["ack_losses"] = proxy.events
        proof["passed"] = True
    finally:
        if proxy:
            proxy.shutdown()
            proxy.server_close()
        for proc in reversed(processes):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=10)
        for stream in streams:
            stream.close()
        for engine in engines:
            engine.dispose()
        for name in reversed(containers):
            subprocess.run(
                ["docker", "rm", "-f", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        target = os.getenv("PHARMSHIFT_NETWORK_EVIDENCE")
        if target:
            with Path(target).open("x") as stream:
                json.dump(proof, stream, indent=2)
