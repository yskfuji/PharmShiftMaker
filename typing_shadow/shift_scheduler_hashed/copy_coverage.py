# Type-annotated copy of src/shift_scheduler/application/copy_coverage.py for strict mypy.
# The original's bytes are hashed into the restore policy_hash / reconcile
# code_hash, so it must not change. tests/test_type_shadow.py checks that this
# copy has the same logic (annotations, casts and imports removed), the same
# imports in the same scope and order (plus typing-only additions) and the same
# signatures as the .pyi stub, and runs strict mypy on it. Do not reorder imports.
"""Reviewed storage inventory. Coverage is not evidence of erasure completion."""
import json
from pathlib import Path
from typing import Any
from shift_scheduler.application.hashed_types import Coverage, Observation

from sqlalchemy.orm import Session

from shift_scheduler.db.base import Base


def coverage(session: Session | None = None, scope: str | None = None) -> Coverage:
    from shift_scheduler.application.storage_routes import inspect_routes
    routes = inspect_routes()
    declared = json.loads(Path(__file__).with_name("copy_schema_inventory.json").read_text())
    actual = {name: sorted(table.columns.keys()) for name, table in Base.metadata.tables.items()}
    missing = sorted(set(actual) - set(declared))
    obsolete = sorted(set(declared) - set(actual))
    changed = sorted(name for name in actual.keys() & declared.keys()
                     if actual[name] != declared[name]["columns"])
    observation = None
    if session is not None:
        if not scope:
            raise ValueError("Live storage reconciliation requires an authorized scope")
        from shift_scheduler.application.storage_reconciliation import reconcile
        observation = reconcile(session, scope)
    unresolved = runtime_requirements(observation)
    return {"schema_covered": not (missing or obsolete or changed),
            "missing_tables": missing, "obsolete_tables": obsolete,
            "changed_tables": changed, "database_policies": declared,
            "storage_routes": routes,
            "all_storage_complete": not (missing or obsolete or changed or routes["issues"] or unresolved),
            "unverified_storage_paths": routes["issues"] + unresolved,
            "runtime_observed": observation is not None,
            "live_registered_stores_reconciled": bool(observation and observation["live_registered_stores_reconciled"]),
            "subject_erasure_complete": False,
            "runtime_issues": ({"database": observation["database"]["issues"],
                                "managed_files": observation["managed_files"]["issues"]} if observation else {}),
            "boundary": "Schema and producer declarations do not prove subject ownership or runtime reconciliation"}


def runtime_requirements(observation: Observation | None = None) -> list[str]:
    if observation is None:
        return ["database_not_observed", "managed_files_not_observed", "other_stores_not_observed"]
    issues = []
    if not observation["database"]["complete"]:
        issues.append("database_reconciliation_incomplete")
    if not observation["managed_files"]["complete"]:
        issues.append("managed_file_reconciliation_incomplete")
    return issues + ["unobserved:" + domain for domain in observation["unobserved_domains"]]


def require_schema_coverage() -> Coverage:
    result = coverage()
    if not result["schema_covered"]:
        raise ValueError("Copy schema inventory changed; review storage policy before erasure")
    return result
