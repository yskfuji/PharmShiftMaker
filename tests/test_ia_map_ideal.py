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

    apis = set().union(
        *(calls.get(p, set()) for p in reach(pages["/preview/[screen]"]))
    )
    assert "/planning/scopes" in apis
    assert "/planning/publications" in apis
