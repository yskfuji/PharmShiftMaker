"""Read-only live storage observations, separate from retention/erasure decisions.

This report never changes a review, registers a missing object, or authorizes
removal. A caller cannot supply a `complete` flag. PostgreSQL canonical row
hashes are checked against the trigger registry; Python independently extracts
structured/person/account and typed-parent references. Unknown prose, physical
media, and external delivery remain explicit limitations.
"""

import hashlib
import os
import stat
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Text, cast, func, inspect, select, text

from shift_scheduler.application.copy_graph import (
    CONTROL,
    LOGICAL,
    logical_target,
    normalized,
    typed_values,
)
from shift_scheduler.application.subject_references import account_references
from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy
from shift_scheduler.domain.planning import content_hash


def _scope_matches(scope, value):
    return (
        not value
        or value == "__unclassified__"
        or value.startswith(scope.split("/")[0] + "/")
    )


def database_observation(session, scope):
    # The canonical trigger uses UTC, but an observer must not leave the caller's
    # transaction in a different timezone (that changes other preview hashes).
    if session.bind.dialect.name != "postgresql":
        return _database_observation(session, scope)
    original_timezone = session.scalar(text("SHOW TIME ZONE"))
    session.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    try:
        return _database_observation(session, scope)
    finally:
        session.execute(
            text("SELECT set_config('TimeZone', :timezone, true)"),
            {"timezone": original_timezone},
        )


def _database_observation(session, scope):
    """Observe all mapped rows, including unregistered rows and retained controls.

    SQLite can exercise reference logic but cannot certify canonical PostgreSQL
    digests or production trigger coverage. No SQL locator is interpolated.
    """
    postgres = session.bind.dialect.name == "postgresql"
    inspector = inspect(session.connection())
    physical_tables = set(inspector.get_table_names()) - {"alembic_version"}
    schema_issues = [
        {"table": name, "reason": "unmapped_database_table"}
        for name in sorted(physical_tables - set(Base.metadata.tables))
    ]
    for name in sorted(physical_tables & set(Base.metadata.tables)):
        actual_columns = {c["name"] for c in inspector.get_columns(name)}
        if actual_columns != set(Base.metadata.tables[name].columns.keys()):
            schema_issues.append(
                {"table": name, "reason": "physical_column_inventory_changed"}
            )
    if postgres:
        triggered = set(session.scalars(text("""SELECT c.relname FROM pg_trigger t
            JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=current_schema() AND t.tgname='pharmshift_copy_write'
              AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal""")))
        schema_issues.extend(
            {"table": name, "reason": "registration_trigger_missing_or_disabled"}
            for name in sorted(set(Base.metadata.tables) - CONTROL - triggered)
        )
    copies = list(session.scalars(select(ManagedCopy)))
    links = {}
    for link in session.scalars(select(CopySubject)):
        links.setdefault(link.copy_id, set()).add(link.person_id)
    by_object = {}
    for copy in copies:
        if copy.medium == "database":
            key = content_hash([copy.locator.get("table"), copy.locator.get("pk")])
            by_object.setdefault(key, []).append(copy)
    rows, index = [], {}
    for table in sorted(Base.metadata.tables.values(), key=lambda t: t.name):
        if table.name in {"managed_copies", "copy_subjects"}:
            continue  # Registry is observed independently, not recursively registered.
        query = select(table)
        if postgres:
            digest = func.encode(
                func.sha256(
                    func.convert_to(
                        cast(func.to_jsonb(table.table_valued()), Text), "UTF8"
                    )
                ),
                "hex",
            ).label("_canonical_hash")
            query = select(table, digest)
        for raw in session.execute(query).mappings():
            payload = normalized(dict(raw))
            digest = payload.pop("_canonical_hash", None)
            pk = {c.name: payload[c.name] for c in table.primary_key}
            account_refs = account_references(session, payload.get("scope_id"), payload)
            entry = {
                "table": table.name,
                "object": content_hash([table.name, pk]),
                "hash": digest or content_hash(payload),
                "payload": payload,
                "people": {p for _, p in typed_values(payload, {"person_id"})}
                | {p for ref in account_refs for p in ref["person_ids"]},
                "accounts_unresolved": any(not ref["resolved"] for ref in account_refs),
                "scopes": {payload["scope_id"]} if payload.get("scope_id") else set(),
                "parents": [],
                "control": table.name in CONTROL,
            }
            rows.append(entry)
            for key, value in payload.items():
                if isinstance(value, str | int):
                    index.setdefault((table.name, key, value), []).append(entry)
    for row in rows:
        table = Base.metadata.tables[row["table"]]
        for constraint in table.foreign_key_constraints:
            elements = list(constraint.elements)
            if not elements:
                continue
            first = elements[0]
            for parent in index.get(
                (
                    first.column.table.name,
                    first.column.name,
                    row["payload"][first.parent.name],
                ),
                [],
            ):
                if all(
                    parent["payload"][e.column.name] == row["payload"][e.parent.name]
                    for e in elements
                ):
                    if (row["table"], parent["table"]) in {
                        ("staff_timeline", "profiles"),
                        ("schedule_assignments", "schedules"),
                    }:
                        parent["parents"].append(row)
                    else:
                        row["parents"].append(parent)
        for key, value in typed_values(row["payload"], set(LOGICAL)):
            reference = logical_target(row, key)
            if reference is None:
                continue
            target, column = reference
            if target != row["table"] or key == "source_publication_id":
                parents = index.get((target, column, value), [])
                if key == "source_publication_id":
                    parents = [
                        p
                        for p in parents
                        if p["object"] != row["object"]
                        and p["payload"].get("scope_id")
                        == row["payload"].get("scope_id")
                        and p["payload"].get("period_key")
                        == row["payload"].get("period_key")
                        and isinstance(p["payload"].get("version"), int)
                        and isinstance(row["payload"].get("version"), int)
                        and p["payload"]["version"] < row["payload"]["version"]
                    ]
                    if len(parents) != 1:
                        schema_issues.append(
                            {
                                "object": row["object"],
                                "reason": "invalid_publication_lineage",
                            }
                        )
                row["parents"].extend(parents)
    changed = True
    while changed:
        changed = False
        for row in rows:
            for parent in row["parents"]:
                old = (set(row["people"]), set(row["scopes"]))
                row["people"].update(parent["people"])
                row["scopes"].update(parent["scopes"])
                changed |= old != (row["people"], row["scopes"])
    copy_plan_ids = {
        r["payload"]["plan_id"] for r in rows if r["table"] == "copy_erasures"
    }
    issues, observations, controls, known = list(schema_issues), [], [], set()
    for row in rows:
        if row["scopes"] and not any(
            _scope_matches(scope, value) for value in row["scopes"]
        ):
            continue
        if row["payload"].get("facility_id") not in (None, scope.split("/")[0]):
            continue
        observed = {k: row[k] for k in ("table", "object", "hash")}
        observed["person_ids"] = sorted(row["people"])
        retained_receipt = (
            row["table"] == "planning_receipts"
            and row["payload"].get("response", {}).get("plan_id") in copy_plan_ids
        )
        retained_event = row["table"] == "planning_outbox" and row["payload"].get(
            "kind", ""
        ).startswith(("copy.", "erasure."))
        if row["control"] or retained_receipt or retained_event:
            controls.append(observed)
            continue
        known.add(row["object"])
        matches = by_object.get(row["object"], [])
        observed["copy_ids"] = sorted(c.copy_id for c in matches)
        observations.append(observed)
        if len(matches) != 1:
            issues.append(
                {
                    "object": row["object"],
                    "reason": (
                        "missing_registration"
                        if not matches
                        else "duplicate_registration"
                    ),
                }
            )
            continue
        copy = matches[0]
        if copy.locator.get("retained_control"):
            controls.append(observed)
            observations.pop()
            continue

        def issue(reason, _row=row, _copy=copy, **extra):
            issues.append(
                {
                    "object": _row["object"],
                    "copy_id": _copy.copy_id,
                    "reason": reason,
                    **extra,
                }
            )

        if copy.state in {"ERASED", "DELETED"}:
            issue("erased_database_row_reappeared")
        if not _scope_matches(scope, copy.scope_id):
            issue("registry_scope_mismatch")
        if postgres and (
            copy.locator.get("hash_scheme") != "postgres-jsonb-sha256-v1"
            or copy.content_hash != row["hash"]
        ):
            issue("database_hash_mismatch")
        missing_people = row["people"] - links.get(copy.copy_id, set())
        if missing_people:
            issue(
                "missing_subject_reference", missing_person_ids=sorted(missing_people)
            )
        if row["accounts_unresolved"]:
            issue("unresolved_account_reference")
        if not row["scopes"]:
            issue("unclassified_scope")
        # Exact-hash review may add prose owners; it cannot remove structured ones.
        from shift_scheduler.domain.planning import Evidence
        from shift_scheduler.validation.work_accounting import verified

        try:
            reviewed = (
                copy.subject_status == "VERIFIED"
                and copy.evidence.get("reviewed_content_hash") == copy.content_hash
                and verified(
                    Evidence.model_validate(
                        {
                            k: v
                            for k, v in copy.evidence.items()
                            if k in Evidence.model_fields
                        }
                    ),
                    datetime.now(UTC),
                )
            )
        except ValueError:
            reviewed = False
        if not reviewed or not row["people"]:
            issue("subject_review_required")
    for copy in copies:
        if (
            copy.medium != "database"
            or not _scope_matches(scope, copy.scope_id)
            or copy.locator.get("retained_control")
        ):
            continue
        key = content_hash([copy.locator.get("table"), copy.locator.get("pk")])
        if key not in known and copy.state not in {"ERASED", "DELETED"}:
            issues.append(
                {
                    "copy_id": copy.copy_id,
                    "reason": "registered_database_source_missing",
                }
            )
    if not postgres:
        issues.append({"reason": "postgresql_canonical_hashes_unmeasured"})
    return {
        "complete": not issues,
        "dialect": session.bind.dialect.name,
        "rows": sorted(observations, key=lambda x: x["object"]),
        "retained_controls": sorted(controls, key=lambda x: x["object"]),
        "issues": sorted(issues, key=content_hash),
    }


def _safe_file_hash(root, relative):
    # Descriptor-relative traversal prevents a parent-directory swap from reading
    # unrelated user files while reconciliation is in progress.
    parts = Path(relative).parts
    if (
        not parts
        or any(p in {".", ".."} for p in parts)
        or Path(relative).is_absolute()
    ):
        raise ValueError("Unsafe managed object path")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
            )
            os.close(directory)
            directory = child
        fd = os.open(
            parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory
        )
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Nonregular managed object")
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
            after = os.fstat(stream.fileno())
            if (before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
            ):
                raise ValueError("Object changed during observation")
            return digest
    finally:
        os.close(directory)


def file_observation(session, scope):
    """Scan only explicit managed root; never follow links or discover user folders."""
    from shift_scheduler.application.copies import storage_root

    try:
        root = storage_root()
    except (ValueError, OSError):
        return {
            "complete": False,
            "files": [],
            "issues": [{"reason": "managed_root_unconfigured_or_unavailable"}],
        }
    # Root is shared across scopes: classify all registered paths, but do not expose
    # another facility's path/hash. Unknown bytes cannot be assigned a facility.
    expected, issues, files = {}, [], []
    for copy in session.scalars(
        select(ManagedCopy).where(ManagedCopy.medium.in_(("file", "backup")))
    ):
        for kind, path in [
            ("content", copy.locator.get("relative_path")),
            ("staging", copy.locator.get("staging_path")),
            (
                "lock",
                (
                    ".lock-" + copy.copy_id
                    if copy.evidence.get("writer_format") == 1
                    else None
                ),
            ),
        ]:
            if path:
                expected.setdefault(path, []).append((copy, kind))
    seen = set()
    for path in sorted(root.rglob("*")):
        if path.is_dir() and not path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        seen.add(relative)
        registrations = expected.get(relative, [])
        if registrations and all(
            not _scope_matches(scope, c.scope_id) for c, _ in registrations
        ):
            continue
        if path.is_symlink():
            issues.append({"path": relative, "reason": "symlink_in_managed_root"})
            continue
        try:
            digest = _safe_file_hash(root, relative)
        except (OSError, ValueError):
            issues.append({"path": relative, "reason": "unreadable_or_changing_object"})
            continue
        files.append({"path": relative, "hash": digest})
        if len(registrations) != 1:
            issues.append(
                {
                    "path": relative,
                    "reason": (
                        "unregistered_file"
                        if not registrations
                        else "multiple_file_registrations"
                    ),
                }
            )
            continue
        copy, kind = registrations[0]
        if kind == "lock":
            if digest != hashlib.sha256(b"").hexdigest():
                issues.append(
                    {"path": relative, "reason": "lock_contains_unregistered_content"}
                )
            continue
        if kind == "staging":
            issues.append({"copy_id": copy.copy_id, "reason": "staging_copy_remaining"})
        elif copy.state in {"ERASED", "DELETED"}:
            issues.append({"copy_id": copy.copy_id, "reason": "erased_file_reappeared"})
        if digest != copy.content_hash:
            issues.append({"copy_id": copy.copy_id, "reason": "file_hash_mismatch"})
    for relative, registrations in expected.items():
        for copy, kind in registrations:
            if not _scope_matches(scope, copy.scope_id) or kind != "content":
                continue
            if copy.state == "PRESENT" and relative not in seen:
                issues.append(
                    {"copy_id": copy.copy_id, "reason": "registered_file_missing"}
                )
            if copy.state not in {"PRESENT", "ERASED", "DELETED"}:
                issues.append(
                    {
                        "copy_id": copy.copy_id,
                        "reason": "file_operation_unfinished",
                        "state": copy.state,
                    }
                )
    return {
        "complete": not issues,
        "files": files,
        "issues": sorted(issues, key=content_hash),
    }


def _delta(before, after, key):
    a, b = {v[key]: v["hash"] for v in before}, {v[key]: v["hash"] for v in after}
    return {
        "added": sorted(b.keys() - a.keys()),
        "removed": sorted(a.keys() - b.keys()),
        "changed": sorted(k for k in a.keys() & b.keys() if a[k] != b[k]),
    }


def reconcile(session, scope, previous=None):
    """Actual observations, not trusted caller claims. Previous is for display only."""
    database, files = database_observation(session, scope), file_observation(
        session, scope
    )
    residuals = []
    for copy in session.scalars(select(ManagedCopy)):
        if not _scope_matches(scope, copy.scope_id) or copy.state in {
            "ERASED",
            "DELETED",
        }:
            continue
        if copy.medium in {"external", "backup"}:
            residuals.append(
                {
                    "copy_id": copy.copy_id,
                    "medium": copy.medium,
                    "state": copy.state,
                    "reason": (
                        (
                            "external_confirmation_recorded_not_locally_verified"
                            if copy.state == "EXTERNAL_CONFIRMED"
                            else "external_processing_unconfirmed"
                        )
                        if copy.medium == "external"
                        else "backup_generation_remaining"
                    ),
                }
            )
    # These stores are outside this observer; do not turn missing configuration
    # into evidence of absence. Control/media need their own authenticated observer.
    unobserved = [
        "configured_replica_discovery",
        "independent_control_stores",
        "wal_and_physical_media",
        "unregistered_external_handoffs",
    ]
    source_directory = Path(__file__).parent
    source_files = (
        "storage_reconciliation.py",
        "copy_coverage.py",
        "copy_graph.py",
        "subject_references.py",
        "storage_routes.py",
        "storage_routes.json",
    )
    code_hash = content_hash(
        {
            name: hashlib.sha256((source_directory / name).read_bytes()).hexdigest()
            for name in source_files
        }
    )
    configuration_hash = content_hash(
        {
            "scope": scope,
            "dialect": session.bind.dialect.name,
            "managed_storage": os.environ.get("PHARMSHIFT_MANAGED_STORAGE"),
        }
    )
    report = {
        "schema_version": 1,
        "code_hash": code_hash,
        "configuration_hash": configuration_hash,
        "scope_id": scope,
        "database": database,
        "managed_files": files,
        "residuals": sorted(residuals, key=lambda r: r["copy_id"]),
        "unobserved_domains": unobserved,
        "live_registered_stores_reconciled": database["complete"] and files["complete"],
        "subject_erasure_complete": False,
        "authority": "observation_only_no_erasure_authorization",
        "consistency": "observational_not_atomic_across_database_and_files",
    }
    if previous is not None:
        if (
            previous.get("scope_id") != scope
            or previous.get("schema_version") != 1
            or previous.get("code_hash") != code_hash
            or previous.get("configuration_hash") != configuration_hash
        ):
            raise ValueError(
                "Before/after observations require the same scope and schema"
            )
        report["delta"] = {
            "database": _delta(
                previous["database"]["rows"], database["rows"], "object"
            ),
            "managed_files": _delta(
                previous["managed_files"]["files"], files["files"], "path"
            ),
        }
    report["observation_hash"] = content_hash(report)
    return report
