"""Disposable E2E backend + worker. Never reads or resets application data."""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import tempfile
from pathlib import Path


def _port(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    if re.fullmatch(r"[1-9][0-9]{0,4}", raw) is None:
        raise ValueError(f"{name} must be an integer between 1 and 65535")
    value = int(raw)
    if value > 65535:
        raise ValueError(f"{name} must be an integer between 1 and 65535")
    return value


def main():
    backend_port = _port("E2E_BACKEND_PORT", 18500)
    frontend_port = _port("E2E_FRONTEND_PORT", 18501)
    with tempfile.TemporaryDirectory(prefix="pharmshift-planning-e2e-") as directory:
        url = "sqlite:///" + str(Path(directory) / "isolated.db")
        os.environ.update(
            DATABASE_URL=url,
            SHIFT_SCHEDULER_DB_URL=url,
            AUTH_MODE="mock",
            PHARMSHIFT_ENV="development",
            AUTH_JWT_SECRET="isolated-e2e-only-not-for-deployment",
            SHIFT_SCHEDULER_DATA_BACKEND="db",
            API_CORS_ALLOW_ORIGINS=f"https://127.0.0.1:{frontend_port}",
            FRONTEND_BASE_URL=f"https://127.0.0.1:{frontend_port}",
        )
        from tests.fixtures.reviewed_planning import reviewed_planning_snapshot

        from shift_scheduler.application.planning import register_input
        from shift_scheduler.db.base import Base
        from shift_scheduler.db.planning_models import AccountMembership
        from shift_scheduler.db.session import (
            configure_session_factory,
            get_engine,
            get_session_factory,
        )

        configure_session_factory(url)
        Base.metadata.create_all(get_engine())
        with get_session_factory().begin() as session:
            for subject, person, role in [
                ("admin", "p0", "ADMIN"),
                ("pharmacist", "p1", "PHARMACIST"),
            ]:
                session.add(
                    AccountMembership(
                        membership_id=subject,
                        issuer="mock",
                        subject=subject,
                        person_id=person,
                        scope_id="hospital/pharmacy",
                        role=role,
                        active=True,
                    )
                )
            register_input(session, reviewed_planning_snapshot(2, 2), "fixture", 0)
        worker = subprocess.Popen(
            [sys.executable, "-m", "shift_scheduler.application.worker"],
            env=os.environ.copy(),
        )
        api = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "shift_scheduler.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(backend_port),
                "--ssl-certfile",
                "certs/localhost-cert.pem",
                "--ssl-keyfile",
                "certs/localhost-key.pem",
            ],
            env=os.environ.copy(),
        )

        def stop(*_):
            api.terminate()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        try:
            api.wait()
        finally:
            worker.terminate()
            worker.wait(timeout=10)
            if api.poll() is None:
                api.terminate()
                api.wait(timeout=10)


if __name__ == "__main__":
    main()
