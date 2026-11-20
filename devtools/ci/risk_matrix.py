"""Check that every test referenced by docs/ci/risk-test-matrix.md exists.

A row lists pytest node IDs in backticks (``tests/file.py::test_name``). Each
must name an existing file that defines that test function at module level.

usage: python -m devtools.ci.risk_matrix [MATRIX]
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs" / "ci" / "risk-test-matrix.md"
NODE = re.compile(r"`(tests/[A-Za-z0-9_/]+\.py)::(test_[A-Za-z0-9_]+)`")
ROW = re.compile(r"^\| (R-\d+) \|")


def _defined_tests(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    }


def check(matrix: Path = MATRIX) -> list[str]:
    problems: list[str] = []
    rows = 0
    for line in matrix.read_text(encoding="utf-8").splitlines():
        row = ROW.match(line)
        if not row:
            continue
        rows += 1
        nodes = NODE.findall(line)
        if not nodes:
            problems.append(f"{row.group(1)}: no test listed")
        for file, name in nodes:
            path = ROOT / file
            if not path.is_file():
                problems.append(f"{row.group(1)}: missing file {file}")
            elif name not in _defined_tests(path):
                problems.append(f"{row.group(1)}: {file} has no {name}")
    if rows == 0:
        problems.append("no risk rows found")
    return problems


def main(argv: list[str]) -> int:
    problems = check(Path(argv[0]) if argv else MATRIX)
    for problem in problems:
        print(problem)
    print(f"risk matrix: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
