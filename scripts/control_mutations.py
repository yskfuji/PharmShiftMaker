"""Deliberate faults in temporary copies, never in the running application."""

import sys

from scripts.remediation_mutations import run_mutations

MUTATIONS = [
    (
        "pending-access-bypass",
        "control/service.py",
        "node.applied_generation == head.generation and not head.pending",
        "node.applied_generation == head.generation",
        "tests/test_control_authority.py::test_pending_stale_restore_changed_receipt_and_new_generation",
    ),
    (
        "fresh-nonce-bypass",
        "control/client.py",
        'if payload["nonce"] != nonce or payload["client_id"] != self.client_id:',
        "if False:",
        "tests/test_control_authority.py::test_replayed_nonce_invalid_signature_and_connection_failure_block",
    ),
    (
        "hold-metadata-tamper-bypass",
        "ops/erasure_replay.py",
        "any(getattr(existing, key) != val for key, val in value.items())",
        'existing.payload != value["payload"]',
        "tests/test_control_recovery.py::test_equal_revision_tampering_or_unlisted_hold_keeps_restore_blocked",
    ),
    (
        "actual-terms-cas-bypass",
        "api/routers/compliance.py",
        "if (old.revision if old else 0) != expected_terms:",
        "if False:",
        "tests/test_actual_revision_boundary.py::test_actual_terms_and_review_use_observed_versions",
    ),
    (
        "actual-current-revision-bypass",
        "application/planning.py",
        "if (latest.revision if latest else 0) != expected or revision != expected + 1:",
        "if False:",
        "tests/test_actual_revision_boundary.py::test_current_actual_revision_is_checked_and_legacy_write_closed",
    ),
]

if __name__ == "__main__":
    run_mutations(sys.argv[1], MUTATIONS)
