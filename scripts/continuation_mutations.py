"""Bounded regressions on copied code; failed collection is not a detected mutation."""

import sys

from scripts.remediation_mutations import run_mutations

MUTATIONS = [
    (
        "float-objective-rounding",
        "optimizer/planning.py",
        "value = int(solver.value(objective))",
        "value = int(round(solver.objective_value))",
        "tests/test_exact_objectives.py::test_public_solver_handles_large_normalization_without_model_invalid",
    ),
    (
        "borrow-disabled",
        "optimizer/exact_objectives.py",
        "model.new_int_var(-1, 0,",
        "model.new_int_var(0, 0,",
        "tests/test_exact_objectives.py::test_digit_representation_is_exact_for_every_assignment_including_borrows",
    ),
    (
        "leave-causality-lost",
        "validation/leave_history.py",
        "events, ordering_problems = chronological_events(events)",
        "ordering_problems = []",
        "tests/test_leave_chronology.py::test_causal_replay_of_reservation_take_reverse_independent_of_import_order",
    ),
    (
        "stale-grant-proof",
        "api/routers/compliance.py",
        "if request.input_hash != data.input_hash:",
        "if False:",
        "tests/test_grant_assessment_api.py",
    ),
    (
        "restore-subject-gate",
        "ops/erasure_replay.py",
        'if remaining["records"]:',
        "if False:",
        "tests/test_restore_subject_controls.py::test_unremoved_old_copy_keeps_restore_in_quarantine",
    ),
]

if __name__ == "__main__":
    run_mutations(sys.argv[1], MUTATIONS)
