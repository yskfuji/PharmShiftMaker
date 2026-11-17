"""Information-architecture map: screen route → components → API → server handler.

Read from the source text (frontend/src) and the FastAPI routes, so the map follows
the code. The handler column links the screens to the records described in
physical.mmd/logical.md (docs/architecture/er).

    python -m devtools.er.ia_map [--write | --check]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "src"
OUT = ROOT / "docs" / "architecture" / "er"
IMPORT = re.compile(
    r"""import\s+(?:type\s+)?(?:[\w{},\s*]+\s+from\s+)?['"](@/(?:components|hooks|lib|ideal)/[\w/]+|\./[\w/]+|\.\./[\w/]+)['"]"""
)
# `${API}/planning/...` in template literals, and the request('/…') helper of the planning
# transport (prefix /planning) in files that create one (PlanningWorkspace, ideal/api).
API_CALL = re.compile(r"\$\{(?:API|API_BASE_URL|API_BASE|BASE_URL)\}(/[\w\-/{}.$]+)")
PLANNING_READ = re.compile(r"""planningRead(?:<[^>]*>)?\(\s*[`'"](/[\w\-/{}.$]+)""")
REQUEST = re.compile(r"""request(?:<[^>]*>)?\(\s*[`'"](/[\w\-/{}.$]+)""")


def _component(path: Path) -> str:
    return str(path.relative_to(SRC)).removesuffix(".tsx").removesuffix(".ts")


def _resolve(base: Path, spec: str) -> Path | None:
    target = (
        SRC / spec.removeprefix("@/") if spec.startswith("@/") else (base.parent / spec)
    )
    for candidate in (
        target.with_suffix(".tsx"),
        target.with_suffix(".ts"),
        target / "index.tsx",
    ):
        if candidate.exists():
            return candidate.resolve()
    return None


def _normalise(path: str) -> str:
    # `${...}` pieces, including ones cut off by the pattern (e.g. `${encodeURIComponent(`), become {…}.
    path = re.sub(r"\$\{[^}]*(\}|$)", "{…}", path).split("?")[0].rstrip("/")
    return re.sub(r"\{…\}[\w\-]*", "{…}", path)


def graph() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    imports: dict[str, set[str]] = {}
    calls: dict[str, set[str]] = {}
    for file in sorted(SRC.rglob("*.ts*")):
        if "__tests__" in file.parts or file.name.endswith((".test.tsx", ".test.ts")):
            continue
        text = file.read_text()
        name = _component(file)
        imports[name] = {
            _component(p)
            for spec in IMPORT.findall(text)
            if (p := _resolve(file, spec))
        }
        found = {_normalise(p) for p in API_CALL.findall(text)}
        found |= {_normalise("/planning" + p) for p in PLANNING_READ.findall(text)}
        if "PlanningWorkspace" in name or "createPlanningTransport(" in text:
            found |= {_normalise("/planning" + p) for p in REQUEST.findall(text)}
        calls[name] = {p for p in found if p}
    return imports, calls


def routes() -> dict[str, str]:
    result = {}
    for page in sorted((SRC / "app").rglob("page.tsx")):
        rel = page.parent.relative_to(SRC / "app")
        route = "/" + "/".join(rel.parts) if rel.parts else "/"
        result[route] = _component(page)
    return result


def handlers() -> dict[tuple[str, str], str]:
    """Method and path → "tag: operation" from the OpenAPI description of the app."""
    from shift_scheduler.api.main import app

    found = {}
    for path, operations in app.openapi()["paths"].items():
        for method, op in operations.items():
            tag = ",".join(op.get("tags") or ["-"])
            # FastAPI's operationId is the function name + the path with non-word characters as "_" + method.
            name = op.get("operationId", "").removesuffix(
                re.sub(r"\W", "_", path) + "_" + method
            )
            found[(method.upper(), path)] = f"{tag}: {name}"
    return found


def _match(call: str, table: dict[tuple[str, str], str]) -> list[str]:
    if "{…}" in call:
        return []  # A dynamic template cannot prove a particular HTTP operation.
    pattern = re.compile("^" + re.escape(call).replace(re.escape("{…}"), "[^/]+") + "$")
    return sorted(
        {
            f"{m} {h}"
            for (m, p), h in table.items()
            if pattern.match(re.sub(r"\{[^}]+\}", "x", p)) or p == call
        }
    )


def match_observed(
    method: str, path: str, table: dict[tuple[str, str], str] | None = None
) -> dict:
    """Join a real, body-free HTTP observation to OpenAPI; ambiguity stays explicit."""
    table = handlers() if table is None else table
    method, path = method.upper(), path.split("?", 1)[0]
    if method == "OPTIONS":
        return {
            "state": "platform",
            "reason": "CORS preflight is not a business operation",
        }
    exact = table.get((method, path))
    if exact:
        return {
            "state": "matched",
            "method": method,
            "template": path,
            "handler": exact,
        }
    candidates = [
        (template, handler)
        for (verb, template), handler in table.items()
        if verb == method
        and re.fullmatch(re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(template)), path)
    ]
    if len(candidates) != 1:
        return {"state": "unresolved", "candidates": candidates}
    template, handler = candidates[0]
    return {
        "state": "matched",
        "method": method,
        "template": template,
        "handler": handler,
    }


def markdown() -> str:
    imports, calls = graph()
    table = handlers()

    def reach(start: str) -> set[str]:
        seen, todo = set(), [start]
        while todo:
            node = todo.pop()
            if node not in seen:
                seen.add(node)
                todo += sorted(imports.get(node, ()))
        return seen

    lines = [
        "<!-- Generated by devtools/er/ia_map.py. Do not edit. -->",
        "# 情報設計の対応表（画面 → 部品 → API → サーバーの処理）",
        "",
        "画面の経路ごとに、読み込む部品（間接の読み込みを含む）と、その部品が呼び出す API を示す。"
        "これは静的な候補一覧であり、HTTP メソッドと実通信の一致は別の受入記録で確認する。API の処理が読み書きする記録は、`physical.mmd` の表と `logical.md` の種類で確かめる。",
        "",
        "## 画面の経路",
        "",
        "| 経路 | ページ | 部品の数 | API の数 |",
        "|---|---|---|---|",
    ]
    pages = routes()
    for route, page in pages.items():
        parts = reach(page)
        apis = set().union(*(calls.get(p, set()) for p in parts))
        lines.append(f"| `{route}` | `{page}` | {len(parts) - 1} | {len(apis)} |")
    lines += [
        "",
        "## 部品が呼び出す API",
        "",
        "| 部品 | API | サーバーの処理 |",
        "|---|---|---|",
    ]
    for component in sorted(calls):
        for call in sorted(calls[component]):
            matched = _match(call, table)
            handled = (
                f"（実行時に経路を選ぶ：候補 {len(matched)} 件）"
                if len(matched) > 4
                else "<br>".join(f"`{h}`" for h in matched)
                or (
                    "（未解決：動的経路。実通信と OpenAPI の照合が必要）"
                    if "{…}" in call
                    else "（該当なし）"
                )
            )
            lines.append(f"| `{component}` | `{call}` | {handled} |")
    lines += ["", "## 経路ごとの部品", ""]
    for route, page in pages.items():
        others = sorted(reach(page) - {page})
        lines.append(
            f"- `{route}`：" + ("、".join(f"`{p}`" for p in others) if others else "—")
        )
    return "\n".join(lines) + "\n"


def outputs() -> dict[str, str]:
    return {"ia-map.md": markdown()}


def main(argv: list[str]) -> int:
    if "--check" in argv:
        stale = [
            n
            for n, t in outputs().items()
            if not (OUT / n).exists() or (OUT / n).read_text() != t
        ]
        print("stale: " + ", ".join(stale) if stale else "IA map is current")
        return 1 if stale else 0
    if "--write" in argv:
        OUT.mkdir(parents=True, exist_ok=True)
        for name, text in outputs().items():
            (OUT / name).write_text(text)
        print(f"wrote ia-map.md to {OUT}")
        return 0
    sys.stdout.write(markdown())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
