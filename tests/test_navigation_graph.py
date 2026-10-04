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
