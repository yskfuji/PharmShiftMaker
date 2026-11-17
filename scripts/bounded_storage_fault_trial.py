"""Real ENOSPC on a dedicated <=64 KiB /managed tmpfs; never fill a host disk."""

import errno
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4


def main():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker

    from shift_scheduler.application import copies, privacy
    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.db.planning_models import PlanningScope
    from shift_scheduler.domain.copies import CopyRegistration
    from shift_scheduler.domain.planning import Evidence
    from shift_scheduler.domain.privacy import RetentionPolicy

    AT = datetime(2035, 1, 1, tzinfo=UTC)
    SCOPE = "hospital/pharmacy"
    root = Path("/managed")
    stat = os.statvfs(root)
    if stat.f_blocks * stat.f_frsize > 65536 or stat.f_files > 32:
        raise ValueError(
            "Only the dedicated 64 KiB / 32 inode test filesystem is allowed"
        )
    url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    if "pharmshift_audit" not in url:
        raise ValueError("Isolated audit DB required")
    schema = "audit_capacity_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as s:
        s.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = url + "?options=-csearch_path%3D" + schema
    os.environ["DATABASE_URL"] = os.environ["SHIFT_SCHEDULER_DB_URL"] = scoped
    engine = create_engine(scoped)
    try:
        command.upgrade(Config("alembic.ini"), "head")
        factory = sessionmaker(engine, expire_on_commit=False)
        os.environ["PHARMSHIFT_MANAGED_STORAGE"] = str(root)
        path = root / "record.txt"
        path.write_text("synthetic-person-only")
        evidence = Evidence(
            reference="synthetic bounded storage fixture",
            status="verified",
            verified_by="test",
        )
        with factory.begin() as s:
            s.add(PlanningScope(scope_id=SCOPE, input_revision=0, data_revision=0))
            s.flush()
            privacy.save_rule(
                s,
                SCOPE,
                RetentionPolicy(
                    category="exports",
                    purpose="bounded storage fault trial",
                    anchor="last_activity",
                    retention_days=1,
                    legal_minimum_days=0,
                    effective_from="2030-01-01",
                    effective_until="2040-01-01",
                    evidence=evidence,
                    owner="test",
                    next_review="2036-01-01",
                ),
                0,
                "test",
            )
            copies.register(
                s,
                SCOPE,
                CopyRegistration(
                    copy_id="copy1",
                    category="exports",
                    medium="file",
                    relative_path=path.name,
                    content_hash=copies.file_digest(path),
                    person_ids=("p0",),
                    anchor="last_activity",
                    anchor_at="2020-01-01T00:00:00Z",
                    evidence=evidence,
                    subject_status="VERIFIED",
                ),
                0,
                "test",
            )
        with factory.begin() as s:
            plan = copies.preview(s, SCOPE, "p0", "test", AT)
            copies.execute(
                s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
            )
        fillers = []
        for i in range(64):
            target = root / f"filler-{i}"
            try:
                target.touch(exist_ok=False)
            except OSError as error:
                assert error.errno == errno.ENOSPC, error
                break
            fillers.append(target)
        else:
            raise AssertionError("Dedicated filesystem did not enforce the quota")
        assert copies.process_one(factory, AT)
        with factory() as s:
            row = s.get(ManagedCopy, "copy1")
            assert row.state == "RETRY_WAIT", row.state
            assert row.evidence["last_error_errno"] == errno.ENOSPC
        assert path.exists()
        for target in fillers:
            target.unlink()
        assert copies.process_one(factory, AT + timedelta(seconds=10))
        assert not path.exists()
        with factory() as s:
            assert s.get(ManagedCopy, "copy1").state == "ERASED"
        print(
            json.dumps(
                {
                    "passed": True,
                    "filesystem_bytes": stat.f_blocks * stat.f_frsize,
                    "filesystem_inodes": stat.f_files,
                    "filled_inodes": len(fillers),
                    "fault_errno": errno.ENOSPC,
                    "states": ["PENDING_ERASURE", "RETRY_WAIT", "ERASED"],
                    "boundary": "real bounded inode exhaustion; not host disk failure",
                }
            )
        )
    finally:
        engine.dispose()
        with admin.begin() as s:
            s.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    main()
