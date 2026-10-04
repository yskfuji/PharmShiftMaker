"""Owned, synthetic PG/HTTP restore trial with a separate generation witness.

This measures the stated restore scenario, not the complete 25-month acceptance.
Evidence is never overwritten; all started services and temporary DBs are owned.
"""

import argparse
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from scripts.backup_pipeline import restore_command, run_pg_dump
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_projection import prepare

from shift_scheduler.application import copies, privacy
from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.service import ControlBase, Head
from shift_scheduler.control.witness import Checkpoint, WitnessBase, authority_digest
from shift_scheduler.db.compliance_models import (
    ControlCommit,
    ManagedCopy,
    PreservedArchive,
)
from shift_scheduler.db.planning_models import PlanningInput
from shift_scheduler.db.restore_lock import RestoreUnavailable, protect_engine
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.archive import create_archive
from shift_scheduler.ops.erasure_replay import preservation_artifacts


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run(
    output,
    application_url,
    application_container,
    source_setup=None,
    source_verify=None,
    source_enroll=None,
    source_review=None,
):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    url = make_url(application_url)
    if (
        url.database not in {"pharmshift_audit", "pharmshift_audit_full_20260923"}
        or url.host != "127.0.0.1"
        or url.port != 55443
        or url.username not in {"audit", "audit_full_20260923"}
        or application_container != "pharmshift-storage-closure-20260923-r1"
    ):
        raise ValueError("Dedicated storage closure audit database required")
    events, containers, processes, engines, logs, databases = [], [], [], [], [], []
    result = {
        "completed": False,
        "scope": "Two-person shared history + actual dump/files restore + independent HTTP control and witness; optional 25-month canonical accounting verification, not all shared types/fault matrix",
    }
    admin = create_engine(url, isolation_level="AUTOCOMMIT")

    def record(name, **detail):
        item = {"name": name, "monotonic": time.monotonic(), **detail}
        events.append(item)
        with (output / "events.jsonl").open("a") as f:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True).strip()

    def database(role):
        name = "pharmshift-storage-closure-" + role + "-" + uuid4().hex[:8]
        port = free_port()
        password = secrets.token_hex(24)
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
        connection_url = (
            f"postgresql+psycopg://audit:{password}@127.0.0.1:{port}/pharmshift_{role}"
        )
        probe = create_engine(connection_url, connect_args={"connect_timeout": 1})
        for _ in range(120):
            try:
                with probe.connect() as connection:
                    assert connection.scalar(text("SELECT 1")) == 1
                break
            except Exception:
                time.sleep(0.25)
        else:
            probe.dispose()
            raise TimeoutError("Owned PostgreSQL startup failed")
        probe.dispose()
        return connection_url

    def engine(value):
        e = create_engine(value)
        engines.append(e)
        return e

    def server(module, env, port, filename):
        log = (output / filename).open("a")
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
                raise RuntimeError("Owned service exited; inspect log")
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
        raise TimeoutError("Owned service startup timeout")

    def blocked(client, label):
        try:
            client.require_access()
        except RestoreUnavailable:
            record(label, blocked=True)
        else:
            raise AssertionError(label + " unexpectedly allowed")

    def evidence(value):
        # Independent Fraction expectations are persisted as exact strings, not
        # rounded floats, before they enter a signed JSON verification proof.
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))

    def observe_target(factory, root, phase):
        from collections import Counter

        from shift_scheduler.application.storage_reconciliation import (
            database_observation,
            file_observation,
        )
        from shift_scheduler.db.base import Base

        with (
            patch.dict(os.environ, {"PHARMSHIFT_MANAGED_STORAGE": str(root)}),
            factory.begin() as session,
        ):
            session.execute(text("SET TRANSACTION READ ONLY"))
            scopes = set(session.scalars(select(ManagedCopy.scope_id)))
            for table in Base.metadata.tables.values():
                if "scope_id" in table.c:
                    scopes.update(
                        v
                        for v in session.scalars(select(table.c.scope_id).distinct())
                        if v
                    )
            reports = {
                scope: {
                    "database": database_observation(session, scope),
                    "files": file_observation(session, scope),
                }
                for scope in sorted(scopes)
            }
            issues = [
                {**issue, "scope": scope, "domain": domain}
                for scope, report in reports.items()
                for domain, part in report.items()
                for issue in part["issues"]
            ]
            observed = {
                "reports": reports,
                "issue_count": len(issues),
                "reason_counts": dict(Counter(i["reason"] for i in issues)),
                "unique_issue_copies": len(
                    {i["copy_id"] for i in issues if "copy_id" in i}
                ),
                "all_registered_observed": bool(reports) and not issues,
                "all_paths_complete": False,
            }
        with (output / (phase + "-reconciliation.json")).open("x") as stream:
            json.dump(observed, stream, ensure_ascii=False, indent=2)
        return observed

    try:
        control_url, witness_url = database("control"), database("witness")
        control_db, witness_db = engine(control_url), engine(witness_url)
        ControlBase.metadata.create_all(control_db)
        WitnessBase.metadata.create_all(witness_db)
        from scripts.remediation_schema import export_schema

        for label, database_engine, metadata in (
            ("control", control_db, ControlBase.metadata),
            ("witness", witness_db, WitnessBase.metadata),
        ):
            description = export_schema(
                database_engine, output / (label + "-schema"), metadata
            )
            assert description["orm_match"]
        with sessionmaker(control_db).begin() as s:
            s.add(Head(id=1, generation=0))
            initial = authority_digest(s)
        with sessionmaker(witness_db).begin() as s:
            s.add(Checkpoint(id=1, sequence=0, digest=initial))
        control_key, witness_key = (
            Ed25519PrivateKey.generate(),
            Ed25519PrivateKey.generate(),
        )
        credentials = {
            r: {"role": r, "token": secrets.token_hex(32)}
            for r in ("source", "operator", "restore")
        }
        witness_port, control_port = free_port(), free_port()
        env = {
            **os.environ,
            "PHARMSHIFT_ENV": "development",
            "PHARMSHIFT_AUTHORITY_DB_URL": control_url,
            "PHARMSHIFT_AUTHORITY_PRIVATE_KEY": control_key.private_bytes_raw().hex(),
            "PHARMSHIFT_AUTHORITY_CREDENTIALS": json.dumps(credentials),
            "PHARMSHIFT_WITNESS_DB_URL": witness_url,
            "PHARMSHIFT_WITNESS_PRIVATE_KEY": witness_key.private_bytes_raw().hex(),
            "PHARMSHIFT_WITNESS_URL": f"http://127.0.0.1:{witness_port}",
            "PHARMSHIFT_WITNESS_CLIENT": "authority",
            "PHARMSHIFT_WITNESS_TOKEN": secrets.token_hex(32),
            "PHARMSHIFT_WITNESS_PUBLIC_KEY": witness_key.public_key()
            .public_bytes_raw()
            .hex(),
        }
        witness_process = server(
            "scripts.control_witness:build_app", env, witness_port, "witness.log"
        )
        control_process = server(
            "scripts.control_authority:build_app", env, control_port, "authority.log"
        )
        clients = {
            r: AuthorityClient(
                f"http://127.0.0.1:{control_port}",
                r,
                c["token"],
                control_key.public_key().public_bytes_raw().hex(),
            )
            for r, c in credentials.items()
        }
        source, operator, restored = (
            clients[r] for r in ("source", "operator", "restore")
        )
        for role in ("source", "restore"):
            operator.request("POST", "/nodes", {"node_id": role, "role": role})
        assert source.require_access()["generation"] == 0
        witness_process.kill()
        witness_process.wait(timeout=10)
        blocked(source, "witness_SIGKILL_blocks_source")
        blocked(restored, "witness_SIGKILL_blocks_restore")
        server("scripts.control_witness:build_app", env, witness_port, "witness.log")
        assert source.require_access()["generation"] == 0
        owned = json.loads(docker("inspect", application_container))[0]
        assert (
            owned["Config"].get("Labels", {}).get("pharmshift.synthetic-audit")
            == "true"
        )
        assert any(
            p["HostIp"] == "127.0.0.1" and p["HostPort"] == "55443"
            for p in owned["NetworkSettings"]["Ports"]["5432/tcp"]
        )
        for _ in range(2):
            name = "pharmshift_audit_restore_" + uuid4().hex
            # The restricted application role is not granted CREATEDB. Only an
            # owned UUID database is bootstrapped by the existing local audit DBA.
            docker(
                "exec",
                application_container,
                "psql",
                "--username=audit",
                "--dbname=pharmshift_audit",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                f'CREATE DATABASE "{name}" OWNER "{url.username}"',
            )
            databases.append(name)
        app_urls = [
            url.set(database=n).render_as_string(hide_password=False) for n in databases
        ]
        source_engine, restored_engine = [engine(u) for u in app_urls]
        with patch.dict(
            os.environ,
            {"DATABASE_URL": app_urls[0], "SHIFT_SCHEDULER_DB_URL": app_urls[0]},
        ):
            command.upgrade(Config("alembic.ini"), "head")
        source_factory, restore_factory = [
            sessionmaker(e, expire_on_commit=False)
            for e in (source_engine, restored_engine)
        ]
        from shift_scheduler.control.restore_verification import target_description

        verifier_key = Ed25519PrivateKey.generate()
        planned_root = (
            output / "restored-files" / "sources" / "0000" / "source-files"
        ).resolve()
        trust = {
            **target_description(restore_factory, planned_root=planned_root),
            "public_key": verifier_key.public_key().public_bytes_raw().hex(),
        }
        env["PHARMSHIFT_RESTORE_VERIFIERS"] = json.dumps({"restore": trust})
        control_process.terminate()
        control_process.wait(timeout=10)
        control_process = server(
            "scripts.control_authority:build_app", env, control_port, "authority.log"
        )
        canonical_proof = (
            evidence(source_setup(source_factory, output)) if source_setup else None
        )
        result["canonical_setup"] = canonical_proof
        result["source_enrollment"] = (
            source_enroll(source_factory, output) if source_enroll else None
        )
        data, _, _ = prepare(source_factory)
        original = output / "source-files"
        original.mkdir()
        (original / "export.txt").write_bytes(b"synthetic personal export")
        with patch.dict(os.environ, {"PHARMSHIFT_MANAGED_STORAGE": str(original)}):
            with source_factory.begin() as s:
                privacy.save_rule(
                    s,
                    SCOPE,
                    RetentionPolicy(
                        category="exports",
                        purpose="synthetic restore",
                        anchor="last_activity",
                        retention_days=1,
                        legal_minimum_days=0,
                        effective_from="2030-01-01",
                        effective_until="2040-01-01",
                        evidence=EVIDENCE,
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
                        copy_id="restore-file",
                        category="exports",
                        medium="file",
                        relative_path="export.txt",
                        content_hash=copies.file_digest(original / "export.txt"),
                        person_ids=("p0",),
                        anchor="last_activity",
                        anchor_at="2020-01-01T00:00:00Z",
                        evidence=EVIDENCE,
                        subject_status="VERIFIED",
                    ),
                    0,
                    "test",
                )
            result["source_review"] = (
                source_review(source_factory, output) if source_review else None
            )
            if source_review:
                before = observe_target(source_factory, original, "before-backup")
                if not before["all_registered_observed"]:
                    raise ValueError(
                        "Reviewed synthetic source still has unresolved registered storage"
                    )
            tool = str(Path("scripts/audit_pg_client.py").resolve())
            canonical_before = (
                evidence(
                    source_verify(
                        source_factory, canonical_proof, phase="before_backup"
                    )
                )
                if source_verify
                else None
            )
            result["canonical_before_backup"] = canonical_before
            with patch.dict(
                os.environ, {"PHARMSHIFT_AUDIT_PG_CONTAINER": application_container}
            ):
                dump = run_pg_dump(app_urls[0], output, "shared", tool)
            archive = output / "old-files.tar.gz"
            create_archive([original], archive)
            backed_up_at = datetime.now(UTC)
            secret = b"synthetic-independent-restore-key-0000"
            with (
                patch(
                    "shift_scheduler.control.transaction.configured_client",
                    return_value=source,
                ),
                patch.dict(
                    os.environ, {"PHARMSHIFT_ERASURE_MANIFEST_KEY": secret.decode()}
                ),
            ):
                with source_factory.begin() as s:
                    plan = copies.preview(s, SCOPE, "p0", "test", AT)
                    erased = copies.execute(
                        s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
                    )
                    assert len(erased["preserved_archive_ids"]) == 2
                assert source.require_access()["generation"] == 1
                assert copies.process_one(source_factory, AT)
                assert source.require_access()["generation"] == 2
            assert not (original / "export.txt").exists()
            with source_factory() as s:
                artifacts = preservation_artifacts(s)
                receipts = list(s.scalars(select(ControlCommit)))
                assert len(receipts) == 2
                for receipt in receipts:
                    assert receipt.receipt_hash == content_hash(
                        {
                            "operation_id": receipt.operation_id,
                            "source_id": receipt.source_id,
                            "expected_generation": receipt.expected_generation,
                            "manifest_hash": receipt.manifest_hash,
                        }
                    )
            authority_manifest = operator.request("GET", "/manifest")
            manifest = authority_manifest["manifest"]
            record(
                "shared_erasure_committed",
                archives=len(artifacts),
                application_commit_receipts=len(receipts),
                generation=2,
            )
        # Retained independently of the application dump; no keys are persisted.
        # This is a synthetic evaluation artifact with an explicit authority
        # signature, not a second mutable production control authority.
        with (output / "authoritative-manifest.json").open("x") as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
        (output / "authoritative-manifest.json").chmod(0o600)
        with (output / "authoritative-manifest-receipt.json").open("x") as stream:
            json.dump(
                {
                    "generation": authority_manifest["generation"],
                    "manifest_hash": authority_manifest["manifest_hash"],
                    "control_public_key": control_key.public_key()
                    .public_bytes_raw()
                    .hex(),
                    "transport": "AuthorityClient verified signed response in this run; raw response envelope not retained",
                },
                stream,
                indent=2,
            )
        (output / "preserved-artifacts.json").write_text(
            json.dumps(artifacts, ensure_ascii=False)
        )
        (output / "preserved-artifacts.json").chmod(0o600)
        canonical_latest = (
            evidence(
                source_verify(
                    source_factory,
                    canonical_proof,
                    phase="after_erasure_before_incident",
                )
            )
            if source_verify
            else None
        )
        result["canonical_before_incident"] = canonical_latest
        assert source.require_access()["generation"] == 2
        # A stale authority image must not reauthorize anyone.
        with sessionmaker(control_db).begin() as s:
            s.get(Head, 1).generation = 0
        blocked(source, "authority_generation_rollback_detected")
        with sessionmaker(control_db).begin() as s:
            s.get(Head, 1).generation = 2
        assert source.require_access()["generation"] == 2
        durability = {}
        for name, db in (
            ("application", source_engine),
            ("control", control_db),
            ("witness", witness_db),
        ):
            with db.connect() as c:
                durability[name] = {
                    k: c.scalar(text("SHOW " + k))
                    for k in ("fsync", "synchronous_commit", "full_page_writes")
                }
                assert all(v == "on" for v in durability[name].values())
        # Incident is a real database outage, limited to the fresh UUID source.
        # No other container/database/client is terminated.
        assert databases[0].startswith("pharmshift_audit_restore_")
        incident_started = time.monotonic()
        incident_at = datetime.now(UTC)
        source_engine.dispose()
        with admin.connect() as connection:
            connection.execute(
                text(f'ALTER DATABASE "{databases[0]}" ALLOW_CONNECTIONS false')
            )
            terminated = connection.execute(
                text(
                    "SELECT pid,pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=:name AND pid<>pg_backend_pid()"
                ),
                {"name": databases[0]},
            ).all()
        try:
            with source_engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception:
            record(
                "owned_source_database_outage",
                incident_at=incident_at.isoformat(),
                terminated_connections=len(terminated),
                source_database=databases[0],
            )
        else:
            raise AssertionError("Source database outage was not applied")
        restore_started = time.monotonic()
        target = output / "restored-files"
        with (
            patch(
                "shift_scheduler.control.client.configured_client",
                return_value=operator,
            ),
            patch.dict(
                os.environ,
                {
                    "PHARMSHIFT_RESTORE_NODE": "restore",
                    "PHARMSHIFT_AUDIT_PG_CONTAINER": application_container,
                },
            ),
        ):
            restore_command(
                argparse.Namespace(
                    tarball=str(archive),
                    dump_file=str(dump),
                    target_dir=str(target),
                    db_url=app_urls[1],
                    pg_restore=tool,
                )
            )
        blocked(restored, "complete_dump_restore_is_still_quarantined")
        restored_root = target / "sources" / "0000" / original.name
        assert (restored_root / "export.txt").exists()
        with restore_factory() as s:
            assert s.get(PlanningInput, data.input_hash).payload == data.model_dump(
                mode="json"
            )
        with patch.dict(os.environ, {"PHARMSHIFT_MANAGED_STORAGE": str(restored_root)}):
            from shift_scheduler.control.recovery import restore_with_authority

            def verify_business():
                value = (
                    evidence(
                        source_verify(
                            restore_factory, canonical_proof, phase="after_restore"
                        )
                    )
                    if source_verify
                    else None
                )
                result["canonical_after_restore"] = value
                result["restored_observation"] = observe_target(
                    restore_factory, restored_root, "after-replay"
                )
                return value

            try:
                restored_result = restore_with_authority(
                    restore_factory,
                    operator,
                    "restore",
                    secret,
                    artifacts,
                    verifier_private_key=verifier_key.private_bytes_raw(),
                    business_verifier=verify_business,
                )
            except (ValueError, RestoreUnavailable) as error:
                record("measured_product_release_blocked", reason=str(error))
                result["release_blocked"] = str(error)
                raise
            canonical_after = result["canonical_after_restore"]
            result["restore_verification"] = restored_result
        assert restored.require_access()["generation"] == 2
        with restore_factory() as s:
            assert s.get(PlanningInput, data.input_hash) is None
            kept = list(s.scalars(select(PreservedArchive)))
            assert len(kept) == 2
            assert all(
                [p["person_id"] for p in a.payload["retained"]["people"]] == ["p1"]
                for a in kept
            )
            assert s.get(ManagedCopy, "restore-file").state == "ERASED"
        assert not (restored_root / "export.txt").exists()
        protected = engine(app_urls[1])
        protect_engine(protected)
        with (
            patch(
                "shift_scheduler.control.client.configured_client",
                return_value=restored,
            ),
            protected.begin() as c,
        ):
            assert c.scalar(text("SELECT 1")) == 1
        release_at = datetime.now(UTC)
        incident_rto = time.monotonic() - incident_started
        restore_seconds = time.monotonic() - restore_started
        backup_age = (datetime.now(UTC) - backed_up_at).total_seconds()
        record(
            "restored_shared_history_preserves_other_person_and_reapplies_erasure",
            restore_processing_seconds=restore_seconds,
            backup_age_seconds=backup_age,
            durability=durability,
            dump_sha256=hashlib.sha256(dump.read_bytes()).hexdigest(),
        )
        result.update(
            completed=True,
            restore_processing_seconds=restore_seconds,
            backup_age_seconds=backup_age,
            incident_at=incident_at.isoformat(),
            release_at=release_at.isoformat(),
            incident_to_release_seconds=incident_rto,
            rto_acceptance="PASS" if incident_rto <= 21600 else "FAIL",
            rpo_acceptance="NOT_MEASURED_FROM_COMMITTED_BUSINESS_EVENTS",
            limitation="Owned source DB disabled; incident-to-release RTO includes erasure/canonical checks. RPO requires confirmed business-event proof. Scope remains limited accounting and shared fixture, not all 25-month shared/fault operations.",
        )
        if canonical_latest and canonical_after:
            before = canonical_latest.get("business_receipt")
            after = canonical_after.get("business_receipt")
            if (
                before
                and after
                and before == after
                and canonical_latest["canonical_tables"]
                == canonical_after["canonical_tables"]
            ):
                gap = (
                    datetime.fromisoformat(before["recorded_at"])
                    - datetime.fromisoformat(after["recorded_at"])
                ).total_seconds()
                assert gap >= 0
                result.update(
                    rpo_acceptance="PASS" if gap <= 86400 else "FAIL",
                    business_event_recovery_lag_seconds=gap,
                    rpo_evidence={
                        "source_confirmed": before,
                        "recovered": after,
                        "canonical_table_hashes_match": True,
                        "source_post_backup_business_events": 0,
                        "scope": "Confirmed canonical accounting rows and revisions; post-backup erasure separately reapplied by authority, not backup age.",
                    },
                )
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        for e in engines:
            e.dispose()
        for log in logs:
            log.close()
        with admin.connect() as c:
            for name in databases:
                c.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()
        for name in containers:
            subprocess.run(
                ["docker", "rm", "-f", "-v", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        result["events"] = events
        (output / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2)
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True, type=Path)
    p.add_argument(
        "--application-db",
        default=os.getenv("PHARMSHIFT_TEST_PG_URL"),
        required=not bool(os.getenv("PHARMSHIFT_TEST_PG_URL")),
    )
    p.add_argument(
        "--application-container",
        default=os.getenv("PHARMSHIFT_AUDIT_PG_CONTAINER"),
        required=not bool(os.getenv("PHARMSHIFT_AUDIT_PG_CONTAINER")),
    )
    p.add_argument("--canonical-25-months", action="store_true")
    p.add_argument("--reviewed-small-fixture", action="store_true")
    args = p.parse_args()
    callbacks = {}
    if args.reviewed_small_fixture:
        if args.canonical_25_months:
            raise ValueError("Small fixed review is not a canonical 25-month review")
        from scripts.small_restore_fixture import enroll, review

        callbacks = {"source_enroll": enroll, "source_review": review}
    if args.canonical_25_months:
        from scripts.long_integrated_restore import setup, verify

        callbacks = {"source_setup": setup, "source_verify": verify}
    run(args.output, args.application_db, args.application_container, **callbacks)
