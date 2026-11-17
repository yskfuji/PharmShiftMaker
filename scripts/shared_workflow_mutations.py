"""Bounded anti-regression probes, on copied code only."""

import sys

from scripts.remediation_mutations import run_mutations

MUTATIONS = [
    (
        "schema-coverage-bypass",
        "application/copy_coverage.py",
        'if not result["schema_covered"]:',
        "if False:",
        "tests/test_shared_storage_coverage.py::test_new_table_and_field_require_inventory_review",
    ),
    (
        "superseded-control-bypass",
        "ops/erasure_control.py",
        'raise ValueError("Restore control is missing, stale or superseded")',
        "pass",
        "tests/test_erasure_control.py::test_replay_rejects_old_manifest_and_tampered_control",
    ),
    (
        "second-subject-retained",
        "application/shared_projection.py",
        'retained["people"] = [p for p in people if p["person_id"] != person]',
        'retained["people"] = people',
        "tests/test_shared_storage_coverage.py::test_planning_projection_keeps_only_actual_other_person_assignments",
    ),
    (
        "file-fault-never-retried",
        "application/copies.py",
        'row.state = "RETRY_WAIT"',
        'row.state = "CHANGED"',
        "tests/test_coupled_erasure_faults.py::test_shared_database_then_file_failure_retry_and_restore",
    ),
]
if __name__ == "__main__":
    run_mutations(sys.argv[1], MUTATIONS)
