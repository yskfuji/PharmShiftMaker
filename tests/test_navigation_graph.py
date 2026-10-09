"""The static navigation map (docs/architecture/navigation.md) follows the frontend source,
and every same-site link, page load and redirect target matches an existing route.

Regenerate with `python -m devtools.nav.graph --write`. Targets that are variables are
listed in the map and exercised by the browser crawl (remediation-e2e/navigation.spec.ts).
"""

from devtools.nav import graph


def test_the_navigation_map_is_current():
    assert (
        graph.OUT.read_text() == graph.markdown()
    ), "navigation.md is stale; regenerate it"


def test_no_link_or_redirect_points_to_a_missing_route():
    assert graph.dead() == []


def test_the_expected_routes_and_entrances_are_present():
    routes = {route for route, _ in graph.routes()}
    assert {
        "/planning/workflows",
        "/planning/workflows/[workflow]",
        "/settings",
        "/login",
    } <= routes
    targets = {row["path"] for row in graph.edges()}
    assert {"/planning/workflows", "/settings", "/login"} <= targets


def test_interpolated_suffix_is_unresolved_instead_of_a_fabricated_path():
    assert graph._normalise("/planning${query}") is None
    assert any(row["expression"] == "/planning${query}" for row in graph.variables())
    assert graph._normalise("/missing") == "/missing"
    assert graph.dead([{"source": "counterexample", "path": "/missing"}])


def test_next_link_object_pathnames_are_checked_as_static_edges():
    dashboard = [
        row
        for row in graph.edges()
        if row["source"].startswith("components/dashboard/LiveDashboard.tsx:")
    ]
    assert {row["path"] for row in dashboard} == {
        "/planning",
        "/planning/workflows/leave",
    }
    assert not any(
        row["source"].startswith("components/dashboard/LiveDashboard.tsx:")
        for row in graph.variables()
    )
    assert graph.dead(
        [{"source": "counterexample", "path": "/missing-object-pathname"}]
    )


def test_workspace_links_are_resolved_through_the_route_contract():
    known = graph.contract_routes()
    assert known["plan/input"] == "/workspace/plan/input"
    assert known["home/index"] == "/workspace/home"
    source = """
// A comment naming routeOf("people/contracts").route is not a destination.
<WorkspaceLink className="x" route={routeOf("plan/input").route}>a</WorkspaceLink>
const LINKS = [{ route: routeOf( 'governance/audit' ).route }];
browserNavigation.replaceWithFlash(workspaceHrefWithContext(routeOf("schedule/index").route, {}), "f");
<WorkspaceLink route={routeOf("plan/no-such-view").route}>b</WorkspaceLink>
  redirect(routeOf("home/index").route);
"""
    rows = graph.contract_edges(source, "counterexample.tsx")
    assert [(row["source"], row["kind"], row["path"]) for row in rows] == [
        ("counterexample.tsx:3", "link", "/workspace/plan/input"),
        ("counterexample.tsx:4", "link", "/workspace/governance/audit"),
        ("counterexample.tsx:5", "document", "/workspace/schedule"),
        ("counterexample.tsx:6", "link", "<no workspace route plan/no-such-view>"),
        ("counterexample.tsx:7", "server-redirect", "/workspace/home"),
    ]
    # A key the contract does not have is a dead link, as a mistyped URL would be.
    assert [row["path"] for row in graph.dead(rows)] == [
        "<no workspace route plan/no-such-view>"
    ]


def test_the_workspace_links_of_the_source_appear_in_the_navigation_map():
    edges = {(row["source"].rsplit(":", 1)[0], row["path"]) for row in graph.edges()}
    assert {
        ("features/workspace/planning/input/InputView.tsx", "/workspace/plan/generate"),
        ("features/workspace/home/HomeQueue.tsx", "/workspace/operations/cases"),
        (
            "features/workspace/people/directory/PersonDetail.tsx",
            "/workspace/people/memberships",
        ),
        ("features/workspace/planning/drafts/DraftEditor.tsx", "/workspace/schedule"),
    } <= edges
    # A WorkspaceLink whose route is computed is listed as decided at run time; the
    # literal routes it chooses from are edges of the file that computes them.
    dynamic = {
        (row["source"].rsplit(":", 1)[0], row["expression"])
        for row in graph.variables()
    }
    assert (
        "features/workspace/people/lifecycle/LifecycleTasks.tsx",
        "taskRoute(t.key)",
    ) in dynamic
    assert (
        "features/workspace/people/lifecycle/LifecycleTasks.tsx",
        "/workspace/people/contracts",
    ) in edges
    # No link of the workspace is written as a free URL any more.
    assert not any(
        row["source"].startswith("features/workspace/shell/WorkspaceLink.tsx")
        and row["kind"] == "link"
        for row in graph.edges()
    )
