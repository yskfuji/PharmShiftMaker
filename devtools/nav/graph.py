"""Static navigation graph of the frontend: every place that moves the user to another page.

Sources scanned in frontend/src: href="..." / href={`...`} (links, <Link>), location.assign/
replace, browserNavigation.replace/assign, redirect(...) in server pages, the proxy's
sign-in redirect and the shared navigation list (lib/navigation.ts). Each target is
matched against the app's route patterns (app/**/page.tsx); a target that matches no
route is a dead link. Output: docs/architecture/navigation.md.

    python -m devtools.nav.graph [--write | --check]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "src"
OUT = ROOT / "docs" / "architecture" / "navigation.md"
PATTERNS = [
    ("link", re.compile(r"""href=\{?["'`]([^"'`]+)["'`]\}?""")),
    ("link", re.compile(r"""href:\s*["'`]([^"'`]+)["'`]""")),  # navigation lists
    (
        "document",
        re.compile(
            r"""(?:location|browserNavigation)\.(?:assign|replace)\(\s*["'`]([^"'`]+)["'`]"""
        ),
    ),
    ("document", re.compile(r"""loginPath\(\s*["'`]([^"'`]+)["'`]""")),
    ("server-redirect", re.compile(r"""\bredirect\(\s*["'`]([^"'`]+)["'`]""")),
    ("proxy", re.compile(r"""new URL\(\s*["'`](/[^"'`]*)["'`]\s*,\s*request\.url""")),
]
DYNAMIC_LOGIN = re.compile(r"loginPath\(")
VARIABLE = re.compile(r"""href=\{(?![`"'])([^}]+)\}""")


def routes() -> list[tuple[str, re.Pattern[str]]]:
    found = []
    for page in sorted((SRC / "app").rglob("page.tsx")):
        parts = page.parent.relative_to(SRC / "app").parts
        route = "/" + "/".join(parts) if parts else "/"
        regex = (
            "^"
            + "/".join(
                re.sub(
                    r"\[[^\]]+\]",
                    "[^/]+",
                    re.escape(p).replace(r"\[", "[").replace(r"\]", "]"),
                )
                for p in route.split("/")
            )
            + "$"
        )
        found.append((route, re.compile(regex)))
    return found


def _normalise(target: str) -> str | None:
    """Same-site path with template parts as placeholders; None for other schemes/anchors."""
    if target.startswith(("http://", "https://", "mailto:", "#")) or "${API" in target:
        return None
    if not target.startswith("/") and not target.startswith("${"):
        return None
    # An interpolated suffix can be a query string, fragment or path suffix.
    # Without evaluating the expression it must remain unresolved, not become /planningx.
    if re.search(r"[^/?#]\$\{[^}]+\}", target.split("?")[0].split("#")[0]):
        return None
    path = re.sub(r"\$\{[^}]*\}", "x", target).split("?")[0].split("#")[0]
    return path.rstrip("/") or "/"


rewrites: list[dict[str, str]] = []


def edges() -> list[dict[str, str]]:
    rows = []
    rewrites.clear()
    for file in sorted(SRC.rglob("*.ts*")):
        if "__tests__" in file.parts or file.name.endswith((".test.ts", ".test.tsx")):
            continue
        text = file.read_text()
        where = str(file.relative_to(SRC))
        for kind, pattern in PATTERNS:
            for match in pattern.finditer(text):
                target = match.group(1)
                path = _normalise(target)
                if path is None or path == "x":
                    continue
                line = text.count("\n", 0, match.start()) + 1
                if kind == "proxy" and "rewrite(" in text.splitlines()[line - 1]:
                    # An internal rewrite (e.g. to the not-found page) is not a destination.
                    rewrites.append({"source": f"{where}:{line}", "target": target})
                    continue
                rows.append(
                    {
                        "source": f"{where}:{line}",
                        "kind": kind,
                        "target": target,
                        "path": path,
                    }
                )
        for match in DYNAMIC_LOGIN.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            rows.append(
                {
                    "source": f"{where}:{line}",
                    "kind": "document",
                    "target": "/login?redirectTo=<current page>",
                    "path": "/login",
                }
            )
    unique = {(r["source"], r["target"]): r for r in rows}
    return sorted(unique.values(), key=lambda r: (r["source"], r["target"]))


def variables() -> list[dict[str, str]]:
    """Links whose target is a variable: resolved only at run time (covered by the E2E crawl)."""
    rows = []
    for file in sorted(SRC.rglob("*.tsx")):
        if "__tests__" in file.parts or file.name.endswith(".test.tsx"):
            continue
        text = file.read_text()
        for _kind, pattern in PATTERNS[:2]:
            for match in pattern.finditer(text):
                target = match.group(1)
                if (
                    target.startswith("/")
                    and "${" in target
                    and _normalise(target) is None
                ):
                    rows.append(
                        {
                            "source": f"{file.relative_to(SRC)}:{text.count(chr(10), 0, match.start()) + 1}",
                            "expression": target,
                        }
                    )
        for match in VARIABLE.finditer(text):
            rows.append(
                {
                    "source": f"{file.relative_to(SRC)}:{text.count(chr(10), 0, match.start()) + 1}",
                    "expression": match.group(1).strip(),
                }
            )
    return rows


def dead(rows: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    patterns = routes()
    return [
        r for r in (rows or edges()) if not any(p.match(r["path"]) for _, p in patterns)
    ]


def markdown() -> str:
    rows = edges()
    patterns = routes()
    missing = dead(rows)
    lines = [
        "<!-- Generated by devtools/nav/graph.py. Do not edit. -->",
        "# 画面遷移の一覧（静的）",
        "",
        "画面を移す箇所（リンク、ページの読み込み、サーバーの転送、プロキシのサインイン転送、共通の導線の一覧）をソースから抜き出し、"
        "行き先を実在するルートの型と照合した。画面の中の開閉（ダイアログ・開閉の欄・段階の切替）は、E2E で確かめる。",
        "",
        f"- ルート：{len(patterns)} 件",
        f"- 遷移の箇所：{len(rows)} 件",
        f"- 行き先が実在しない箇所：{len(missing)} 件",
        "",
        "## ルート",
        "",
    ] + [f"- `{route}`" for route, _ in patterns]
    lines += [
        "",
        "## 遷移の箇所",
        "",
        "| 箇所 | 種類 | 行き先 | 対応するルート |",
        "|---|---|---|---|",
    ]
    for r in rows:
        matched = next(
            (route for route, p in patterns if p.match(r["path"])), "**なし**"
        )
        lines.append(
            f"| `{r['source']}` | {r['kind']} | `{r['target']}` | `{matched}` |"
        )
    lines += [
        "",
        f"## 内部の書き換え（{len(rewrites)} 件）",
        "",
        "利用者の行き先ではない。存在しない経路へ書き換え、サーバーで描いた not-found（状態 404）を返すためのもの。",
        "",
        "| 箇所 | 書き換え先 |",
        "|---|---|",
    ] + [f"| `{r['source']}` | `{r['target']}` |" for r in rewrites]
    dynamic = variables()
    lines += [
        "",
        f"## 実行時に決まる行き先（{len(dynamic)} 件）",
        "",
        "変数で渡す行き先は、ここでは解決しない。画面を実際に辿る E2E（`frontend/tests/remediation-e2e/navigation.spec.ts`）で確かめる。",
        "",
        "| 箇所 | 式 |",
        "|---|---|",
    ] + [f"| `{r['source']}` | `{r['expression']}` |" for r in dynamic]
    return "\n".join(lines) + "\n"


def outputs() -> dict[str, str]:
    return {"navigation.md": markdown()}


def main(argv: list[str]) -> int:
    if "--check" in argv:
        stale = [
            n for n, t in outputs().items() if not OUT.exists() or OUT.read_text() != t
        ]
        missing = dead()
        for r in missing:
            print(f"dead link: {r['source']} -> {r['target']}")
        print("stale: " + ", ".join(stale) if stale else "navigation map is current")
        return 1 if stale or missing else 0
    if "--write" in argv:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(markdown())
        print(f"wrote {OUT}")
        return 0
    sys.stdout.write(markdown())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
