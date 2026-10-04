"""Database process SIGKILL around reconstruction; not physical power-loss proof."""

import argparse
import json
import os
import subprocess
import time
from pathlib import Path
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(exist_ok=False, parents=True)
    name = "pharmshift-shared-fault-" + uuid4().hex[:10]
    volume = name + "-data"
    report = {
        "container": name,
        "volume": volume,
        "port": 55443,
        "events": [],
        "boundary": "shared database transaction crash recovery; not complete 25-month/fault acceptance",
    }
    log = (args.output / "docker.txt").open("x")

    def docker(*parts, check=True):
        return subprocess.run(["docker", *parts], check=check, stdout=log, stderr=log)

    def wait_ready():
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if (
                docker(
                    "exec", name, "pg_isready", "-U", "audit", check=False
                ).returncode
                == 0
            ):
                return
            time.sleep(0.5)
        raise RuntimeError("Isolated database startup timeout")

    try:
        docker(
            "run",
            "-d",
            "--name",
            name,
            "--label",
            "pharmshift.purpose=isolated-fault-trial",
            "-p",
            "127.0.0.1:55443:5432",
            "-v",
            volume + ":/var/lib/postgresql/data",
            "-e",
            "POSTGRES_USER=audit",
            "-e",
            "POSTGRES_PASSWORD=isolated-test-only",
            "-e",
            "POSTGRES_DB=pharmshift_audit_shared_fault",
            "postgres:16",
        )
        wait_ready()
        url = "postgresql+psycopg://audit:isolated-test-only@127.0.0.1:55443/pharmshift_audit_shared_fault"
        os.environ["DATABASE_URL"] = os.environ["SHIFT_SCHEDULER_DB_URL"] = url
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from tests.test_database_erasure_postgres import AT, SCOPE
        from tests.test_shared_projection import prepare

        from shift_scheduler.application import copies
        from shift_scheduler.db.compliance_models import PreservedArchive
        from shift_scheduler.db.planning_models import PlanningInput

        command.upgrade(Config("alembic.ini"), "head")
        engine = create_engine(url, pool_pre_ping=True)
        factory = sessionmaker(engine, expire_on_commit=False)
        data, _, _ = prepare(factory)
        with factory.begin() as session:
            plan = copies.preview(session, SCOPE, "p0", "fault-trial", AT)
        with factory() as session:
            copies.execute(
                session,
                SCOPE,
                plan["plan_id"],
                plan["fingerprint"],
                1,
                "fault-trial",
                AT,
            )
            began = time.monotonic()
            docker("kill", "--signal", "KILL", name)
            try:
                session.commit()
            except Exception as error:
                report["events"].append(
                    {"phase": "before_commit", "commit_error": type(error).__name__}
                )
            else:
                raise AssertionError("Commit incorrectly succeeded after database kill")
        docker("start", name)
        wait_ready()
        engine.dispose()
        with factory() as session:
            assert session.get(PlanningInput, data.input_hash) is not None
            assert not list(session.scalars(select(PreservedArchive)))
        report["events"].append(
            {
                "phase": "rollback_recovered",
                "seconds": time.monotonic() - began,
                "original_present": True,
                "partial_archives": 0,
            }
        )
        with factory.begin() as session:
            result = copies.execute(
                session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "retry", AT
            )
            assert len(result["preserved_archive_ids"]) == 2
        began = time.monotonic()
        docker("kill", "--signal", "KILL", name)
        docker("start", name)
        wait_ready()
        engine.dispose()
        with factory() as session:
            assert session.get(PlanningInput, data.input_hash) is None
            archives = list(session.scalars(select(PreservedArchive)))
            assert len(archives) == 2
            assert all(
                [p["person_id"] for p in a.payload["retained"]["people"]] == ["p1"]
                for a in archives
            )
        report["events"].append(
            {
                "phase": "committed_recovered",
                "seconds": time.monotonic() - began,
                "original_present": False,
                "partial_archives": 2,
            }
        )
        report["passed"] = True
        engine.dispose()
    finally:
        docker("logs", name, check=False)
        docker("stop", name, check=False)
        (args.output / "result.json").write_text(json.dumps(report, indent=2))
        log.close()


if __name__ == "__main__":
    main()
