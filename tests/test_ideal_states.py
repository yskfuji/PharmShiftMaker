"""The generated state diagrams follow the code: every (from, to) status change the code
makes is an edge of its own transition table, and every table edge is made somewhere."""

import ast
from pathlib import Path

from devtools.er import states

from shift_scheduler.application import ideal_workflows

SOURCE = Path(ideal_workflows.__file__).read_text()
OUT = Path(__file__).resolve().parents[1] / "docs" / "architecture" / "er"


# Which transition table each status-changing function belongs to.
MACHINE_OF = {"change": "CHANGE_TRANSITIONS", "lifecycle": "LIFECYCLE_TRANSITIONS"}
# complete_lifecycle_task has no status guard: once every task is completed the case is
# READY and completing any task again is a Conflict, so it only ever starts IN_PROGRESS.
IMPLIED_FROM = {"complete_lifecycle_task": {"IN_PROGRESS"}}


def outcomes(node: ast.AST) -> set[str]:
    """The strings an expression can produce, not strings inside its conditions."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        return outcomes(node.body) | outcomes(node.orelse)
    return set()


def is_status(target: ast.AST) -> bool:
    return (isinstance(target, ast.Name) and target.id == "status") or (
        isinstance(target, ast.Attribute) and target.attr == "status"
    )


def code_edges() -> dict[str, set[tuple[str, str]]]:
    """(from, to) per table: `to` is every status a function assigns (keyword or
    assignment, to a name or an attribute); `from` is START for create_*, else the
    states its `.status` guards compare against (`!=`, `==`, `in`, `not in`)."""
    edges: dict[str, set[tuple[str, str]]] = {m: set() for m in MACHINE_OF.values()}
    for fn in ast.parse(SOURCE).body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        to: set[str] = set()
        guards: set[str] = set()
        for node in ast.walk(fn):
            if isinstance(node, ast.keyword) and node.arg == "status":
                to |= outcomes(node.value)
            if isinstance(node, ast.Assign) and any(map(is_status, node.targets)):
                to |= outcomes(node.value)
            if isinstance(node, ast.Compare) and is_status(node.left):
                for c in node.comparators:
                    # `status != "X"` and `status not in ("X", "Y")`
                    items = (
                        c.elts if isinstance(c, ast.Tuple | ast.List | ast.Set) else [c]
                    )
                    guards |= {
                        e.value
                        for e in items
                        if isinstance(e, ast.Constant) and isinstance(e.value, str)
                    }
        if not to:
            continue
        machine = next(t for k, t in MACHINE_OF.items() if k in fn.name)
        start = (
            {"START"}
            if fn.name.startswith("create_")
            else IMPLIED_FROM.get(fn.name, guards)
        )
        assert start, f"{fn.name} changes a status without a guard"
        edges[machine] |= {(a, b) for a in start for b in to}
    return edges


def test_every_code_transition_is_in_its_table_and_back():
    for machine, found in code_edges().items():
        table = {(a, b) for a, b, _ in getattr(ideal_workflows, machine)}
        assert found == table, machine


def test_membership_transitions_match_the_active_flag_changes():
    # Membership has no status column; its states are row.active. Deactivating an
    # inactive membership is refused, so there is no INACTIVE -> INACTIVE edge.
    table = {(a, b) for a, b, _ in ideal_workflows.MEMBERSHIP_TRANSITIONS}
    assert ("INACTIVE", "INACTIVE") not in table
    assert 'raise planning.Conflict("Membership is already inactive")' in SOURCE


def test_state_diagrams_are_current_and_accessible():
    text = (OUT / states.NAME).read_text()
    assert text == states.markdown(), "ideal-states.md is stale; regenerate it"
    assert (
        text.count("accTitle:")
        == len(states.MACHINES)
        == text.count("| 遷移前 | 遷移後 | 条件 |")
    )
