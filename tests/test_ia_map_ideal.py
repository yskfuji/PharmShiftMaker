"""The IA map follows the ideal screens into their API client (they are not unmapped)."""

from devtools.er import ia_map


def test_ideal_routes_reach_their_api_calls():
    imports, calls = ia_map.graph()
    pages = ia_map.routes()

    def reach(start: str) -> set[str]:
        seen, todo = set(), [start]
        while todo:
            node = todo.pop()
            if node not in seen:
                seen.add(node)
                todo += sorted(imports.get(node, ()))
        return seen

    # /preview is the v1/v2 compatibility route: it reaches its calls through the earlier
    # monolithic workspace and the screens under ideal/screens.
    preview = reach(pages["/preview/[screen]"])
    apis = set().union(*(calls.get(p, set()) for p in preview))
    assert "/planning/scopes" in apis
    assert "/planning/publications" in apis
    assert "components/ideal/IdealWorkspace" in preview

    # /workspace reaches the same calls, and each route's own, through its route
    # definitions only: nothing under ideal/screens and no established component.
    for route in ("/workspace/[screen]", "/workspace/[screen]/[view]"):
        workspace = reach(pages[route])
        apis = set().union(*(calls.get(p, set()) for p in workspace))
        assert "/planning/scopes" in apis
        assert "/planning/publications" in apis
        assert "/planning/plan-comparison" in apis
        assert "features/workspace/shell/routes" in workspace
        assert not [node for node in workspace if node.startswith("ideal/screens/")]
        assert "components/ideal/IdealWorkspace" not in workspace


def test_workspace_purpose_adapters_are_mapped_to_their_handlers():
    """features/workspace/**/api.ts call the transport of the client they are given."""
    _, calls = ia_map.graph()
    assert calls["features/workspace/planning/api"] == {
        "/planning/compliance/workflow-context",
        "/planning/compliance/records/demand",
    }
    table = ia_map.handlers()
    assert ia_map._match("/planning/compliance/workflow-context", table) == [
        "GET compliance: workflow_context"
    ]
    # A literal call that names one value of a path parameter is that handler's.
    assert ia_map._match("/planning/compliance/records/demand", table) == [
        "POST compliance: save"
    ]
    # An exact template still wins over a parameterised one, and a dynamic call proves nothing.
    assert ia_map._match("/planning/compliance/records", table) == [
        "GET compliance: records"
    ]
    assert ia_map._match("/planning/compliance/records/{…}", table) == []


def test_the_planning_input_route_reaches_its_adapter():
    imports, _ = ia_map.graph()
    route = "features/workspace/planning/input/route"
    assert "features/workspace/planning/api" in imports[route]
    assert route in imports["features/workspace/shell/routes"]


def test_relative_imports_are_followed_however_far_they_climb():
    found = ia_map.IMPORT.findall("""
import a from "./near";
import { b } from "../up/one";
import type { C } from "../../up/two";
import d, { type E } from '../../../up/three/deep';
import "../../side/effect";
import f from "..";
import g from "../outside.json";
""")
    assert found == [
        "./near",
        "../up/one",
        "../../up/two",
        "../../../up/three/deep",
        "../../side/effect",
    ]


def test_moved_routes_reach_the_shell_and_the_shared_parts_two_levels_up():
    imports, calls = ia_map.graph()
    compare = imports["features/workspace/planning/compare/route"]
    assert {
        "features/workspace/shell/routeTypes",
        "features/workspace/shared/seed",
        "features/workspace/shared/noneWhenMissing",
    } <= compare
    # Through them a route island reaches the runtime, and with it the typed client's calls.
    island = imports["features/workspace/planning/compare/CompareDrafts"]
    assert "features/workspace/shell/WorkspaceRuntime" in island
    assert "features/workspace/shared/useSeededResource" in island

    def reach(start: str) -> set[str]:
        seen, todo = set(), [start]
        while todo:
            node = todo.pop()
            if node not in seen:
                seen.add(node)
                todo += sorted(imports.get(node, ()))
        return seen

    apis = set().union(
        *(calls.get(n, set()) for n in reach("features/workspace/shell/routes"))
    )
    assert "/planning/plan-comparison" in apis
