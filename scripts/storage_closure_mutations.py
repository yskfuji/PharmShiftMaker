"""Targeted negative controls, executed only against temporary source copies."""

import sys

from scripts.remediation_mutations import run_mutations

MUTATIONS = [
    (
        "witness-checkpoint-bypass",
        "control/witness.py",
        'if checkpoint["pending"] or checkpoint["digest"] != before:',
        "if False:",
        "tests/test_generation_witness.py::test_authority_rollback_blocks_status_manifest_and_restore_release",
    ),
    (
        "file-after-image-hash-bypass",
        "ops/managed_writer.py",
        "if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:\n                        raise Conflict(\"Published after-image was changed\")",
        'if False:\n                        raise Conflict("Published after-image was changed")',
        "tests/test_managed_writer.py::test_changed_after_image_never_becomes_available",
    ),
    (
        "actor-partition-leak",
        "application/shared_subject_record.py",
        'del cursor[ref["path"][-1]]',
        "pass  # deliberately retain account in another subject body",
        "tests/test_shared_subject_record.py::test_body_subject_and_actor_are_preserved_separately",
    ),
    (
        "import-preview-binding-bypass",
        "api/routers/compliance.py",
        'if inspected["preview_hash"] != request.payload["preview_hash"]:',
        "if False:",
        "tests/test_actual_file_import.py::test_bad_row_rejects_whole_preview_and_changed_source_rejects_commit",
    ),
]

if __name__ == "__main__":
    run_mutations(sys.argv[1], MUTATIONS)
