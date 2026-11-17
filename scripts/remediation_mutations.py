"""Run specified faults against copied source, leaving the working application intact."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "audit/remediation-2026-09-22/mutations-r1"
MUTATIONS = [
    (
        "contract-order",
        "validation/work_accounting.py",
        'employer_order.get(r["employment"].employer_id, 0) if r["scheduled"] else 0',
        "0",
        "tests/test_compliance_v2.py::test_contract_order_reversal_changes_payer",
    ),
    (
        "daily-weekly-double-count",
        "validation/work_accounting.py",
        "ordinary = seconds - daily\n            week = day - timedelta(",
        "ordinary = seconds\n            week = day - timedelta(",
        "tests/test_compliance_v2.py::test_daily_weekly_excess_not_double_counted",
    ),
    (
        "candidate-omission",
        "validation/v3_inputs.py",
        "if actual != expected:",
        "if False:",
        "tests/test_catalogue_v3.py::test_candidate_deletion_is_detected_even_with_old_complete_flag",
    ),
    (
        "restored-file-resurrection",
        "ops/managed_erasure.py",
        "    parts=Path(relative).parts",
        "    return False\n    parts=Path(relative).parts",
        "tests/test_managed_copies.py::test_signed_restore_manifest_reapplies_managed_file_erasure",
    ),
    (
        "grant-correction-lost",
        "validation/leave_history.py",
        'update={"granted_days": current_days, "statutory_days": current_statutory}',
        'update={"granted_days": account.granted_days, "statutory_days": current_statutory}',
        "tests/test_compliance_v3.py::test_effective_and_known_time_do_not_erase_taken_leave",
    ),
]


def run_mutations(target, mutations):
    target = Path(target).resolve()
    if target.exists():
        raise ValueError("Use a fresh mutation run directory")
    target.mkdir(parents=True)
    summary = []
    for name, module, old, new, selected in mutations:
        with tempfile.TemporaryDirectory(prefix="pharmshift-mutation-") as directory:
            temporary = Path(directory)
            shutil.copytree(
                ROOT / "src",
                temporary / "src",
                ignore=shutil.ignore_patterns("__pycache__"),
            )
            source_file = temporary / "src/shift_scheduler" / module
            source = source_file.read_text()
            if source.count(old) != 1:
                raise ValueError("Mutation anchor is absent or ambiguous: " + name)
            source_file.write_text(source.replace(old, new))
            shutil.copy2(ROOT / "alembic.ini", temporary / "alembic.ini")
            shutil.copytree(
                ROOT / "alembic",
                temporary / "alembic",
                ignore=shutil.ignore_patterns("__pycache__"),
            )
            env = {
                **os.environ,
                "PYTHONPATH": str(temporary / "src") + os.pathsep + str(ROOT),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            # Verify that the tested package resolves to the copied, mutated source.
            resolved = subprocess.check_output(
                [
                    sys.executable,
                    "-c",
                    "import shift_scheduler; print(shift_scheduler.__file__)",
                ],
                cwd=temporary,
                env=env,
                text=True,
            ).strip()
            if not resolved.startswith(str(temporary)):
                raise ValueError("Mutation source was not imported")
            junit = target / (name + ".xml")
            with (target / (name + ".txt")).open("w") as log:
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "pytest",
                        "-c",
                        str(ROOT / "pyproject.toml"),
                        "--no-cov",
                        "-q",
                        str(ROOT / selected),
                        "--junitxml=" + str(junit),
                    ],
                    cwd=temporary,
                    env=env,
                    stdout=log,
                    stderr=log,
                )
            suites = list(ET.parse(junit).getroot().iter("testsuite"))
            failures = sum(int(s.get("failures", 0)) for s in suites)
            errors = sum(int(s.get("errors", 0)) for s in suites)
            summary.append(
                {
                    "mutation": name,
                    "test": selected,
                    "exit_code": result.returncode,
                    "assertion_failures": failures,
                    "errors": errors,
                    "detected": failures > 0 and errors == 0 and result.returncode == 1,
                }
            )
    (target / "results.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    if not all(row["detected"] for row in summary):
        raise SystemExit(1)


def main():
    run_mutations(TARGET, MUTATIONS)


if __name__ == "__main__":
    main()
