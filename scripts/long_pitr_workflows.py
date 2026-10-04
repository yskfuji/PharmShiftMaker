"""Same-canonical 25-month physical recovery bridge.

This diagnostic connects actual app tables and managed files to physical WAL
recovery. It deliberately does not certify subject erasure/release/expiry or
all faults. The full lifecycle must use the independently authorised controls.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from scripts.long_integrated_restore import (
    SUPPORTED,
    check_balances,
    check_work,
    content,
    receipt,
)
from scripts.long_integrated_scenario import month, scenario, stamp
from scripts.long_integrated_workflows import LongWorkflowDiagnostics
from scripts.pitr_verification import (
    durable_copy,
    is_explicit_hba_rejection,
    snapshot_database,
)
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

CONNECTED = SUPPORTED | {"publication", "hold", "erasure_attempt", "backup"}


def scoped_url(url, schema):
    if not schema.startswith("audit_") or not schema[6:].isalnum():
        raise ValueError("Owned audit schema required")
    return (
        make_url(url)
        .update_query_dict({"options": "-csearch_path=" + schema})
        .render_as_string(hide_password=False)
    )


def file_catalogue(factory, root):
    """Compare exact registered bytes; never approve unresolved attribution."""
    from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy

    root = Path(root).resolve()
    result = []
    erased = set()
    with factory() as session:
        for row in session.scalars(
            select(ManagedCopy).where(ManagedCopy.medium.in_(("file", "backup")))
        ):
            if row.state == "ERASED":
                # Settled erasure: the bytes must be gone and are never restored.
                name = row.locator["relative_path"]
                if (
                    Path(name).name != name
                    or (root / name).exists()
                    or (root / name).is_symlink()
                ):
                    raise ValueError(
                        "Erased managed file still present: " + row.copy_id
                    )
                erased.add(name)
                continue
            if row.state != "PRESENT":
                raise ValueError("Unsettled managed file: " + row.copy_id)
            name = row.locator["relative_path"]
            path = root / name
            if Path(name).name != name or path.is_symlink() or not path.is_file():
                raise ValueError("Unsafe or missing managed file: " + row.copy_id)
            raw = path.read_bytes()
            actual = hashlib.sha256(raw).hexdigest()
            if actual != row.content_hash:
                raise ValueError("Managed file hash mismatch: " + row.copy_id)
            result.append(
                {
                    "copy_id": row.copy_id,
                    "relative_path": name,
                    "sha256": actual,
                    "size": len(raw),
                    "revision": row.revision,
                    "subject_status": row.subject_status,
                    "people": sorted(
                        session.scalars(
                            select(CopySubject.person_id).where(
                                CopySubject.copy_id == row.copy_id
                            )
                        )
                    ),
                }
            )
    known = {v["relative_path"] for v in result}
    for path in root.iterdir():
        if path.name not in known:
            if path.name == ".erasure":
                # The erasure worker's private quarantine must be settled (empty).
                if (
                    path.is_symlink()
                    or not path.is_dir()
                    or path.stat().st_mode & 0o777 != 0o700
                    or any(path.iterdir())
                ):
                    raise ValueError("Unsettled erasure quarantine")
                continue
            # Common writer's empty lock files are explicitly non-payload, for
            # present copies and for copies whose erasure has settled.
            if (
                path.is_symlink()
                or not path.is_file()
                or path.name not in {".lock-" + n for n in known | erased}
                or path.stat().st_size
            ):
                raise ValueError("Unregistered managed file: " + path.name)
    return sorted(result, key=lambda r: r["copy_id"])


def retain_files(root, catalogue, independent):
    """Durable, content-addressed evaluation storage separate from source files."""
    independent.mkdir(parents=True, exist_ok=True)
    for item in catalogue:
        raw = (root / item["relative_path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise ValueError("Source file changed before independent capture")
        target = independent / item["sha256"]
        if target.exists():
            if target.is_symlink() or target.read_bytes() != raw:
                raise ValueError("Independent artifact collision")
        else:
            with target.open("xb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            target.chmod(0o600)
    fd = os.open(independent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def export_committed_input(adapter, _root, event):
    """A real typed export through the registered writer, from the current API input."""
    from shift_scheduler.domain.copies import CopyRegistration
    from shift_scheduler.ops.managed_writer import publish_bytes, reserve

    value = adapter.require(
        adapter.api.request("/planning/inputs/latest" + adapter.query)
    )
    raw = json.dumps(
        value["snapshot"], sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode()
    identity = uuid4().hex
    item = CopyRegistration(
        copy_id=identity,
        category="exports",
        medium="file",
        relative_path=identity,
        content_hash=hashlib.sha256(raw).hexdigest(),
        person_ids=tuple(p["person_id"] for p in value["snapshot"]["people"]),
        anchor="last_activity",
        anchor_at=event["recorded_at"],
        evidence=adapter.ev,
        subject_status="VERIFIED",
    )
    reserve(adapter.factory, adapter.scope, item, "schedule.json", value["input_hash"])
    publish_bytes(adapter.factory, adapter.scope, identity, raw)
    return identity


def source_manifest():
    files = [
        p
        for pattern in ("*.py", "*.json", "*.yaml", "*.yml")
        for p in Path("src/shift_scheduler").rglob(pattern)
    ]
    files += [
        Path(v)
        for v in (
            "scripts/owned_pitr.py",
            "scripts/long_pitr_workflows.py",
            "scripts/long_integrated_workflows.py",
            "scripts/long_integrated_api.py",
            "scripts/long_integrated_scenario.py",
            "scripts/long_integrated_restore.py",
            "scripts/long_subject_events.py",
            "scripts/long_subject_review.py",
            "scripts/owned_control_services.py",
            "scripts/coupled_acceptance_api.py",
            "scripts/pitr_verification.py",
            "pyproject.toml",
            "alembic.ini",
        )
    ]
    files += list(Path("alembic").rglob("*.py"))
    files += list(Path("ops").glob("synthetic-review-protocol-*.json"))
    files += [p for p in Path(".").glob("*lock*") if p.is_file()]
    files += list(Path(".").glob("requirements*.txt"))
    return {
        str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))
    }


def run(
    output: Path, *, subject_controls=False, review_protocol=None, deferred_only=False
):
    from scripts.owned_pitr import OwnedPITR

    if os.getenv("PHARMSHIFT_TEST_FULL_RESTORE") != "1":
        raise ValueError("Explicit isolated full restore opt-in required")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    managed = output / "managed-source"
    managed.mkdir()
    result = {
        "status": "RUNNING",
        "full_combined_acceptance": False,
        "processed": [],
        "unconnected": [],
        "monthly_checks": [],
        "backups": [],
        "limitations": [
            "Person erasure, authorised release and backup expiry not accepted by this bridge.",
            "No RTO/RPO acceptance: ordinary connections stay quarantined.",
            "Compressed synthetic calendar is not 25 months of physical endurance.",
        ],
    }
    adapter = None
    engines = []
    if review_protocol is not None and not subject_controls:
        raise ValueError(
            "A review protocol only applies to connected person-erasure events"
        )
    if deferred_only and review_protocol is None:
        raise ValueError(
            "Deferred expiry processing needs a registered review protocol"
        )
    code_before = source_manifest()
    if review_protocol is not None:
        from scripts.long_subject_review import protocol_digest

        # Registered before any event runs; the reviewer re-checks it per decision.
        result["review_protocol"] = {
            "path": str(review_protocol),
            "sha256": protocol_digest(review_protocol),
            "decisions": "review-decisions.jsonl",
            "observer_writes_reviews": False,
        }
    (output / "source-before.json").write_text(json.dumps(code_before, indent=2))

    def save():
        # This is a run-local progress snapshot; append-only event journal below
        # retains first failures. Prior run directories are never reused.
        temporary = output / ".result.tmp"
        temporary.write_text(
            json.dumps(result, indent=2, ensure_ascii=False, default=str)
        )
        temporary.replace(output / "result.json")

    def record(event, detail):
        with (output / "events.jsonl").open("a") as stream:
            stream.write(
                json.dumps(
                    {
                        "event_id": event["event_id"],
                        "synthetic_recorded_at": event["recorded_at"],
                        "observed_at": datetime.now(UTC).isoformat(),
                        "detail": detail,
                    },
                    default=str,
                )
                + "\n"
            )
            stream.flush()
            os.fsync(stream.fileno())

    try:
        with ExitStack() as resources:
            controls = None
            if subject_controls:
                from scripts.owned_control_services import owned_control_services

                controls = resources.enter_context(
                    owned_control_services(output / "authority")
                )
                resources.enter_context(patch.dict(os.environ, controls["environment"]))
            pitr = resources.enter_context(OwnedPITR(output / "physical"))
            schema = "audit_" + uuid4().hex
            bootstrap = create_engine(pitr.source_url)
            engines.append(bootstrap)
            with bootstrap.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            source_url = scoped_url(pitr.source_url, schema)
            with patch.dict(
                os.environ,
                {
                    "DATABASE_URL": source_url,
                    "SHIFT_SCHEDULER_DB_URL": source_url,
                    "PHARMSHIFT_MANAGED_STORAGE": str(managed),
                },
            ):
                command.upgrade(Config("alembic.ini"), "head")
                engine = create_engine(source_url)
                engines.append(engine)
                factory = sessionmaker(engine, expire_on_commit=False)
                adapter = LongWorkflowDiagnostics(factory, person_prefix="long-")
                adapter.setup()
                if review_protocol is not None:
                    from scripts.long_subject_review import SyntheticReviewer

                    adapter.reviewer = SyntheticReviewer(
                        review_protocol,
                        result["review_protocol"]["sha256"],
                        output / "review-decisions.jsonl",
                    )
                    if deferred_only and not adapter.reviewer.protocol.get(
                        "deferred_expiry"
                    ):
                        raise ValueError(
                            "Protocol has no pre-registered deferred expiry rule"
                        )
                adapter.wall_window = (datetime.now(UTC),)
                processed = []
                for index in range(25):
                    for event in scenario():
                        if event["recorded_at"][:7] != str(month(index))[:7]:
                            continue
                        if event["kind"] not in CONNECTED | (
                            {"erasure"} if subject_controls else set()
                        ):
                            result["unconnected"].append(
                                {"event_id": event["event_id"], "kind": event["kind"]}
                            )
                            record(event, {"status": "NOT_CONNECTED"})
                            continue
                        if event["kind"] == "backup":
                            export_committed_input(adapter, managed, event)
                            files = file_catalogue(factory, managed)
                            retain_files(managed, files, output / "independent-files")
                            base = pitr.backup(event["event_id"])
                            result["backups"].append(
                                {
                                    "event_id": event["event_id"],
                                    "base": base,
                                    "canonical": content(factory),
                                    "files": files,
                                }
                            )
                            adapter.applied_events.append(event)
                            detail = {
                                "status": "PHYSICAL_BASE_CREATED",
                                "file_count": len(files),
                            }
                        elif event["kind"] == "erasure":
                            from scripts.long_subject_events import apply_subject_event

                            detail = apply_subject_event(adapter, event, managed)
                            result.setdefault("subject_events", []).append(detail)
                        else:
                            adapter.apply(event)
                            detail = {"status": "APPLIED"}
                        processed.append(event)
                        result["processed"].append(event["event_id"])
                        record(event, detail)
                    cutoff = (
                        datetime.fromisoformat(stamp(month(index + 1)))
                        - timedelta(seconds=1)
                    ).isoformat()
                    result["monthly_checks"].append(
                        check_balances(adapter, processed, cutoff, cutoff)
                    )
                    save()
                result["work_check"] = check_work(adapter, processed)
                result["burden_checks"] = adapter.burden_checks
                before = content(factory)
                all_tables_before = snapshot_database(factory)
                last_receipt = receipt(factory)
                artifacts = None
                if controls:
                    from shift_scheduler.ops.erasure_replay import (
                        preservation_artifacts,
                    )

                    with factory() as session:
                        artifacts = preservation_artifacts(session)
                catalogue = file_catalogue(factory, managed)
                retain_files(managed, catalogue, output / "independent-files")
                target = pitr.mark_target("canonical-end")
                if deferred_only:
                    # A separate run mode: post-expiry processing writes new control
                    # manifests to the independent authority, which PITR does not
                    # roll back, so this run makes no restore or release claim.
                    deferred = adapter.reviewer.protocol["deferred_expiry"]
                    from scripts.long_subject_events import (
                        apply_deferred_expiry,
                        deferred_time,
                    )

                    at = deferred_time(adapter.reviewer.protocol, processed)
                    result["deferred_expiry"] = {
                        "rule": deferred["rule"],
                        "synthetic_at": at.isoformat(),
                        "after_canonical_target": target,
                        "events": [],
                    }
                    for person_id in ("p0", "p1"):
                        result["deferred_expiry"]["events"].append(
                            apply_deferred_expiry(adapter, person_id, at, managed)
                        )
                        save()
                    result["deferred_expiry"]["managed_files_after"] = file_catalogue(
                        factory, managed
                    )
                    assert len(processed) == 297 and len(result["unconnected"]) == 2
                    result.update(
                        status="PASSED_DEFERRED_DIAGNOSTIC_NO_RESTORE",
                        processed_count=len(processed),
                        restore_or_release_claimed=False,
                    )
                    save()
                else:
                    adapter.close()
                    engine.dispose()
                    result["incident_at"] = datetime.now(UTC).isoformat()
                    incident_started = time.monotonic()
                    pitr.owned("container", pitr.source["container"])
                    pitr.cmd("stop", pitr.source["container"])
                    node = pitr.restore(result["backups"][0]["base"], target)
                    restored_engine = create_engine(
                        scoped_url(node["maintenance_url"], schema)
                    )
                    engines.append(restored_engine)
                    restored_factory = sessionmaker(
                        restored_engine, expire_on_commit=False
                    )
                    all_tables_after = snapshot_database(restored_factory)
                    assert (
                        all_tables_after == all_tables_before
                    ), "Full schema tables or rows differ after PITR"
                    assert (
                        content(restored_factory) == before
                    ), "Canonical app rows differ after PITR"
                    assert (
                        receipt(restored_factory, last_receipt["key"]) == last_receipt
                    ), "Committed business receipt differs"
                    restored_root = output / "managed-restored"
                    restored_root.mkdir()
                    for item in catalogue:
                        stored = output / "independent-files" / item["sha256"]
                        if (
                            stored.is_symlink()
                            or hashlib.sha256(stored.read_bytes()).hexdigest()
                            != item["sha256"]
                        ):
                            raise ValueError(
                                "Independent restore artifact missing or modified"
                            )
                        durable_copy(
                            stored,
                            restored_root / item["relative_path"],
                            item["sha256"],
                        )
                    assert file_catalogue(restored_factory, restored_root) == catalogue
                    # Maintenance-only connection never constitutes product release.
                    protected = create_engine(
                        node["application_url"], connect_args={"connect_timeout": 2}
                    )
                    engines.append(protected)
                    try:
                        with protected.connect() as conn:
                            conn.execute(text("SELECT 1"))
                    except Exception as error:
                        if not is_explicit_hba_rejection(error):
                            raise AssertionError(
                                "Connection failure was not an explicit server HBA rejection"
                            ) from error
                        result["ordinary_connection_rejected"] = type(error).__name__
                    else:
                        raise AssertionError(
                            "Ordinary application connected before authorised release"
                        )
                    result.update(
                        status="PASSED_LIMITED_BRIDGE",
                        processed_count=len(processed),
                        target=target,
                        canonical_before=before,
                        canonical_after=content(restored_factory),
                        all_tables_before=all_tables_before,
                        all_tables_after=all_tables_after,
                        business_receipt=last_receipt,
                        files=catalogue,
                        source_backup="backup-3",
                        ordinary_connections_opened=False,
                        incident_to_quarantined_verification_seconds=time.monotonic()
                        - incident_started,
                    )
                    if controls:
                        from cryptography.hazmat.primitives.asymmetric.ed25519 import (
                            Ed25519PrivateKey,
                        )

                        from shift_scheduler.control.recovery import (
                            restore_with_authority,
                        )
                        from shift_scheduler.control.restore_verification import (
                            target_description,
                        )
                        from shift_scheduler.db.restore_lock import RestoreUnavailable

                        signing_key = Ed25519PrivateKey.generate()
                        trust = {
                            **target_description(
                                restored_factory, planned_root=restored_root
                            ),
                            "public_key": signing_key.public_key()
                            .public_bytes_raw()
                            .hex(),
                        }
                        controls["configure_restore_verifiers"]({"restore": trust})
                        with patch.dict(
                            os.environ,
                            {"PHARMSHIFT_MANAGED_STORAGE": str(restored_root)},
                        ):
                            try:
                                released = restore_with_authority(
                                    restored_factory,
                                    controls["clients"]["operator"],
                                    "restore",
                                    controls["environment"][
                                        "PHARMSHIFT_ERASURE_MANIFEST_KEY"
                                    ].encode(),
                                    artifacts,
                                    verifier_private_key=signing_key.private_bytes_raw(),
                                )
                            except (ValueError, RestoreUnavailable) as error:
                                result["authorised_release_attempt"] = {
                                    "status": "BLOCKED",
                                    "error_type": type(error).__name__,
                                    "reason": str(error),
                                }
                            else:
                                # Product attestation alone does not change pg_hba; final
                                # network opening must be separately bound to this receipt.
                                result["authorised_release_attempt"] = {
                                    "status": "ATTESTED_NOT_NETWORK_OPENED",
                                    "result": released,
                                }
                        result["ordinary_connections_opened"] = False
                    assert len(processed) == (297 if subject_controls else 295) and len(
                        result["unconnected"]
                    ) == (2 if subject_controls else 4)
                    save()
    except BaseException as error:
        result.update(
            status="FAILED", error_type=type(error).__name__, error=str(error)
        )
        save()
        raise
    finally:
        if adapter:
            adapter.close()
        for engine in engines:
            engine.dispose()
        after = source_manifest()
        (output / "source-after.json").write_text(json.dumps(after, indent=2))
        result["code_changed_during_run"] = [
            p
            for p in sorted(set(code_before) | set(after))
            if code_before.get(p) != after.get(p)
        ]
        result["frozen_code_evidence"] = not result["code_changed_during_run"]
        if result["code_changed_during_run"]:
            result["observed_status_before_invalidation"] = result["status"]
            result["status"] = "INVALIDATED_CODE_CHANGED"
        save()
    if not result["frozen_code_evidence"]:
        raise RuntimeError(
            "Code changed during this diagnostic; observations retained, acceptance invalidated"
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--subject-controls",
        action="store_true",
        help="Connect real independent services and canonical person API sequence; residuals are not full erasure acceptance",
    )
    parser.add_argument(
        "--review-protocol",
        type=Path,
        help="Pre-registered synthetic reviewer protocol (separate from the observer)",
    )
    parser.add_argument(
        "--deferred-expiry-only",
        action="store_true",
        help="Separate run: canonical events, then post-expiry processing; no restore/release claim",
    )
    args = parser.parse_args()
    run(
        args.output,
        subject_controls=args.subject_controls,
        review_protocol=args.review_protocol,
        deferred_only=args.deferred_expiry_only,
    )


if __name__ == "__main__":
    main()
