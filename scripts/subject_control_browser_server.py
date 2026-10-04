"""Owned three-DB browser diagnostic. Fault control is local files, never product HTTP."""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from uuid import uuid4


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    a = p.parse_args()
    out = Path(a.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    container = "pharmshift-storage-closure-20260923-r1"
    label = subprocess.check_output(
        [
            "docker",
            "inspect",
            "--format",
            '{{index .Config.Labels "pharmshift.synthetic-audit"}}',
            container,
        ],
        text=True,
    ).strip()
    if label != "true":
        raise RuntimeError("Synthetic owned container required")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    dbnames = []
    procs = []
    engines = []
    streams = []
    controls = ExitStack()

    def database(kind):
        name = "pharmshift_audit_ui_" + kind + "_" + uuid4().hex
        dbnames.append(name)
        subprocess.run(
            ["docker", "exec", container, "createdb", "-U", "audit", name], check=True
        )
        # Use existing audit user password supplied explicitly, never print it.
        from sqlalchemy.engine import make_url

        base = make_url(os.environ["PHARMSHIFT_TEST_PG_URL"])
        url = base.set(database=name).render_as_string(hide_password=False)
        subprocess.run(
            [
                "docker",
                "exec",
                container,
                "psql",
                "-U",
                "audit",
                "-d",
                name,
                "-c",
                f'ALTER DATABASE "{name}" OWNER TO "{base.username}"',
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        engine = create_engine(url)
        engines.append(engine)
        return url, engine, sessionmaker(engine)

    def start(module, env, portnum, label, factory=True, tls=False):
        log = (out / (label + "-" + uuid4().hex + ".log")).open("x")
        streams.append(log)
        cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            module,
            "--host",
            "127.0.0.1",
            "--port",
            str(portnum),
        ]
        if factory:
            cmd += ["--factory"]
        if tls:
            cmd += [
                "--ssl-certfile",
                "certs/localhost-cert.pem",
                "--ssl-keyfile",
                "certs/localhost-key.pem",
            ]
        proc = subprocess.Popen(cmd, env=env, stdout=log, stderr=log)
        procs.append(proc)
        import httpx

        for _ in range(200):
            if proc.poll() is not None:
                raise RuntimeError("Service exited: " + label)
            try:
                if (
                    httpx.get(
                        ("https" if tls else "http")
                        + f"://127.0.0.1:{portnum}/openapi.json",
                        verify="certs/dev-rootCA.pem",
                        timeout=0.3,
                    ).status_code
                    == 200
                ):
                    return proc
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        raise TimeoutError(label)

    try:
        appurl, engine, db = database("app")
        env = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("PHARMSHIFT_", "DATABASE_", "SHIFT_SCHEDULER_"))
        }
        env.update(
            PYTHONPATH=str(Path("src").resolve()),
            DATABASE_URL=appurl,
            SHIFT_SCHEDULER_DB_URL=appurl,
            AUTH_MODE="mock",
            PHARMSHIFT_ENV="development",
            AUTH_JWT_SECRET="isolated-subject-ui-only",
            SHIFT_SCHEDULER_DATA_BACKEND="db",
            API_CORS_ALLOW_ORIGINS="https://127.0.0.1:18541",
            FRONTEND_BASE_URL="https://127.0.0.1:18541",
            PHARMSHIFT_MANAGED_STORAGE=str(out / "managed"),
        )
        os.environ.update(env)
        from shift_scheduler.db.session import configure_session_factory

        configure_session_factory(appurl)
        from alembic import command
        from alembic.config import Config

        command.upgrade(Config("alembic.ini"), "head")
        from scripts.remediation_fixture import snapshot

        from shift_scheduler.application.planning import register_input
        from shift_scheduler.db.compliance_models import PrivacyCase, RetentionRule
        from shift_scheduler.db.planning_models import AccountMembership

        with db.begin() as s:
            s.add(
                AccountMembership(
                    membership_id="admin",
                    issuer="mock",
                    subject="admin",
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role="ADMIN",
                    active=True,
                )
            )
            register_input(s, snapshot(), "fixture", 0)
            s.add(
                PrivacyCase(
                    case_id="ui-approved",
                    scope_id="hospital/pharmacy",
                    person_id="p1",
                    kind="erase",
                    status="APPROVED",
                    revision=3,
                    payload={
                        "person_id": "p1",
                        "kind": "erase",
                        "reason": "合成本人消去承認",
                    },
                )
            )
            s.add(
                RetentionRule(
                    key="ui-control",
                    scope_id="hospital/pharmacy",
                    category="control",
                    revision=1,
                    payload={
                        "category": "control",
                        "purpose": "合成再作成防止",
                        "anchor": "case_closed",
                        "retention_days": 365,
                        "legal_minimum_days": 0,
                        "effective_from": "2026-01-01",
                        "effective_until": "2028-01-01",
                        "evidence": {
                            "reference": "合成原本",
                            "status": "verified",
                            "verified_by": "admin",
                        },
                        "owner": "admin",
                        "next_review": "2027-12-31",
                    },
                )
            )
        from scripts.owned_control_services import owned_control_services

        control = controls.enter_context(
            owned_control_services(out / "independent-controls")
        )
        env.update(control["environment"])
        authority = control["processes"][-1]
        start("shift_scheduler.api.main:app", env, 18540, "api", False, True)
        (out / "ready.json").write_text(
            json.dumps(
                {
                    "databases": dbnames,
                    "api_port": 18540,
                    "fault_channel": "local-files-only",
                }
            )
        )
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        while True:
            if (out / "stop-authority").exists() and not (
                out / "authority-stopped"
            ).exists():
                authority.terminate()
                authority.wait(10)
                (out / "authority-stopped").write_text(
                    "owned authority process stopped"
                )
            time.sleep(0.1)
    finally:
        for proc in reversed(procs):
            if proc.poll() is None:
                proc.terminate()
                proc.wait(10)
        controls.close()
        for e in engines:
            e.dispose()
        for name in reversed(dbnames):
            subprocess.run(
                ["docker", "exec", container, "dropdb", "-U", "audit", "--force", name],
                check=True,
            )
        for stream in streams:
            stream.close()


if __name__ == "__main__":
    main()
