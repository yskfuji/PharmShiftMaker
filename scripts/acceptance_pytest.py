"""Acceptance test entry: skipped or empty tests cannot satisfy a required gate."""

import os
import sys

import pytest


class Evidence:
    def __init__(self):
        self.passed = 0
        self.skipped = 0
        self.deselected = 0

    def pytest_deselected(self, items):
        self.deselected += len(items)

    def pytest_runtest_logreport(self, report):
        if report.skipped:
            self.skipped += 1
        if report.when == "call" and report.passed:
            self.passed += 1


def main(argv=None):
    if os.environ.get("PYTEST_ADDOPTS"):
        print(
            "ACCEPTANCE_TEST_REJECTED: inherited PYTEST_ADDOPTS would alter the frozen test scope"
        )
        return 2
    evidence = Evidence()
    code = pytest.main(
        [*(sys.argv[1:] if argv is None else argv), "-q", "--no-cov", "-o", "addopts="],
        plugins=[evidence],
    )
    print(
        f"ACCEPTANCE_TEST_EVIDENCE passed={evidence.passed} skipped={evidence.skipped} deselected={evidence.deselected} exit={int(code)}"
    )
    return (
        int(code)
        if code
        else (
            0
            if evidence.passed and not evidence.skipped and not evidence.deselected
            else 1
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
