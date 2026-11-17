"""Full pg_dump/pg_restore, post-restore erasure replay and committed isolation proof.

Creates two uniquely named synthetic databases and drops only those owned names.
The independent current manifest stays outside the backup being restored.
"""

import argparse
import hashlib
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from scripts.backup_pipeline import run_pg_dump, run_pg_restore
from scripts.remediation_fixture import snapshot
from scripts.remediation_schema import export_schema
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from shift_scheduler.application import copies, planning, privacy
from shift_scheduler.db.compliance_models import ManagedCopy, PrivacyCase
from shift_scheduler.db.planning_models import PlanningInput
from shift_scheduler.db.restore_lock import RestoreUnavailable, protect_engine
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.erasure_replay import export_manifest, replay


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--with-database-copies", action="store_true")
    args = parser.parse_args()
    target = Path(args.output).resolve()
    if target.exists():
        raise ValueError("A fresh evidence directory is required")
    target.mkdir(parents=True)
    url = make_url(os.environ["PHARMSHIFT_TEST_PG_URL"])
    if url.database != "pharmshift_audit_remediation" or url.port != 55441:
        raise ValueError("Dedicated local audit database required")
    names = ["pharmshift_audit_restore_" + uuid4().hex for _ in range(2)]
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    engines = []
    created = []
    started = time.perf_counter()
    log = {
        "scope": "synthetic two-person V3 input and registered file; not production RPO/RTO",
        "checks": [],
    }

    def check(name, condition):
        log["checks"].append({"name": name, "passed": bool(condition)})
        if not condition:
            raise AssertionError(name)

    try:
        with admin.connect() as connection:
            for name in names:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
                created.append(name)
        urls = [
            url.set(database=name).render_as_string(hide_password=False)
            for name in names
        ]
        for value in urls:
            engines.append(create_engine(value))
        os.environ.update(DATABASE_URL=urls[0], SHIFT_SCHEDULER_DB_URL=urls[0])
        command.upgrade(Config("alembic.ini"), "head")
        source = sessionmaker(engines[0], expire_on_commit=False)
        destination = sessionmaker(engines[1], expire_on_commit=False)
        source_root, restored_root = target / "source-files", target / "restored-files"
        source_root.mkdir()
        restored_root.mkdir()
        os.environ["PHARMSHIFT_MANAGED_STORAGE"] = str(source_root)
        data = snapshot()
        content = b"Synthetic p0 export. No real staff information."
        (source_root / "export.txt").write_bytes(content)
        at = datetime(2035, 1, 1, tzinfo=UTC)
        scope = "hospital/pharmacy"
        with source.begin() as session:
            planning.register_input(session, data, "synthetic", 0)
            planning.register_input(
                session, data.model_copy(update={"source_revision": 1}), "synthetic", 1
            )
            for category, anchor in [
                ("planning_history", "period_end"),
                ("exports", "last_activity"),
            ]:
                privacy.save_rule(
                    session,
                    scope,
                    RetentionPolicy(
                        category=category,
                        purpose="isolated recovery trial",
                        anchor=anchor,
                        retention_days=1,
                        legal_minimum_days=0,
                        effective_from="2030-01-01",
                        effective_until="2040-01-01",
                        evidence=data.policy_evidence,
                        owner="synthetic",
                        next_review="2036-01-01",
                    ),
                    0,
                    "synthetic",
                )
            copies.register(
                session,
                scope,
                CopyRegistration(
                    copy_id="restore-copy",
                    category="exports",
                    medium="file",
                    relative_path="export.txt",
                    content_hash=hashlib.sha256(content).hexdigest(),
                    person_ids=("p0",),
                    anchor="last_activity",
                    anchor_at="2026-01-01T00:00:00Z",
                    evidence=data.policy_evidence,
                    subject_status="VERIFIED",
                ),
                0,
                "synthetic",
            )
        if args.with_database_copies:
            from tests.test_database_erasure_postgres import (
                prepare as prepare_database_copies,
            )

            prepare_database_copies(source)
            log["scope"] += "; reviewed exclusive compliance original/revision copies"
        schema = export_schema(engines[0], target / "schema")
        tool = str(Path("scripts/audit_pg_client.py").resolve())
        dumped_at = time.perf_counter()
        dump = run_pg_dump(urls[0], target, "synthetic", tool)
        log["dump_seconds"] = time.perf_counter() - dumped_at
        log["dump_sha256"] = hashlib.sha256(dump.read_bytes()).hexdigest()
        with source.begin() as session:
            plan = privacy.preview(session, scope, data.input_hash, "synthetic", at)
            check("expired input is eligible", not plan.payload["blockers"])
            privacy.execute(
                session, scope, plan.plan_id, plan.fingerprint, "synthetic", at
            )
            file_plan = copies.preview(session, scope, "p0", "synthetic", at)
            erased = copies.execute(
                session,
                scope,
                file_plan["plan_id"],
                file_plan["fingerprint"],
                1,
                "synthetic",
                at,
            )
            if args.with_database_copies:
                check(
                    "reviewed compliance graph erased before backup replay",
                    len(erased["erased_database_copy_ids"]) == 2,
                )
        copies.process_one(source, at)
        with source.begin() as session:
            session.add(
                PrivacyCase(
                    case_id="restored-use-restriction",
                    scope_id=scope,
                    person_id="p0",
                    kind="restrict",
                    status="APPROVED",
                    revision=1,
                    payload={"reason": "synthetic continued restriction"},
                )
            )
            session.flush()
            manifest = export_manifest(
                session, b"synthetic-independent-secret-32-bytes"
            )
        (target / "independent-current-manifest.json").write_text(
            json.dumps(manifest, indent=2)
        )
        # Restore an old file and old database; neither contains the latest erasure decision.
        (restored_root / "export.txt").write_bytes(content)
        os.environ["PHARMSHIFT_MANAGED_STORAGE"] = str(restored_root)
        restore_start = time.perf_counter()
        run_pg_restore(urls[1], dump, tool)
        protected = create_engine(urls[1])
        engines.append(protected)
        protect_engine(protected)
        blocked = False
        try:
            with protected.begin() as connection:
                connection.execute(text("SELECT 1"))
        except RestoreUnavailable:
            blocked = True
        check("normal access blocked after full restore", blocked)
        with destination.begin() as session:
            check(
                "original V3 input survives full dump restore byte-for-byte",
                session.get(PlanningInput, data.input_hash).payload
                == data.model_dump(mode="json"),
            )
            check(
                "old file exists before replay",
                (restored_root / "export.txt").read_bytes() == content,
            )
            if args.with_database_copies:
                from shift_scheduler.db.compliance_models import (
                    ComplianceEntity,
                    ComplianceRevision,
                )

                check(
                    "old database copies exist before replay",
                    session.get(ComplianceEntity, "entity") is not None
                    and session.get(ComplianceRevision, "revision") is not None,
                )
            result = replay(
                session,
                manifest,
                content_hash(manifest),
                b"synthetic-independent-secret-32-bytes",
            )
            check("replay completed", result["state"] == "REPLAYED")
        with protected.begin() as connection:
            check(
                "normal access released only after replay",
                connection.scalar(text("SELECT 1")) == 1,
            )
        with destination() as session:
            check(
                "erased input does not resurrect",
                session.get(PlanningInput, data.input_hash) is None,
            )
            check(
                "file erasure status restored",
                session.get(ManagedCopy, "restore-copy").state == "ERASED",
            )
            check(
                "use restriction restored",
                session.get(PrivacyCase, "restored-use-restriction").status
                == "APPROVED",
            )
            if args.with_database_copies:
                check(
                    "database original and revision do not resurrect",
                    session.get(ComplianceEntity, "entity") is None
                    and session.get(ComplianceRevision, "revision") is None,
                )
        check("restored file erased", not (restored_root / "export.txt").exists())
        log["restore_and_replay_seconds"] = time.perf_counter() - restore_start
        log["schema_hash"] = schema["schema_hash"]
        log["result"] = "PASS_WITH_STATED_SCOPE"
    except Exception as exc:
        log["result"] = "FAIL"
        log["exception_type"] = type(exc).__name__
        raise
    finally:
        for engine in engines:
            engine.dispose()
        with admin.connect() as connection:
            for name in created:
                connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()
        log["total_seconds"] = time.perf_counter() - started
        (target / "result.json").write_text(
            json.dumps(log, ensure_ascii=False, indent=2)
        )
        print(json.dumps(log, ensure_ascii=False))


if __name__ == "__main__":
    main()
