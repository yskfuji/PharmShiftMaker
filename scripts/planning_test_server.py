"""Disposable E2E backend + worker. Never reads or resets application data."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory(prefix="pharmshift-planning-e2e-") as directory:
        url = "sqlite:///" + str(Path(directory) / "isolated.db")
        os.environ.update(
            DATABASE_URL=url,
            SHIFT_SCHEDULER_DB_URL=url,
            AUTH_MODE="mock",
            PHARMSHIFT_ENV="development",
            AUTH_JWT_SECRET="isolated-e2e-only-not-for-deployment",
            SHIFT_SCHEDULER_DATA_BACKEND="db",
            API_CORS_ALLOW_ORIGINS="https://127.0.0.1:18501",
            FRONTEND_BASE_URL="https://127.0.0.1:18501",
        )
        from tests.test_reviewed_planning import snapshot

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
            register_input(session, snapshot(2, 2), "fixture", 0)
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
                "18500",
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
