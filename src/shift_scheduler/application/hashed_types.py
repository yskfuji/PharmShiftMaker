"""Result types of the hash-pinned storage modules (declarations only).

copy_coverage, storage_routes, storage_reconciliation, subject_references,
copy_graph and control/restore_verification are hashed into the restore
policy_hash / reconcile code_hash, so their bytes cannot carry annotations.
Their .pyi stubs and the annotated copies in typing_shadow share these
definitions. This module must contain type declarations only
(tests/test_type_shadow.py checks it).
"""

from typing import Any, Literal, NotRequired, TypedDict


class AccountReference(TypedDict):
    """An account identifier found in a document, with the people it may name."""

    path: list[str | int]
    role: str
    person_ids: list[str]
    resolved: bool


class RouteInventory(TypedDict):
    """Registered storage write routes compared with the routes found in the source."""

    reviewed: bool
    issues: list[str]
    routes: dict[str, dict[str, Any]]
    classified: NotRequired[bool]
    classification_counts: NotRequired[dict[str, int]]
    unclassified: NotRequired[list[str]]
    missing: NotRequired[list[str]]
    obsolete: NotRequired[list[str]]
    pending: NotRequired[list[str]]
    boundary: NotRequired[str]


class DatabaseObservation(TypedDict):
    complete: bool
    dialect: str
    rows: list[dict[str, Any]]
    retained_controls: list[dict[str, Any]]
    issues: list[dict[str, Any]]


class FileObservation(TypedDict):
    complete: bool
    files: list[dict[str, Any]]
    issues: list[dict[str, Any]]


class Observation(TypedDict):
    """One reconciliation of the registered stores (observation only)."""

    schema_version: int
    code_hash: str
    configuration_hash: str
    scope_id: str
    database: DatabaseObservation
    managed_files: FileObservation
    residuals: list[dict[str, Any]]
    unobserved_domains: list[str]
    live_registered_stores_reconciled: bool
    subject_erasure_complete: Literal[False]
    authority: str
    consistency: str
    delta: NotRequired[dict[str, dict[str, list[Any]]]]
    # Always set by reconcile(); optional only while the report is being built.
    observation_hash: NotRequired[str]


class Coverage(TypedDict):
    """Schema and write-route coverage; not evidence that an erasure is complete."""

    schema_covered: bool
    missing_tables: list[str]
    obsolete_tables: list[str]
    changed_tables: list[str]
    database_policies: dict[str, dict[str, Any]]
    storage_routes: RouteInventory
    all_storage_complete: bool
    unverified_storage_paths: list[str]
    runtime_observed: bool
    live_registered_stores_reconciled: bool
    subject_erasure_complete: Literal[False]
    runtime_issues: dict[str, list[dict[str, Any]]]
    boundary: str


class TargetDescription(TypedDict):
    target_hash: str
    policy_hash: str
    domains: list[str]
