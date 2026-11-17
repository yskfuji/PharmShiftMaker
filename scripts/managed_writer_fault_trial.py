"""Real ENOSPC and process death on a dedicated small tmpfs, not host storage."""

import hashlib
import json
import multiprocessing
import os
import signal
from pathlib import Path
from uuid import uuid4


def interrupted_publish(url, identity, channel):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.ops import managed_writer

    engine = create_engine(url)
    original = managed_writer.os.fsync
    count = 0

    def gate(fd):
        nonlocal count
        original(fd)
        count += 1
        if count == 2:
            channel.send("file_durable_database_unacknowledged")
            channel.recv()

    managed_writer.os.fsync = gate
    managed_writer.publish_bytes(
        sessionmaker(engine), "hospital/pharmacy", identity, b"x" * 16384
    )


def main():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.domain.copies import CopyRegistration
    from shift_scheduler.ops import managed_writer

    root = Path("/managed")
    stat = os.statvfs(root)
    if stat.f_blocks * stat.f_frsize > 65536 or stat.f_files > 32:
        raise ValueError("Only the dedicated 64 KiB / 32 inode filesystem is allowed")
    url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    if "pharmshift_audit" not in url:
        raise ValueError("Isolated audit database required")
    schema = "audit_writer_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as s:
        s.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = url + "?options=-csearch_path%3D" + schema
    os.environ["DATABASE_URL"] = os.environ["SHIFT_SCHEDULER_DB_URL"] = scoped
    os.environ["PHARMSHIFT_MANAGED_STORAGE"] = str(root)
    engine = create_engine(scoped)
    proc = None
    events = []
    try:
        command.upgrade(Config("alembic.ini"), "head")
        factory = sessionmaker(engine, expire_on_commit=False)
        data = b"x" * 16384
        identity = uuid4().hex
        item = CopyRegistration(
            copy_id=identity,
            relative_path=identity,
            category="exports",
            medium="file",
            person_ids=("p0",),
            content_hash=hashlib.sha256(data).hexdigest(),
            anchor="last_activity",
            anchor_at="2026-01-01T00:00:00Z",
            subject_status="VERIFIED",
            evidence={
                "reference": "synthetic fault fixture",
                "status": "verified",
                "verified_by": "test",
            },
        )
        managed_writer.reserve(
            factory, "hospital/pharmacy", item, "schedule.csv", "a" * 64
        )
        # Bytes exhaust the bounded mount; do not fill any host disk or general temp dir.
        (root / "fault-filler").write_bytes(b"0" * (60 * 1024))
        try:
            managed_writer.publish_bytes(factory, "hospital/pharmacy", identity, data)
        except OSError as error:
            assert error.errno == 28, error
            events.append(
                {"point": "file_write", "fault": "ENOSPC", "errno": error.errno}
            )
        else:
            raise AssertionError("Bounded filesystem did not fail the write")
        with factory() as s:
            assert s.get(ManagedCopy, identity).state == "WRITE_RETRY"
            assert not managed_writer.reconcile_files(s)["complete"]
        (root / "fault-filler").unlink()
        # Resume into another real fault after bytes are fsynced, before DB acknowledgement.
        ctx = multiprocessing.get_context("spawn")
        parent, child = ctx.Pipe()
        proc = ctx.Process(target=interrupted_publish, args=(scoped, identity, child))
        proc.start()
        if not parent.poll(30):
            raise AssertionError("Worker did not reach the durable-file fault boundary")
        assert parent.recv() == "file_durable_database_unacknowledged"
        os.kill(proc.pid, signal.SIGKILL)
        proc.join(10)
        assert proc.exitcode == -signal.SIGKILL
        with factory() as s:
            assert s.get(ManagedCopy, identity).state == "WRITING"
        assert (root / identity).read_bytes() == data
        events.append(
            {
                "point": "file_durable_before_database_ack",
                "fault": "worker_SIGKILL",
                "state": "WRITING",
            }
        )
        managed_writer.publish_bytes(factory, "hospital/pharmacy", identity, data)
        with factory() as s:
            assert s.get(ManagedCopy, identity).state == "PRESENT"
            assert managed_writer.reconcile_files(s)["complete"]
        assert (root / identity).read_bytes() == data
        events.append(
            {
                "point": "resume",
                "state": "PRESENT",
                "exact_bytes": len(data),
                "unregistered_files": 0,
            }
        )
        Path("/evidence/result.json").write_text(
            json.dumps(
                {
                    "passed": True,
                    "filesystem_bytes": stat.f_blocks * stat.f_frsize,
                    "events": events,
                    "scope": "Same file reservation survives ENOSPC then worker SIGKILL; not 25-month/all-fault acceptance",
                },
                indent=2,
            )
        )
    finally:
        if proc and proc.is_alive():
            proc.kill()
            proc.join(10)
        engine.dispose()
        with admin.begin() as s:
            s.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    main()
