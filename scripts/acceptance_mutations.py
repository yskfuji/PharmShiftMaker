"""Focused counterexamples for effective observers, HR series and persistence timing."""

import sys

from scripts.remediation_mutations import run_mutations

MUTATIONS = [
    (
        "historical-observer-leak",
        "validation/work_accounting.py",
        "allocated = union_allocation(observer_index, origins, r)",
        'allocated = union_allocation(observer_index, {own_rows[0]["employment"].week_start}, r)',
        "tests/test_work_revision_accounting.py::test_agreement_observer_uses_effective_revision_not_first_old_duty",
    ),
    (
        "incomplete-hr-series",
        "validation/leave_entitlement.py",
        "{a.account_id for a in members} != set(assessment.cycle_account_ids)",
        "False",
        "tests/test_leave_entitlement.py::test_complete_split_series_reconciliation_preserves_original_lots",
    ),
    (
        "precommit-as-durable",
        "application/planning.py",
        "completed_at=datetime.now(UTC),",
        "completed_at=datetime.now(UTC), persisted_observed_at=datetime.now(UTC),",
        "tests/test_commit_observation.py::test_crash_after_result_commit_leaves_missing_observation_explicit",
    ),
    (
        "retained-reference-bypass",
        "application/database_erasure.py",
        "candidates[key]['blockers'].append('retained_database_references')",
        "pass",
        "tests/test_database_erasure_postgres.py::test_unreviewed_child_and_late_hold_prevent_deletion",
    ),
    (
        "week-transition-reset",
        "validation/work_accounting.py",
        "origins.add(before.week_start)",
        "pass",
        "tests/test_work_revision_accounting.py::test_same_agreement_week_transition_has_disjoint_trace_and_full_windows",
    ),
    (
        "shared-person-retained",
        "application/shared_projection.py",
        'if r["person_id"] != person',
        "if True",
        "tests/test_shared_projection.py::test_projection_preserves_other_records_without_making_a_solver_input",
    ),
    (
        "missing-preservation-gate-bypass",
        "ops/erasure_replay.py",
        'raise ValueError(\n                "Required preserved history is missing or changed; keep restore quarantined"\n            )',
        "continue",
        "tests/test_shared_projection.py::test_shared_source_atomic_preservation_and_restore_gate",
    ),
]
if __name__ == "__main__":
    run_mutations(sys.argv[1], MUTATIONS)
