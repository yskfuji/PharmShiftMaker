"""Local synthetic authority/witness lifecycle; never touches application databases.

The yielded environment is explicit. Callers choose its process/session scope;
this helper does not patch global environment or weaken application guards.
"""

import json
import os
import secrets
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.service import ControlBase, Head
from shift_scheduler.control.witness import Checkpoint, WitnessBase, authority_digest


def _port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def owned_control_services(output, *, restore_verifiers=None):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    run_id = uuid4().hex
    containers = []
    processes = []
    engines = []
    logs = []

    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True).strip()

    def database(role):
        name = "pharmshift-control-context-" + role + "-" + run_id[:12]
        port = _port()
        password = secrets.token_hex(24)
        # Record intent before launch so failed startup is cleaned by exact name.
        containers.append(name)
        docker(
            "run",
            "-d",
            "--pull",
            "never",
            "--name",
            name,
            "--label",
            "pharmshift.synthetic-audit=true",
            "--label",
            "pharmshift.control-run=" + run_id,
            "-e",
            "POSTGRES_USER=audit",
            "-e",
            "POSTGRES_PASSWORD=" + password,
            "-e",
            "POSTGRES_DB=pharmshift_" + role,
            "-p",
            f"127.0.0.1:{port}:5432",
            "postgres:16",
        )
        url = (
            f"postgresql+psycopg://audit:{password}@127.0.0.1:{port}/pharmshift_{role}"
        )
        engine = create_engine(url, connect_args={"connect_timeout": 1})
        engines.append(engine)
        for _ in range(120):
            try:
                with engine.connect() as c:
                    if c.scalar(text("SELECT 1")) == 1:
                        return url, engine
            except Exception:
                time.sleep(0.25)
        raise TimeoutError("Owned database startup failed")

    def server(module, env, port, name):
        log = (output / (name + ".log")).open("x")
        logs.append(log)
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
            env=env,
            stdout=log,
            stderr=log,
        )
        processes.append(proc)
        for _ in range(120):
            if proc.poll() is not None:
                raise RuntimeError("Owned service exited: " + name)
            try:
                if (
                    httpx.get(
                        f"http://127.0.0.1:{port}/openapi.json", timeout=0.5
                    ).status_code
                    == 200
                ):
                    return proc
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        raise TimeoutError("Owned service startup failed: " + name)

    try:
        control_url, control_db = database("control")
        witness_url, witness_db = database("witness")
        ControlBase.metadata.create_all(control_db)
        WitnessBase.metadata.create_all(witness_db)
        with sessionmaker(control_db).begin() as s:
            s.add(Head(id=1, generation=0))
            initial = authority_digest(s)
        with sessionmaker(witness_db).begin() as s:
            s.add(Checkpoint(id=1, sequence=0, digest=initial))
        ck, wk = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        credentials = {
            r: {"role": r, "token": secrets.token_hex(32)}
            for r in ("source", "operator", "restore")
        }
        wp, cp = _port(), _port()
        env = {
            **os.environ,
            "PHARMSHIFT_ENV": "development",
            "PHARMSHIFT_AUTHORITY_DB_URL": control_url,
            "PHARMSHIFT_AUTHORITY_PRIVATE_KEY": ck.private_bytes_raw().hex(),
            "PHARMSHIFT_AUTHORITY_CREDENTIALS": json.dumps(credentials),
            "PHARMSHIFT_WITNESS_DB_URL": witness_url,
            "PHARMSHIFT_WITNESS_PRIVATE_KEY": wk.private_bytes_raw().hex(),
            "PHARMSHIFT_WITNESS_URL": f"http://127.0.0.1:{wp}",
            "PHARMSHIFT_WITNESS_CLIENT": "authority",
            "PHARMSHIFT_WITNESS_TOKEN": secrets.token_hex(32),
            "PHARMSHIFT_WITNESS_PUBLIC_KEY": wk.public_key().public_bytes_raw().hex(),
            "PHARMSHIFT_RESTORE_VERIFIERS": json.dumps(restore_verifiers or {}),
        }
        server("scripts.control_witness:build_app", env, wp, "witness")
        authority_process = server(
            "scripts.control_authority:build_app", env, cp, "authority"
        )
        clients = {
            r: AuthorityClient(
                f"http://127.0.0.1:{cp}",
                r,
                c["token"],
                ck.public_key().public_bytes_raw().hex(),
            )
            for r, c in credentials.items()
        }
        for role in ("source", "restore"):
            clients["operator"].request(
                "POST", "/nodes", {"node_id": role, "role": role}
            )
        assert clients["source"].require_access()["generation"] == 0
        app_env = {
            "PHARMSHIFT_ENV": "development",
            "PHARMSHIFT_CONTROL_URL": f"http://127.0.0.1:{cp}",
            "PHARMSHIFT_CONTROL_NODE": "source",
            "PHARMSHIFT_CONTROL_TOKEN": credentials["source"]["token"],
            "PHARMSHIFT_CONTROL_PUBLIC_KEY": ck.public_key().public_bytes_raw().hex(),
            "PHARMSHIFT_ERASURE_MANIFEST_KEY": secrets.token_hex(32),
        }
        (output / "resources.json").write_text(
            json.dumps(
                {
                    "run_id": run_id,
                    "containers": containers,
                    "process_ids": [p.pid for p in processes],
                    "scope": "owned synthetic control and witness only",
                },
                indent=2,
            )
        )
        configuration_revision = 0

        def configure_restore_verifiers(mapping):
            # Local trusted evaluation fixture only; never an application API.
            nonlocal authority_process, configuration_revision
            value = json.loads(json.dumps(mapping))
            if not isinstance(value, dict) or set(value) - {"restore"}:
                raise ValueError(
                    "Only the owned restore node may receive verifier trust"
                )
            for trusted in value.values():
                Ed25519PublicKey.from_public_bytes(bytes.fromhex(trusted["public_key"]))
                if (
                    not trusted.get("domains")
                    or len(trusted["domains"]) != len(set(trusted["domains"]))
                    or any(
                        len(trusted.get(k, "")) != 64
                        for k in ("target_hash", "policy_hash")
                    )
                ):
                    raise ValueError("Incomplete restore verifier trust root")
            if authority_process.poll() is None:
                authority_process.terminate()
                try:
                    authority_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    authority_process.kill()
                    authority_process.wait()
            configuration_revision += 1
            env["PHARMSHIFT_RESTORE_VERIFIERS"] = json.dumps(value)
            authority_process = server(
                "scripts.control_authority:build_app",
                env,
                cp,
                "authority-config-" + str(configuration_revision),
            )
            # Stable credentials, signer, DBs and port retain all committed nodes,
            # generations and unresolved operations. No automatic release occurs.
            status = clients["source"].request("GET", "/status")
            (
                output
                / ("verifier-configuration-" + str(configuration_revision) + ".json")
            ).write_text(
                json.dumps(
                    {
                        "revision": configuration_revision,
                        "mapping": value,
                        "process_id": authority_process.pid,
                        "status": status,
                    },
                    indent=2,
                )
            )
            return status

        yield {
            "environment": app_env,
            "clients": clients,
            "control_engine": control_db,
            "witness_engine": witness_db,
            "processes": processes,
            "run_id": run_id,
            "configure_restore_verifiers": configure_restore_verifiers,
        }
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        for engine in engines:
            engine.dispose()
        for log in logs:
            log.close()
        cleanup = []
        for name in containers:
            inspected = subprocess.run(
                ["docker", "inspect", name], capture_output=True, text=True
            )
            if inspected.returncode:
                continue
            info = json.loads(inspected.stdout)[0]
            if info["Config"].get("Labels", {}).get("pharmshift.control-run") != run_id:
                cleanup.append(
                    {"name": name, "removed": False, "reason": "ownership mismatch"}
                )
                continue
            result = subprocess.run(
                ["docker", "rm", "-f", "-v", name], capture_output=True, text=True
            )
            cleanup.append({"name": name, "removed": result.returncode == 0})
        (output / "cleanup.json").write_text(json.dumps(cleanup, indent=2))
