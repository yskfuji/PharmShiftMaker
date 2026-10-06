"""The new workspace (/workspace, UI v3) is structurally independent of the established
screens, and this file enforces it.

Direction of dependency: app/workspace -> features/workspace/shell -> one route definition
per route of docs/ideal-ui/usecases.json (its own server read and its own view under
features/workspace/<purpose>/<view>) -> shared workspace parts, the typed API client and
atomic UI. The established product may use neutral pieces of features/workspace; the
workspace never imports the established product.

Where the established product lives: frontend/src/components (except the atomic
components/ui, the theme toggle and the sign-in identity provider), frontend/src/app outside
app/workspace, and frontend/src/ideal/screens with the earlier providers. /preview and
/showcase render the v1/v2 monolithic IdealWorkspace from there. They are kept as a v1/v2
compatibility showcase behind their own flags, share no screen with /workspace and are not
v3 evidence.

Two kinds of server code are kept apart. shell/server holds what the browser never reaches
(the session cookie, the server-side reads): no Client Component may reach it. shell/actions
holds the workspace's only Server Action, an endpoint the browser does call: it may do
nothing but ask for the current route to be rendered again (see server_action_faults).

Every rule below is checked on the import graph (relative imports, the "@/" alias and bare
specifiers resolved through the tsconfig baseUrl `./src`; a directory's index is followed),
not by searching for forbidden names, and every rule is proven able to fail by a mutation
applied in memory (see MUTATIONS).

Where the graph starts: every file under app/workspace (the pages, the layout, and the
workspace's own not-found.tsx and error.tsx, which must exist) and the showcase.

What is outside its reach:
- The root layout (app/layout.tsx) wraps every page of the application, the workspace's
  included: its session plumbing (identity provider and boundary, session controls, route
  focus, the unsaved-navigation boundary, the navigation flags) is shared with the
  established product and is not reached from app/workspace by an import.
- An established screen copied under a new name. That needs a reviewer's comparison (lines,
  and token runs for a reformatted copy), which docs/ideal-ui/verification.md records.
"""

import functools
import json
import posixpath
import re
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
SRC = ROOT / "frontend/src"
USE_CASES = ROOT / "docs/ideal-ui/usecases.json"

WORKSPACE = "app/workspace"
# The pages Next.js shows for notFound() and for an error thrown under app/workspace. Without
# them the application's root not-found and error pages (the established product's) are used.
BOUNDARIES = (f"{WORKSPACE}/not-found.tsx", f"{WORKSPACE}/error.tsx")
SHOWCASE = "features/workspace/showcase"
FEATURES = "features/workspace"
SHELL = "features/workspace/shell/"
SERVER_ONLY = "features/workspace/shell/server/"
# Server Actions: endpoints the browser calls. The opposite of SERVER_ONLY, and kept apart.
ACTIONS = "features/workspace/shell/actions/"
REFRESH_ACTION = f"{ACTIONS}refreshRoute.ts"
# What a Server Action module of the workspace may import: the call that renders the
# current route again, and nothing of this application.
ACTION_PACKAGES = ("next/cache",)
GENERATED = "features/workspace/generated/"
MONOLITH = "components/ideal/IdealWorkspace.tsx"

# Modules under components/ that are not a screen of the established product: atomic UI,
# the theme toggle, and the sign-in identity (session plumbing).
ALLOWED_COMPONENTS = (
    "components/ui/",
    "components/ThemeToggle.tsx",
    "components/IdentityProvider.tsx",
)
# The event the shell and the earlier provider both announce; the rest of ideal/providers
# is the earlier pipeline.
ALLOWED_PROVIDERS = ("ideal/providers/contextEvent.ts",)
EARLIER_PIPELINE = ("ideal/providers/", "ideal/api/toModel.ts", "ideal/synthetic.ts")
ESTABLISHED_URLS = (
    "dashboard",
    "planning",
    "settings",
    "requests",
    "schedule",
    "preview",
    "showcase",
)
# Cross-purpose screens of the established product (switched by a `section`/`group` prop or
# serving several purposes at once), under the names they have and the names they had.
CROSS_PURPOSE_SCREENS = (
    "ComplianceWorkspace",
    "CompliancePanel",
    "ContractWorkflow",
    "ActualReconciliation",
    "ActualWorkflow",
    "FlexTimeSettings",
    "FlexAdoptionSettings",
    "LeaveRequestWorkspace",
    "PlanningRequests",
    "PlanningStudio",
    "PlanningWorkspace",
    "PublicationExport",
    "IntegratedFeatureView",
    "LegacyFeature",
)
# What the public documents state while this file is the evidence.
RETIRED_GAP_NOTICE = "新workspaceの従来画面からの独立は未完了である"
ENFORCED_STATEMENT = (
    "構造試験（`tests/test_workspace_v3_structure.py`）は、新workspaceが従来画面の実装を"
    "推移的にimportした場合、従来URLへリンクした場合、又は複数用途を兼ねる従来フォームを"
    "表示した場合に失敗する。"
)
COMPATIBILITY_STATEMENT = (
    "`/preview` と `/showcase` はv1/v2の互換ショーケースであり、v3の証跡には含めない。"
)


# --- the source tree, with an in-memory overlay for mutations -------------------------

_IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']""")
# A statement that only carries types: `import type X from`, `import type { A } from`,
# `import type * as N from` and the same with `export`. Nothing else may sit between `type`
# and `from`, so the match cannot run on into a later statement that is loaded at run time.
_TYPE_ONLY = re.compile(
    r"""\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*["'][^"']+["']"""
)
# A directive at the top of a module, after comments only. A line comment ends where
# JavaScript ends it: at LF, CR, U+2028 or U+2029.
_LEADING_COMMENTS = (
    r"""\A\s*(?:(?://[^\n\r\u2028\u2029]*[\n\r\u2028\u2029]|/\*.*?\*/)\s*)*"""
)
_USE_CLIENT = re.compile(_LEADING_COMMENTS + r"""["']use client["']""", re.S)
_USE_SERVER = re.compile(_LEADING_COMMENTS + r"""["']use server["']""", re.S)
# The directive anywhere: at the top of a module or as the first statement of a function,
# alone on its line or not. It is looked for in the text as written and in the text without
# comments, because a `/*` inside a string ("image/*") hides what follows it from the
# second. The first also finds a comment that quotes the directive, so outside
# shell/actions the workspace does not write the directive in quotes anywhere.
_SERVER_DIRECTIVE = re.compile(r"""["'`]use server["'`]""")
_EXPORT = re.compile(r"^export\b[^\n]*", re.M)
_ACTION_EXPORT = re.compile(r"export async function \w+\(\): Promise<void> \{")
# The whole of a Server Action module once its comments are removed: the directive, the one
# import, and functions that do nothing but call it. Anything else (a `require`, a global
# `fetch`, another name imported as `refresh`) is not this text.
_ACTION_MODULE = re.compile(
    r"""\s*"use server";\s*import \{ refresh \} from "next/cache";\s*"""
    r"""(?:export async function \w+\(\): Promise<void> \{\s*refresh\(\);\s*\}\s*)+"""
)
_REAL_FILES: list[str] | None = None


def _real_files() -> list[str]:
    global _REAL_FILES
    if _REAL_FILES is None:
        _REAL_FILES = sorted(
            path.relative_to(SRC).as_posix()
            for path in SRC.rglob("*.ts*")
            if path.suffix in {".ts", ".tsx"}
        )
    return _REAL_FILES


class Tree:
    """frontend/src as it is, or with files replaced, added (text) or removed (None)."""

    def __init__(self, overlay: dict[str, str | None] | None = None) -> None:
        self.overlay = dict(overlay or {})
        self._text: dict[str, str] = {}
        self._imports: dict[tuple[str, bool], list[str]] = {}
        names = set(_real_files()) | {
            k for k, v in self.overlay.items() if v is not None
        }
        self.names = names - {k for k, v in self.overlay.items() if v is None}
        # tsconfig.json has `baseUrl: ./src`: "components/X" names src/components/X.
        self.roots = {name.split("/", 1)[0] for name in self.names if "/" in name}

    def read(self, name: str) -> str:
        if name not in self._text:
            replaced = self.overlay.get(name)
            self._text[name] = (
                replaced
                if replaced is not None
                else (SRC / name).read_text(encoding="utf-8")
            )
        return self._text[name]

    def under(self, prefix: str) -> list[str]:
        prefix = prefix.rstrip("/") + "/"
        return sorted(name for name in self.names if name.startswith(prefix))

    def resolve(self, specifier: str, importer: str) -> str | None:
        if specifier.startswith("@/"):
            base = specifier[2:]
        elif specifier.startswith("."):
            base = posixpath.normpath(
                posixpath.join(posixpath.dirname(importer), specifier)
            )
        elif specifier.split("/", 1)[0] in self.roots:
            base = specifier  # a bare specifier resolved through the baseUrl
        else:
            return None  # a package
        for candidate in (
            base,
            f"{base}.ts",
            f"{base}.tsx",
            f"{base}/index.ts",
            f"{base}/index.tsx",
        ):
            if candidate in self.names:
                return candidate
        return None

    def imports(self, name: str, runtime_only: bool = False) -> list[str]:
        key = (name, runtime_only)
        if key not in self._imports:
            text = self.read(name)
            if runtime_only:
                text = _TYPE_ONLY.sub("", text)
            found = (
                self.resolve(specifier, name) for specifier in _IMPORT.findall(text)
            )
            self._imports[key] = [target for target in found if target is not None]
        return self._imports[key]

    def reachable(self, entries: Iterable[str], runtime_only: bool = False) -> set[str]:
        """Modules reachable from files or directories through relative, "@/" and baseUrl
        imports."""
        pending = [
            name
            for entry in entries
            for name in ([entry] if entry in self.names else self.under(entry))
        ]
        seen: set[str] = set()
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            pending.extend(self.imports(current, runtime_only))
        return seen

    def with_file(self, name: str, text: str | None) -> "Tree":
        return Tree({**self.overlay, name: text})

    def edited(self, name: str, old: str, new: str) -> "Tree":
        text = self.read(name)
        assert old in text, (name, old)
        return self.with_file(name, text.replace(old, new, 1))


REAL = Tree()


def _is_source(name: str) -> bool:
    return (
        "__tests__" not in name
        and "__fixtures__" not in name
        and ".test." not in name
        and ".stories." not in name
    )


def _workspace_modules(tree: Tree) -> set[str]:
    """Everything a workspace URL or its Storybook showcase can load: the graph starts from
    every file under app/workspace (pages, layout, not-found and error) and the showcase.
    """
    return tree.reachable([WORKSPACE, *BOUNDARIES, SHOWCASE])


def _uses_client(tree: Tree, name: str) -> bool:
    return bool(_USE_CLIENT.match(tree.read(name)))


def _contract() -> dict[str, str]:
    """Route key (`screen/view`) to path, from the use-case contract."""
    rows = json.loads(USE_CASES.read_text(encoding="utf-8"))["workspace_routes"]
    return {f'{row["screen"]}/{row["view"]}': row["route"] for row in rows}


# --- the rules: each returns its violations, and none is expected ---------------------


def established_modules_reached(tree: Tree) -> list[str]:
    """The workspace and its showcase import, transitively, nothing of the established
    product (components/, app/ outside app/workspace, ideal/screens) and nothing of the
    earlier pipeline (the earlier providers, their model and their synthetic data)."""
    found = []
    for name in sorted(_workspace_modules(tree)):
        if name.startswith("ideal/screens/"):
            found.append(f"screen implementation: {name}")
        elif name.startswith("components/") and not name.startswith(ALLOWED_COMPONENTS):
            found.append(f"established component: {name}")
        elif name.startswith("app/") and not name.startswith(WORKSPACE + "/"):
            found.append(f"established route: {name}")
        elif name.startswith(EARLIER_PIPELINE) and name not in ALLOWED_PROVIDERS:
            found.append(f"earlier pipeline: {name}")
    return found


_NAVIGATION = (
    r"(?:\b(?:href|route|to)=\{?|\b(?:href|pathname|route)\s*:\s*|\blocation\.href\s*=\s*"
    r"|\b(?:replace|replaceWithFlash|push|assign|navigate|redirect|open)\(\s*)"
)
_ESTABLISHED_LINK = re.compile(
    _NAVIGATION + r"""["'`]/(?:""" + "|".join(ESTABLISHED_URLS) + r""")(?![\w-])"""
)
_WORKSPACE_LITERAL = re.compile(r"""["'`]/workspace(?=[/?#"'`$])""")


def established_links(tree: Tree) -> list[str]:
    """No workspace module links or navigates to a URL of the established product."""
    return [
        f"{name}: {match.group(0)}"
        for name in sorted(_workspace_modules(tree))
        for match in _ESTABLISHED_LINK.finditer(tree.read(name))
    ]


def free_workspace_urls(tree: Tree) -> list[str]:
    """Outside the shell (and the generated contract) no workspace module writes a
    "/workspace..." URL itself: a destination is a route of the contract, named through
    routeOf() and turned into a URL by WorkspaceLink or workspaceHrefWithContext."""
    return [
        name
        for name in sorted(_workspace_modules(tree))
        if not name.startswith((SHELL, GENERATED))
        and _WORKSPACE_LITERAL.search(tree.read(name))
    ]


def _route_directory(key: str) -> str:
    screen, view = key.split("/")
    purpose = {"plan": "planning"}.get(screen, screen)
    if view == "index":
        return f"{FEATURES}/{purpose}"
    head, *rest = view.split("-")
    return f"{FEATURES}/{purpose}/{head}{''.join(part.capitalize() for part in rest)}"


def route_definition_faults(
    tree: Tree, contract: dict[str, str] | None = None
) -> list[str]:
    """Exactly one route.ts per route of the contract, in the directory of its key and
    registered under that key; its View is a Server Component (no "use client", not async).
    """
    contract = _contract() if contract is None else contract
    found = []
    expected = {f"{_route_directory(key)}/route.ts": key for key in contract}
    present = {
        name for name in tree.under(FEATURES) if posixpath.basename(name) == "route.ts"
    }
    found += [
        f"route without a definition: {expected[name]}"
        for name in sorted(set(expected) - present)
    ]
    found += [
        f"definition without a route: {name}"
        for name in sorted(present - set(expected))
    ]

    registry = tree.read(f"{SHELL}routes.ts")
    imported = dict(re.findall(r'import (\w+) from "([^"]+/route)";', registry))
    registered = dict(re.findall(r'^\s*"([a-z-]+/[a-z-]+)":\s*(\w+),', registry, re.M))
    if "satisfies { [K in WorkspaceRouteKey]: AnyRouteDefinition }" not in registry:
        found.append("the registry is not total by type")
    found += [
        f"registered twice or unknown: {key}"
        for key in sorted(set(registered) - set(contract))
    ]
    found += [
        f"not registered: {key}" for key in sorted(set(contract) - set(registered))
    ]

    for name in sorted(present & set(expected)):
        key = expected[name]
        text = tree.read(name)
        if f'key: "{key}"' not in text:
            found.append(f"{name}: its key is not {key}")
        target = tree.resolve(
            imported.get(registered.get(key, ""), ""), f"{SHELL}routes.ts"
        )
        if target != name:
            found.append(f"{key}: registered from {target}, not from {name}")
        view = re.search(r"\bView:\s*(\w+)", text)
        source = view and re.search(
            rf'import {view.group(1)}\b[^;]*?from "([^"]+)"', text
        )
        view_file = source and tree.resolve(source.group(1), name)
        if not view_file:
            found.append(f"{name}: no View module")
            continue
        view_text = tree.read(view_file)
        if _uses_client(tree, view_file):
            found.append(
                f'{view_file}: the View of {key} is a Client Component ("use client")'
            )
        if re.search(
            rf"\basync\s+function\s+{view.group(1)}\b|export\s+default\s+async\b",
            view_text,
        ):
            found.append(f"{view_file}: the View of {key} is async")
    return found


def server_modules_reached_by_client_code(tree: Tree) -> list[str]:
    """Nothing under shell/server (the session cookie, the server-side reads) can be
    bundled for the browser: no module with "use client" reaches it at run time."""
    found = []
    for name in sorted(_workspace_modules(tree)):
        if not _uses_client(tree, name):
            continue
        leaked = sorted(
            target
            for target in tree.reachable([name], runtime_only=True)
            if target.startswith(SERVER_ONLY)
        )
        found += [f"{name} -> {target}" for target in leaked]
    return found


def server_action_faults(tree: Tree) -> list[str]:
    """A Server Action is not a server-only module: it is an endpoint, and anyone can call
    it with any arguments, signed in or not. shell/server is what the browser never
    reaches; shell/actions is what the browser calls. So the workspace has Server Actions
    under shell/actions only, and a module there
    - starts with "use server", and no other module that a workspace URL or the showcase
      can load carries that directive, wherever it is kept (the sign-in plumbing of the
      root layout is outside this graph, see "What the structure test enforces");
    - imports nothing of this application (no session cookie, no server-side read) and of
      packages only next/cache;
    - exports nothing but `async function name(): Promise<void>`: no parameter that could
      select data, no result that could carry it, and it does not read `arguments`;
    - is, comments apart, nothing but the directive, `import { refresh } from "next/cache"`
      and functions whose whole body is `refresh();` (no `require`, no global `fetch`, no
      other export of next/cache under that name);
    - is reached by no Client Component, directly or through a module in between: the
      server-rendered route hands the action over as a prop, so the client bundles
      (Storybook's included) hold no server module."""
    found = []
    sources = sorted(
        {
            name
            for name in tree.under(FEATURES) + tree.under(WORKSPACE)
            if _is_source(name)
        }
        | {name for name in _workspace_modules(tree) if _is_source(name)}
    )
    for name in sources:
        text = tree.read(name)
        if name.startswith(ACTIONS):
            if not _USE_SERVER.match(text):
                found.append(f'{name}: is not a Server Action module ("use server")')
            for specifier in _IMPORT.findall(text):
                if specifier not in ACTION_PACKAGES:
                    found.append(f"{name}: a Server Action imports {specifier}")
            for line in _EXPORT.findall(text):
                if not _ACTION_EXPORT.fullmatch(line.strip()):
                    found.append(
                        f"{name}: exports more than a function without parameters "
                        f"and without a result: {line.strip()}"
                    )
            if re.search(r"\barguments\b", _strip_comments(text)):
                found.append(f"{name}: a Server Action reads its arguments")
            if not _ACTION_MODULE.fullmatch(_strip_comments(text)):
                found.append(
                    f"{name}: a Server Action module holds more than the directive, "
                    "the import of refresh from next/cache and functions that call it"
                )
        elif _SERVER_DIRECTIVE.search(text) or _SERVER_DIRECTIVE.search(
            _strip_comments(text)
        ):
            found.append(f"{name}: a Server Action outside {ACTIONS}")
    for name in sorted(_workspace_modules(tree)):
        if _uses_client(tree, name):
            found += [
                f"{name}: a Client Component imports the Server Action {target}"
                for target in sorted(tree.reachable([name], runtime_only=True))
                if target.startswith(ACTIONS)
            ]
    return found


def _strip_comments(text: str) -> str:
    """A line comment ends where JavaScript ends it: at LF, CR, U+2028 or U+2029."""
    return re.sub(r"/\*.*?\*/|//[^\n\r\u2028\u2029]*", "", text, flags=re.S)


def _screen_modules(tree: Tree, entry: str) -> set[str]:
    return {
        name
        for name in tree.reachable([entry])
        if name.startswith((f"{FEATURES}/", "ideal/screens/"))
        and not name.startswith((SHELL, SHOWCASE + "/"))
    }


def showcase_differences(tree: Tree) -> list[str]:
    """Storybook and the routes show the same views: the showcase swaps the transport, and
    has no screen of its own."""
    showcase, routes = _screen_modules(tree, SHOWCASE), _screen_modules(tree, WORKSPACE)
    return sorted(
        [f"only in the showcase: {name}" for name in showcase - routes]
        + [f"only in the routes: {name}" for name in routes - showcase]
    )


def cross_purpose_renders(tree: Tree) -> list[str]:
    """No workspace module renders a cross-purpose screen of the established product."""
    pattern = re.compile(r"<(" + "|".join(CROSS_PURPOSE_SCREENS) + r")[\s/>]")
    return [
        f"{name}: <{match.group(1)}"
        for name in sorted(_workspace_modules(tree))
        for match in pattern.finditer(tree.read(name))
    ]


_COMPARED_BEFORE = re.compile(r"[!=]==?\s*$")
_COMPARED_AFTER = re.compile(r"\s*[!=]==?")


def _literal_classes(text: str, start: int, keep: bool) -> tuple[set[str], int]:
    """Class names in the string literals of a JS expression that begins after an opening
    brace at `start - 1`; returns them with the index after its closing brace.

    A literal compared with `===` is a value, not a class. Inside a template, text glued to
    an interpolation is a fragment: `ideal-dot--${tone}` yields the prefix `ideal-dot--`,
    and what the interpolation or a glued suffix contributes is not judged."""
    names: set[str] = set()
    depth, index = 1, start
    while index < len(text):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return names, index + 1
        elif char in "\"'":
            close = index + 1
            while close < len(text) and text[close] != char:
                close += 2 if text[close] == "\\" else 1
            compared = _COMPARED_BEFORE.search(text, 0, index) or _COMPARED_AFTER.match(
                text, close + 1
            )
            if keep and not compared:
                names.update(text[index + 1 : close].split())
            index = close
        elif char == "`":
            static = ""
            index += 1
            while index < len(text) and text[index] != "`":
                if text.startswith("${", index):
                    glued = bool(static) and not static[-1].isspace()
                    inner, index = _literal_classes(text, index + 2, keep and not glued)
                    names |= inner
                    static += "\0"
                else:
                    static += text[index]
                    index += 1
            if keep:
                names.update(
                    prefix
                    for prefix in (token.split("\0")[0] for token in static.split())
                    if prefix
                )
        index += 1
    return names, index


def _class_names(text: str) -> set[str]:
    """Every class name written in a className attribute, literal or inside an expression."""
    names: set[str] = set()
    for match in re.finditer(r"\bclassName=", text):
        opening = text[match.end() : match.end() + 1]
        if opening in ('"', "'"):
            names.update(
                text[match.end() + 1 : text.index(opening, match.end() + 1)].split()
            )
        elif opening == "{":
            names |= _literal_classes(text, match.end() + 1, keep=True)[0]
    return names


def foreign_class_names(tree: Tree) -> list[str]:
    """Workspace markup uses the workspace's own styles only: no adapter wrapper
    (ideal-v3-purpose), no class of the established screens (workflow-*, ui-*) and no
    utility class. `sr-only` is the one exception. The three allowed components/ modules
    are the established product's own and are not judged here."""
    found = []
    for name in sorted(_workspace_modules(tree)):
        if name.startswith("components/") or not name.endswith(".tsx"):
            continue
        for token in sorted(_class_names(tree.read(name))):
            own = token.startswith(("ideal-", "is-")) and not token.startswith(
                "ideal-v3-purpose"
            )
            if not own and token != "sr-only":
                found.append(f"{name}: {token}")
    return found


STYLES = ROOT / "frontend/src/app/globals.css"
# The workspace's own stylesheets (scale, primitives, one file per purpose). The directory is
# read when it exists; until it does, globals.css alone holds every rule.
WORKSPACE_STYLES = SRC / "styles/workspace"

# A class written as `prefix${value}`: every value the type allows needs a rule of its own,
# except the one that is the base class's own look. `Tone` and `MetricTone` are read from
# ideal/model.ts; the other two are the values their call sites can pass.
MODEL = "ideal/model.ts"
TEMPLATE_VARIANTS: dict[str, tuple[str | tuple[str, ...], frozenset[str]]] = {
    # prefix: (the union in ideal/model.ts, or the values; values that need no rule)
    "ideal-pill--": ("Tone", frozenset({"neutral"})),
    "ideal-metric--": ("MetricTone", frozenset({"neutral"})),
    # ScheduleModel.summary[].tone, and "warn" | "new" in the case list.
    "ideal-dot--": (("good", "warn", "new"), frozenset()),
    # TaskTone of shared/TaskDisclosure; a routine task is the wrapper as it is.
    "ideal-v3-task--": (
        ("primary", "routine", "info", "danger"),
        frozenset({"routine"}),
    ),
}
# Not the workspace's own: Tailwind's utility, the one foreign class the workspace may use.
STYLED_ELSEWHERE = frozenset({"sr-only"})
# Classes the workspace uses that no stylesheet has a rule for would render with the reset's
# defaults (a cancel button as plain text, a field label as body text). Six were found when
# this rule was written; each has its rule since the repair of the screens, so the list is
# empty and stays empty: an entry that has a rule, or that nothing uses, is itself a fault.
PENDING_STYLE: frozenset[str] = frozenset()


def _workspace_stylesheets() -> list[Path]:
    """Every .css file under styles/workspace, in its sub-directories too: a file put in a
    folder of its own is still one of the workspace's stylesheets."""
    return sorted(WORKSPACE_STYLES.rglob("*.css")) if WORKSPACE_STYLES.is_dir() else []


def _stylesheets() -> str:
    paths = [STYLES, *_workspace_stylesheets()]
    return "\n".join(path.read_text(encoding="utf-8") for path in paths)


def _strip_css_comments(text: str) -> str:
    """The stylesheet without its comments. A comment mark inside a quoted string
    (`content: "/*"`) is not one."""
    out: list[str] = []
    index, quote = 0, ""
    while index < len(text):
        char = text[index]
        if quote:
            out.append(char)
            if char == "\\" and index + 1 < len(text):
                out.append(text[index + 1])
                index += 1
            elif char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
            out.append(char)
        elif text.startswith("/*", index):
            end = text.find("*/", index + 2)
            index = len(text) if end < 0 else end + 1
        else:
            out.append(char)
        index += 1
    return "".join(out)


@functools.lru_cache(maxsize=16)
def _selector_text(css: str) -> str:
    """Every selector of a stylesheet, one rule per line: what stands before a rule's block,
    inside grouping at-rules as well. Comments, declarations (a `content` string, a value)
    and the names of @keyframes are not selectors and are left out."""
    found: list[str] = []

    def collect(text: str) -> None:
        for prelude, body in _css_blocks(text):
            if body is None:
                continue
            if not prelude.startswith("@"):
                found.append(prelude)
            elif prelude.split(None, 1)[0].split("(")[0] in _GROUPING:
                collect(body)

    collect(_strip_css_comments(css))
    return "\n".join(found)


def _has_rule(css: str, token: str) -> bool:
    """A class has a rule when a selector names it. The name in a comment
    (`/* .ideal-x is styled by … */`) or in a declaration gives the element no look."""
    return re.search(rf"\.{re.escape(token)}(?![\w-])", _selector_text(css)) is not None


def _union(tree: Tree, name: str) -> tuple[str, ...]:
    """The string literals of `export type <name> = "a" | "b";` in ideal/model.ts."""
    declared = re.search(rf"export type {name} = ([^;]+);", tree.read(MODEL))
    return tuple(re.findall(r'"([\w-]+)"', declared.group(1))) if declared else ()


def unstyled_class_names(
    tree: Tree,
    css: str | None = None,
    pending: frozenset[str] = PENDING_STYLE,
) -> list[str]:
    """Every class the workspace writes has a rule in globals.css or in a file of
    styles/workspace: a class without one names a look and gives none, and the element is
    left with the reset's defaults. A token written whole (ideal-*, is-*) needs a selector
    that contains `.token`; a template prefix needs one for each declared value (see
    TEMPLATE_VARIANTS), and a prefix that table does not know is a fault.

    What it does not see: a class glued after an interpolation (`${a}is-compact`), which the
    parser of class names cannot read, and whether a rule that exists is enough to make the
    element look finished. tests/visual/lib/structure.ts judges the rendered result."""
    css = _stylesheets() if css is None else css
    used: dict[str, str] = {}
    for name in sorted(_workspace_modules(tree)):
        if name.startswith("components/") or not name.endswith(".tsx"):
            continue
        for token in sorted(_class_names(tree.read(name))):
            used.setdefault(token, name)
    found = []
    for token, name in sorted(used.items()):
        if token in STYLED_ELSEWHERE or token in pending:
            continue
        if not token.endswith("-"):
            if not _has_rule(css, token):
                found.append(f"{name}: {token} has no rule")
            continue
        if token not in TEMPLATE_VARIANTS:
            found.append(f"{name}: {token}${{…}} has no declared variants")
            continue
        source, base = TEMPLATE_VARIANTS[token]
        variants = _union(tree, source) if isinstance(source, str) else source
        if not variants:
            found.append(f"{name}: {token}${{…}}: {source} is not declared in {MODEL}")
        for variant in variants:
            if variant not in base and not _has_rule(css, f"{token}{variant}"):
                found.append(f"{name}: {token}{variant} has no rule")
    for token in sorted(pending):
        if token not in used:
            found.append(f"PENDING_STYLE: {token} is not used any more")
        elif _has_rule(css, token):
            found.append(f"PENDING_STYLE: {token} has a rule now")
    return found


_SCOPE = re.compile(
    r"(?:(?::root(?:\[[^\]]*\]|:not\([^)]*\))*\s+)?\.ideal-v3-app(?![\w-])"
    r"|(?:body|html):has\(\s*\.ideal-v3-app(?![\w-]))"
)
_GROUPING = ("@media", "@supports", "@layer", "@container")
_TOKEN_ONLY = re.compile(r"font-size|border(?:-[a-z]+){0,2}-radius")
# A size is a step of the scale and a radius is a radius token: the variable is one of these
# families. A variable of any other name could hold a literal (`--s: 9px; font-size:
# var(--s)`), and so could a variable of a family that a purpose file declares again, so the
# families are declared in scale.css only (tokens.css, which is generated, declares the rest).
_SIZE_FAMILIES = ("--ideal-v3-text-", "--font-size-")
_RADIUS_FAMILIES = ("--radius-", "--ideal-v3-radius-")
_VARIABLE = re.compile(r"var\((--[\w-]+)\)")
SCALE_SHEET = "scale.css"
INDEX_SHEET = "index.css"
# `@import "./name.css"` (or url("./name.css")): a file of the same directory, nothing after it.
_OWN_IMPORT = re.compile(r"""@import\s+(?:url\(\s*)?(["'])\./[\w-]+\.css\1\s*\)?""")


def _token_value(name: str, value: str) -> bool:
    """`value` of font-size or of a radius property is inherit, a variable of the property's
    family or, for a radius, 50%."""
    families = _SIZE_FAMILIES if name == "font-size" else _RADIUS_FAMILIES
    parts = value.split()
    return bool(parts) and all(
        part == "inherit"
        or (part == "50%" and name != "font-size")
        or (
            (variable := _VARIABLE.fullmatch(part)) is not None
            and variable.group(1).startswith(families)
        )
        for part in parts
    )


def _skip_string(text: str, index: int) -> int:
    """The index after the quoted string that starts at `index`."""
    quote = text[index]
    index += 1
    while index < len(text) and text[index] != quote:
        index += 2 if text[index] == "\\" else 1
    return index + 1


def _css_blocks(text: str) -> list[tuple[str, str | None]]:
    """(prelude, body) of each top-level rule; a statement without a block has body None.
    A brace or a semicolon inside a quoted string (`content: "}"`, `[title="{"]`) is text.
    """
    blocks: list[tuple[str, str | None]] = []
    index = 0
    while index < len(text):
        stop = index
        while stop < len(text) and text[stop] not in "{;}":
            stop = _skip_string(text, stop) if text[stop] in "\"'" else stop + 1
        stop = min(stop, len(text))
        prelude = text[index:stop].strip()
        if stop >= len(text) or text[stop] != "{":
            if prelude:
                blocks.append((prelude, None))
            index = stop + 1
            continue
        depth, close = 1, stop + 1
        while close < len(text) and depth:
            if text[close] in "\"'":
                close = _skip_string(text, close)
                continue
            depth += {"{": 1, "}": -1}.get(text[close], 0)
            close += 1
        blocks.append((prelude, text[stop + 1 : close - 1]))
        index = close
    return blocks


def _split_selectors(prelude: str) -> list[str]:
    """The selectors of a list: split at the commas that are outside parentheses, brackets
    and quoted strings. (`[title=")"]` holds a parenthesis that closes nothing.)"""
    parts: list[str] = []
    depth, start, index = 0, 0, 0
    while index < len(prelude):
        char = prelude[index]
        if char in "\"'":
            index = _skip_string(prelude, index)
            continue
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth <= 0:
            parts.append(prelude[start:index].strip())
            start = index + 1
        index += 1
    parts.append(prelude[start:].strip())
    return parts


def _leaves_the_frame(selector: str, scope_end: int) -> bool:
    """True when the compound that names the frame is followed by a sibling combinator
    (`.ideal-v3-app ~ .x`, `.ideal-v3-app:hover + *`): what such a selector matches stands
    beside the frame, not in it. A sibling combinator further on relates two elements that
    are both inside the frame."""
    index = scope_end
    depth = selector[:scope_end].count("(") - selector[:scope_end].count(")")
    while index < len(selector):
        char = selector[index]
        if char in "\"'":
            index = _skip_string(selector, index)
            continue
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif depth <= 0 and (char.isspace() or char in ">+~"):
            break
        index += 1
    return selector[index:].lstrip()[:1] in ("+", "~")


def css_scope_faults(text: str, name: str = "") -> list[str]:
    """A stylesheet of styles/workspace cannot reach the established product or /preview and
    /showcase, and takes its sizes from the scale. `name` is the file's path under
    styles/workspace; it decides what only index.css and scale.css may hold.

    Every selector starts with `.ideal-v3-app` (or `:root[…] .ideal-v3-app` for a theme,
    or `body:has(.ideal-v3-app…)` / `html:has(.ideal-v3-app…)` for what must be set on the
    document), and the compound that names the frame is not followed by a sibling
    combinator. A class name that contains `v3` is not a scope: ideal/screens uses several.
    `font-size` and every `border-radius` take `inherit`, a variable of their family
    (`--ideal-v3-text-*`, `--font-size-*`; `--radius-*`, `--ideal-v3-radius-*`) or, for a
    radius, `50%`, and `font` only `inherit`: a literal there, or a variable of another name
    that could hold one, is a size outside the five-step scale. The variables of those
    families are declared in scale.css only. `@import` is index.css's alone, and only of a
    .css file of its own directory: anything else could bring in a stylesheet this reader
    never sees. A nested rule and an at-rule other than @import, @charset, @media,
    @supports, @layer, @container and @keyframes are faults, because this reader would not
    see the selectors inside them.

    Blind spots: a selector that starts in the frame and leaves it through `:has()` on the
    document (`body:has(.ideal-v3-app) .x`) is allowed by design and is not judged further;
    a variable of a family is trusted to hold a size of the scale because scale.css and the
    generated tokens.css are its only authors (what scale.css itself declares is not
    measured); `@keyframes` blocks and the values of other properties are not read."""
    found: list[str] = []

    def judge(css: str) -> None:
        for prelude, body in _css_blocks(css):
            if prelude.startswith("@"):
                at_rule = prelude.split(None, 1)[0].split("(")[0]
                if body is None:
                    if at_rule == "@import":
                        if name != INDEX_SHEET:
                            found.append(f"@import outside {INDEX_SHEET}: {prelude}")
                        elif not _OWN_IMPORT.fullmatch(prelude):
                            found.append(
                                f"@import of something other than a .css file of the same directory: {prelude}"
                            )
                    elif at_rule != "@charset":
                        found.append(f"at-rule not allowed: {prelude}")
                elif at_rule in _GROUPING:
                    judge(body)
                elif at_rule != "@keyframes":
                    found.append(f"at-rule not allowed: {prelude}")
                continue
            if body is None:
                found.append(f"not a rule: {prelude}")
                continue
            for selector in _split_selectors(prelude):
                scope = _SCOPE.match(selector)
                if not scope:
                    found.append(f"selector outside the workspace: {selector}")
                elif _leaves_the_frame(selector, scope.end()):
                    found.append(
                        f"selector outside the workspace (a sibling of the frame): {selector}"
                    )
            if _css_blocks(body) and any(
                inner is not None for _, inner in _css_blocks(body)
            ):
                found.append(f"nested rule in: {prelude}")
                continue
            for declaration, _none in _css_blocks(body):
                property_name, colon, value = declaration.partition(":")
                property_name = property_name.strip().lower()
                value = value.replace("!important", "").strip()
                if not colon:
                    continue
                if property_name.startswith("--"):
                    if name != SCALE_SHEET and property_name.startswith(
                        _SIZE_FAMILIES + _RADIUS_FAMILIES
                    ):
                        found.append(
                            f"{property_name} is a variable of the scale, declared outside {SCALE_SHEET} ({prelude})"
                        )
                    continue
                literal = (property_name == "font" and value != "inherit") or (
                    _TOKEN_ONLY.fullmatch(property_name) is not None
                    and not _token_value(property_name, value)
                )
                if literal:
                    found.append(f"{property_name}: {value} is not a token ({prelude})")

    judge(_strip_css_comments(text))
    return found


# An import or re-export statement that is loaded at run time, with its keyword and its
# clause: the default name, `{ A, B as C, type T }`, `* as N`. `import type …` and
# `export type …` are left out by the look-ahead, a side-effect import (`import "./x.css"`)
# has no clause and no name.
_VALUE_STATEMENT = re.compile(
    r"""\b(import|export)\s+(?!type\b)([\w$\s,{}*]+?)\s*from\s*["']([^"']+)["']"""
)
# The name of a component: Pascal case with a lower-case letter. `REVIEW_TASK`, `useLive`,
# `labelOf` and `LABELS` are not one.
_COMPONENT_NAME = re.compile(r"[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*")
# What a client module exports by default, where it can be read: a named function or class,
# a name (`export default labels;`, `export { labels as default }`), or a literal.
_DEFAULT_EXPORT = re.compile(
    r"""\bexport\s+default\s+(?:(?:async\s+)?function\b\s*\*?\s*(?P<function>[\w$]*)"""
    r"""|class\b\s*(?P<class>[\w$]*)|(?P<name>[A-Za-z_$][\w$]*)\s*(?:;|$)|(?P<literal>[\[{"'`0-9]))"""
    r"""|\bexport\s*\{[^}]*?\b(?P<alias>[\w$]+)\s+as\s+default\b""",
    re.M,
)


def _imported_bindings(clause: str) -> list[tuple[str, str]]:
    """(the name the other module exports it under, the local name) for each name a clause
    takes: `default` for the default import, `*` for a namespace; type-only names are left
    out."""
    braces = re.search(r"\{([^}]*)\}", clause)
    outside = re.sub(r"\{[^}]*\}", "", clause)
    bindings: list[tuple[str, str]] = []
    for part in outside.split(","):
        words = part.split()
        if words[:1] == ["*"]:
            bindings.append(("*", words[-1]))
        elif len(words) == 1 and re.fullmatch(r"[\w$]+", words[0]):
            bindings.append(("default", words[0]))
    for part in (braces.group(1) if braces else "").split(","):
        words = part.split()
        if words and words[0] != "type":
            bindings.append((words[0], words[-1]))
    return bindings


def _imported_names(clause: str) -> list[str]:
    """The names a clause takes from the other module, as that module exports them."""
    return [exported for exported, _local in _imported_bindings(clause)]


def _value_use(text: str, local: str) -> str | None:
    """How `local` is used as a value and not rendered: a property read (`Labels.x`,
    `<Menu.Item>`), a call (`Foo(…)`, a tagged template), an index, or `new`. None when it
    is only rendered as a JSX tag, named in a type, or handed on as it is."""
    name = re.escape(local)
    use = re.search(
        rf"(?<![\w$.<]){name}\s*(?:\.(?!\.)|\(|\[|`)|\bnew\s+{name}\b|<\s*{name}\s*\.",
        text,
    )
    return use.group(0).strip() if use else None


def _default_export_that_is_no_component(text: str) -> str | None:
    """What a module exports by default when that can be read and is not a component: the
    name of a function, a class or a value that is not a component's name, or `a literal`.
    None for a component's name and for what cannot be read here (an anonymous function,
    `memo(…)`, an arrow)."""
    found = _DEFAULT_EXPORT.search(text)
    if not found:
        return None
    if found.group("literal"):
        return "a literal"
    name = (
        found.group("function")
        or found.group("class")
        or found.group("name")
        or found.group("alias")
    )
    return name if name and not _COMPONENT_NAME.fullmatch(name) else None


def client_values_read_by_server_modules(tree: Tree) -> list[str]:
    """A module without "use client" takes nothing but components from a module with it, and
    does nothing with them but render them.
    In a React Server Components build every export of a client module is, on the server, a
    reference to that module: a component can be rendered through it, but a constant, a
    function or a hook read on the server is the reference and not the value (a task id
    handed to a jump button is then not the string, although Jest and Storybook, which
    load the real module, show it working). So in every module a workspace URL or the
    showcase can load, under features/workspace and app/workspace, a run-time import or
    re-export from a client module names components only: the default export, or a name in
    Pascal case with a lower-case letter. What is imported under such a name is then used
    as a component: a property read (`Labels.x`, `<Menu.Item>`), a call (`Foo(…)`), an index
    or `new` on it is a value read through the reference, and a fault. A default export that
    can be read to be something else (a function, class or value whose name is not a
    component's, a literal) is a fault as well. A value both sides need lives in a module
    without the directive (the route's model.ts).

    Blind spots, stated so that nobody reads more into a green result:
    - "Component" is judged by the exported name. A value named like a component that is
      only handed on (`options={Labels}`, `[Labels]`) passes: handing a reference on is what
      a server module may do with a component, and the two cannot be told apart here. A
      component exported under another kind of name fails and has to be renamed.
    - The default export is taken to be a component unless its declaration says otherwise:
      an anonymous function, an arrow, `memo(…)`, `forwardRef(…)` and a name the module
      imported from elsewhere are not read.
    - A use is found in the module's text without its comments, not in its syntax tree: the
      local name followed by `.`, `(`, `[` or a back-tick inside a string or in JSX text
      would be reported, and a use through another name (`const L = Labels; L.x`) is not
      seen. A re-export has no local name and is judged by the exported name alone.
    - A namespace import (`* as N`) of a client module is always a fault, used or not.
    - `require()` and `import()` are not read, and neither is what a client module itself
      re-exports from a third module.
    - A module without the directive that only client modules import is bundled for the
      browser and would get the value; it is judged all the same, which is never wrong.
    - Tests, stories and `__fixtures__` are not part of a route and are not judged.
    """
    found = []
    for name in sorted(_workspace_modules(tree)):
        if not name.startswith((f"{FEATURES}/", f"{WORKSPACE}/")):
            continue
        if not _is_source(name) or _uses_client(tree, name):
            continue
        text = _strip_comments(tree.read(name))
        body = _VALUE_STATEMENT.sub("", text)
        for keyword, clause, specifier in _VALUE_STATEMENT.findall(text):
            target = tree.resolve(specifier, name)
            if target is None or not _uses_client(tree, target):
                continue
            for taken, local in _imported_bindings(clause):
                if taken != "default" and not _COMPONENT_NAME.fullmatch(taken):
                    found.append(
                        f"{name}: takes {taken} from the client module {target}"
                    )
                    continue
                if taken == "default":
                    other = _default_export_that_is_no_component(
                        _strip_comments(tree.read(target))
                    )
                    if other:
                        found.append(
                            f"{name}: takes the default export of the client module {target}, which is not a component ({other})"
                        )
                        continue
                use = _value_use(body, local) if keyword == "import" else None
                if use:
                    found.append(
                        f"{name}: reads {local} of the client module {target} as a value ({use})"
                    )
    return found


def forbidden_imports_under_features(tree: Tree) -> list[str]:
    """No file under features/workspace, tests included, imports an established component
    (other than the three allowed modules) or a screen under ideal/screens."""
    found = []
    for name in tree.under(FEATURES):
        for target in tree.imports(name):
            if target.startswith("ideal/screens/") or (
                target.startswith("components/")
                and not target.startswith(ALLOWED_COMPONENTS)
            ):
                found.append(f"{name} -> {target}")
    return sorted(found)


def unreached_workspace_sources(tree: Tree) -> list[str]:
    """features/workspace holds workspace code only: every source file there is loaded by a
    workspace route or by its showcase."""
    reached = _workspace_modules(tree)
    return [
        name
        for name in tree.under(FEATURES)
        if _is_source(name) and name not in reached
    ]


def compatibility_showcase_faults(tree: Tree) -> list[str]:
    """/preview and /showcase are the v1/v2 compatibility showcase, and say so; /workspace
    never reaches the monolithic IdealWorkspace they render."""
    found = []
    for entry in ("app/preview", "app/showcase"):
        if MONOLITH not in tree.reachable([entry]):
            found.append(f"{entry} no longer renders the v1/v2 IdealWorkspace")
        page = tree.read(f"{entry}/[screen]/page.tsx")
        if "v1/v2 compatibility route" not in page or "not v3 evidence" not in page:
            found.append(f"{entry} does not state that it is v1/v2 and not v3 evidence")
    if MONOLITH in _workspace_modules(tree):
        found.append("the workspace reaches the v1/v2 IdealWorkspace")
    return found


def workspace_boundary_faults(tree: Tree) -> list[str]:
    """app/workspace has its own not-found.tsx and error.tsx, so an unknown workspace URL and
    a failed workspace route are never shown by the established product's root pages. The
    error page is a Client Component, as Next.js requires of an error boundary."""
    found = [
        f"{WORKSPACE} has no {posixpath.basename(name)} of its own"
        for name in BOUNDARIES
        if name not in tree.names
    ]
    error = f"{WORKSPACE}/error.tsx"
    if error in tree.names and not _uses_client(tree, error):
        found.append(f'{error} is not a Client Component ("use client")')
    return found


def re_exports_left_in_components(tree: Tree) -> list[str]:
    """The established screens are implementations under components/ again. The one
    re-export left is the unsaved-changes guard: a hook without markup that both products
    use and that lives with the workspace's shared parts."""
    found = []
    for name in tree.names:
        if posixpath.dirname(name) != "components":
            continue
        lines = [line for line in tree.read(name).splitlines() if line.strip()]
        if all(line.startswith(("export ", "//")) for line in lines) and any(
            "@/features/workspace/" in line for line in lines
        ):
            found.append(name)
    return sorted(set(found) - {"components/useUnsavedNavigation.ts"})


def document_faults(readme: str, verification: str) -> list[str]:
    """The README states what the structure test enforces and that /preview and /showcase
    are not v3 evidence, and no longer carries the retired notice that the independence is
    incomplete. The verification record must have its section on the structural
    independence; what that section says is not prescribed, so it may state limits and
    open points."""
    found = []
    if RETIRED_GAP_NOTICE in readme:
        found.append("README still says the independence is incomplete")
    if ENFORCED_STATEMENT not in readme:
        found.append("README does not state what the structure test enforces")
    if COMPATIBILITY_STATEMENT not in readme:
        found.append(
            "README does not state that /preview and /showcase are not v3 evidence"
        )
    # The record must have the section; what it says there is not prescribed, so that a
    # limit or an open point can be stated in plain words.
    if "Structural independence from the established screens" not in verification:
        found.append("verification.md has no section on the structural independence")
    return found


_ROUTE_OF = re.compile(r'routeOf\(\s*"([a-z-]+/[a-z-]+)"\s*\)')


def undeclared_route_links(
    tree: Tree, use_cases: list[dict[str, object]] | None = None
) -> list[str]:
    """A link from one route to another is a transition the use-case contract declares.

    Every `routeOf("screen/view")` in the directory of a route (not its tests) names where
    the route can lead. The contract has no row per pair of routes: a use case names its own
    route and the routes its flow passes through (`transitions`). A link is declared when
    one use case names both ends, as its route or among its transitions. A link in a shared
    part is not judged here (the part does not know which route shows it).
    """
    document = json.loads(USE_CASES.read_text(encoding="utf-8"))
    rows = document["use_cases"] if use_cases is None else use_cases
    flows = [{row["route"], *row["transitions"]} for row in rows]  # type: ignore[misc]
    contract = _contract()
    found = []
    for key, source in sorted(contract.items()):
        directory = _route_directory(key)
        for name in sorted(tree.under(directory)):
            if (
                "/__tests__/" in name
                or "/__fixtures__/" in name
                or not _is_source(name)
            ):
                continue
            for target_key in sorted(
                set(_ROUTE_OF.findall(_strip_comments(tree.read(name))))
            ):
                target = contract.get(target_key)
                if target is None or target == source:
                    continue
                if not any(source in flow and target in flow for flow in flows):
                    found.append(
                        f"{name}: the link from {source} to {target} is not a "
                        "transition of any use case"
                    )
    return found


RULES: dict[str, Callable[[Tree], list[str]]] = {
    "undeclared_route_links": undeclared_route_links,
    "established_modules_reached": established_modules_reached,
    "established_links": established_links,
    "free_workspace_urls": free_workspace_urls,
    "route_definition_faults": route_definition_faults,
    "server_modules_reached_by_client_code": server_modules_reached_by_client_code,
    "server_action_faults": server_action_faults,
    "client_values_read_by_server_modules": client_values_read_by_server_modules,
    "showcase_differences": showcase_differences,
    "cross_purpose_renders": cross_purpose_renders,
    "foreign_class_names": foreign_class_names,
    "unstyled_class_names": unstyled_class_names,
    "forbidden_imports_under_features": forbidden_imports_under_features,
    "unreached_workspace_sources": unreached_workspace_sources,
    "compatibility_showcase_faults": compatibility_showcase_faults,
    "workspace_boundary_faults": workspace_boundary_faults,
    "re_exports_left_in_components": re_exports_left_in_components,
}


@pytest.mark.parametrize("rule", sorted(RULES))
def test_the_workspace_keeps_every_structural_rule(rule: str) -> None:
    assert RULES[rule](REAL) == []


def test_public_documents_state_what_is_enforced_and_no_longer_the_gap() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    verification = (ROOT / "docs/ideal-ui/verification.md").read_text(encoding="utf-8")
    assert document_faults(readme, verification) == []


# --- every rule can fail: one small mutation each, applied in memory -------------------

INPUT_VIEW = f"{FEATURES}/planning/input/InputView.tsx"
INPUT_ROUTE = f"{FEATURES}/planning/input/route.ts"
PRIVACY_VIEW = f"{FEATURES}/governance/privacy/PrivacyView.tsx"
HOME_QUEUE = f"{FEATURES}/home/HomeQueue.tsx"
SHOWCASE_ROUTE = f"{SHOWCASE}/ShowcaseRoute.tsx"
VIEW_PAGE = f"{WORKSPACE}/[screen]/[view]/page.tsx"
NOT_FOUND, ERROR = BOUNDARIES
ROUTES = f"{SHELL}routes.ts"
RUNTIME = f"{SHELL}WorkspaceRuntime.tsx"
ACTUALS_VIEW = f"{FEATURES}/governance/actuals/ActualsView.tsx"
ACTUALS_TASKS = f"{FEATURES}/governance/actuals/ActualTasks.tsx"
ROUTE_PAGE = f"{SHELL}WorkspaceRoutePage.tsx"
STACK = 'return <div className="ideal-stack">'
RE_EXPORT = 'export { default } from "@/features/workspace/shared/ExportPublication";\n'


def _import_into(name: str, statement: str) -> Callable[[Tree], Tree]:
    """Add an import after the file's "use client" directive, if it has one."""

    def mutate(tree: Tree) -> Tree:
        text = tree.read(name)
        directive = _USE_CLIENT.match(text)
        cut = directive.end() if directive else 0
        return tree.with_file(name, f"{text[:cut]}\n{statement}\n{text[cut:]}")

    return mutate


# (rule, what the mutation does, the mutation, a fragment of the violation it must cause)
MUTATIONS: list[tuple[str, str, Callable[[Tree], Tree], str]] = [
    (
        "established_modules_reached",
        "a view imports a screen under ideal/screens",
        _import_into(
            INPUT_VIEW, 'import HomeScreen from "@/ideal/screens/HomeScreen";'
        ),
        "screen implementation: ideal/screens/HomeScreen.tsx",
    ),
    (
        "established_modules_reached",
        "a view imports an established component through a relative path",
        _import_into(
            INPUT_VIEW, 'import ContextLink from "../../../../components/ContextLink";'
        ),
        "established component: components/ContextLink.tsx",
    ),
    (
        "established_modules_reached",
        "a shared part imports the established planning page",
        _import_into(HOME_QUEUE, 'import Planning from "@/app/planning/page";'),
        "established route: app/planning/page.tsx",
    ),
    (
        "established_modules_reached",
        "a workspace page wraps the route in the earlier API provider again",
        _import_into(
            VIEW_PAGE,
            'import ApiWorkspaceProvider from "@/ideal/providers/ApiWorkspaceProvider";',
        ),
        "earlier pipeline: ideal/providers/ApiWorkspaceProvider.tsx",
    ),
    (
        "established_modules_reached",
        "the showcase falls back to the synthetic provider again",
        _import_into(
            SHOWCASE_ROUTE,
            'import SyntheticWorkspaceProvider from "@/ideal/providers/SyntheticWorkspaceProvider";',
        ),
        "earlier pipeline: ideal/synthetic.ts",
    ),
    (
        "established_modules_reached",
        "a view imports an established component through the baseUrl (a bare specifier)",
        _import_into(INPUT_VIEW, 'import ContextLink from "components/ContextLink";'),
        "established component: components/ContextLink.tsx",
    ),
    (
        "established_modules_reached",
        "an island imports a screen under ideal/screens through the baseUrl",
        _import_into(HOME_QUEUE, 'import HomeScreen from "ideal/screens/HomeScreen";'),
        "screen implementation: ideal/screens/HomeScreen.tsx",
    ),
    (
        "established_modules_reached",
        "the workspace's not-found page shows the established navigation",
        _import_into(
            NOT_FOUND, 'import GlobalNavigation from "@/components/GlobalNavigation";'
        ),
        "established component: components/GlobalNavigation.tsx",
    ),
    (
        "established_modules_reached",
        "the workspace's error page hands over to the application's root error page",
        lambda tree: tree.with_file(
            ERROR, '"use client";\nexport { default } from "@/app/error";\n'
        ),
        "established route: app/error.tsx",
    ),
    (
        "established_links",
        "the workspace's not-found page links to /planning",
        lambda tree: tree.edited(NOT_FOUND, '<a href="/">', '<a href="/planning">'),
        'href="/planning',
    ),
    (
        "established_links",
        "a view links to /planning",
        lambda tree: tree.edited(
            INPUT_VIEW,
            STACK,
            'return <div className="ideal-stack"><a href="/planning">x</a>',
        ),
        'href="/planning',
    ),
    (
        "established_links",
        "an island navigates to /dashboard after a change",
        lambda tree: tree.edited(
            HOME_QUEUE,
            "export default function",
            "const leave = () => browserNavigation.replace(`/dashboard?scope=${1}`);\nexport default function",
        ),
        "replace(`/dashboard",
    ),
    (
        "free_workspace_urls",
        "a view writes a /workspace URL instead of naming a route",
        lambda tree: tree.edited(
            PRIVACY_VIEW,
            'routeOf("governance/audit").route',
            '"/workspace/governance/audit"',
        ),
        PRIVACY_VIEW,
    ),
    (
        "route_definition_faults",
        "a route loses its definition",
        lambda tree: tree.with_file(INPUT_ROUTE, None),
        "route without a definition: plan/input",
    ),
    (
        "route_definition_faults",
        "a second definition appears beside the contract",
        lambda tree: tree.with_file(
            f"{FEATURES}/planning/extra/route.ts", tree.read(INPUT_ROUTE)
        ),
        "definition without a route",
    ),
    (
        "route_definition_faults",
        "a definition declares another route's key",
        lambda tree: tree.edited(
            INPUT_ROUTE, 'key: "plan/input"', 'key: "plan/drafts"'
        ),
        "its key is not plan/input",
    ),
    (
        "route_definition_faults",
        "the registry gives a key another directory's definition",
        lambda tree: tree.edited(
            ROUTES, '"plan/input": planInput,', '"plan/input": planDrafts,'
        ),
        "plan/input: registered from",
    ),
    (
        "route_definition_faults",
        "the registry stops being total",
        lambda tree: tree.edited(
            ROUTES,
            "} satisfies { [K in WorkspaceRouteKey]: AnyRouteDefinition };",
            "};",
        ),
        "the registry is not total by type",
    ),
    (
        "route_definition_faults",
        "a View becomes a Client Component",
        lambda tree: tree.with_file(
            INPUT_VIEW, '"use client";\n' + tree.read(INPUT_VIEW)
        ),
        "is a Client Component",
    ),
    (
        "route_definition_faults",
        "a View becomes async",
        lambda tree: tree.edited(
            INPUT_VIEW,
            "export default function InputView",
            "export default async function InputView",
        ),
        "is async",
    ),
    (
        "server_modules_reached_by_client_code",
        "a client island imports the server transport",
        _import_into(
            f"{FEATURES}/planning/generate/GenerateJobs.tsx",
            'import { createServerTransport } from "../../shell/server/transport";',
        ),
        "features/workspace/shell/server/transport.ts",
    ),
    (
        "server_modules_reached_by_client_code",
        "the runtime imports the refresh action, and the action reads through the server",
        lambda tree: _import_into(
            RUNTIME, 'import { refreshRoute } from "./actions/refreshRoute";'
        )(
            _import_into(
                REFRESH_ACTION,
                'import { createServerTransport } from "../server/transport";',
            )(tree)
        ),
        "features/workspace/shell/server/transport.ts",
    ),
    (
        "server_action_faults",
        "the refresh action reads through the server transport",
        _import_into(
            REFRESH_ACTION,
            'import { createServerTransport } from "../server/transport";',
        ),
        "a Server Action imports ../server/transport",
    ),
    (
        "server_action_faults",
        "the refresh action reads the session cookie",
        _import_into(REFRESH_ACTION, 'import { cookies } from "next/headers";'),
        "a Server Action imports next/headers",
    ),
    (
        "server_action_faults",
        "the refresh action takes an argument that selects what is read",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            "refreshRoute(): Promise<void>",
            "refreshRoute(scope: string): Promise<void>",
        ),
        "exports more than a function without parameters",
    ),
    (
        "server_action_faults",
        "the refresh action answers with data",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            "refreshRoute(): Promise<void>",
            "refreshRoute(): Promise<string>",
        ),
        "exports more than a function without parameters",
    ),
    (
        "server_action_faults",
        "the action module exports a second thing",
        lambda tree: tree.with_file(
            REFRESH_ACTION,
            tree.read(REFRESH_ACTION)
            + "export const read = async (id: string) => id;\n",
        ),
        "export const read",
    ),
    (
        "server_action_faults",
        "the refresh action reads its arguments without declaring them",
        lambda tree: tree.edited(
            REFRESH_ACTION, "  refresh();", "  refresh(); void arguments[0];"
        ),
        "a Server Action reads its arguments",
    ),
    (
        "server_action_faults",
        "the refresh action loads the session cookie with require",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            "  refresh();",
            '  require("next/headers");\n  refresh();',
        ),
        "holds more than the directive",
    ),
    (
        "server_action_faults",
        "the refresh action calls the API with the global fetch",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            "  refresh();",
            '  await fetch("https://api.invalid/planning/scopes");\n  refresh();',
        ),
        "holds more than the directive",
    ),
    (
        "server_action_faults",
        "another export of next/cache is imported under the name refresh",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            'import { refresh } from "next/cache";',
            'import { revalidatePath as refresh } from "next/cache";',
        ),
        "holds more than the directive",
    ),
    (
        "server_action_faults",
        "the client runtime reaches the action through a module without a directive",
        lambda tree: _import_into(RUNTIME, 'import { refreshRoute } from "./relay";')(
            tree.with_file(
                f"{SHELL}relay.ts",
                'export { refreshRoute } from "./actions/refreshRoute";\n',
            )
        ),
        "a Client Component imports the Server Action",
    ),
    (
        "server_action_faults",
        "a Server Action kept outside the workspace is loaded by the client runtime",
        lambda tree: _import_into(
            RUNTIME, 'import { saveNote } from "@/lib/saveNote";'
        )(
            tree.with_file(
                "lib/saveNote.ts",
                '"use server";\nexport async function saveNote(): Promise<void> {}\n',
            )
        ),
        "lib/saveNote.ts: a Server Action outside",
    ),
    (
        "server_action_faults",
        "an export hidden behind a line comment that ends at U+2028",
        lambda tree: tree.with_file(
            REFRESH_ACTION,
            tree.read(REFRESH_ACTION)
            + "//\u2028export async function leak(path: string) "
            "{ return (await fetch(path)).text(); }\n",
        ),
        "holds more than the directive",
    ),
    (
        "server_action_faults",
        "a statement hidden behind a line comment that ends at a lone CR",
        lambda tree: tree.edited(
            REFRESH_ACTION,
            "  refresh();",
            '  //\r  require("next/headers");\n  refresh();',
        ),
        "holds more than the directive",
    ),
    (
        "server_action_faults",
        "a Server Action module beside a view whose directive is followed by a comment",
        lambda tree: tree.with_file(
            f"{FEATURES}/people/saveNote.ts",
            '"use server"; // actions of people\n'
            "export async function saveNote(): Promise<void> {}\n",
        ),
        f"{FEATURES}/people/saveNote.ts: a Server Action outside",
    ),
    (
        "server_action_faults",
        "a view declares a Server Action in a function written on one line",
        lambda tree: tree.edited(
            INPUT_VIEW,
            "export default function InputView",
            'export async function save(id: string) { "use server"; return id; }\n'
            "export default function InputView",
        ),
        f"{INPUT_VIEW}: a Server Action outside",
    ),
    (
        "server_action_faults",
        "a Server Action in a view, after a string that looks like the start of a comment",
        lambda tree: tree.edited(
            INPUT_VIEW,
            "export default function InputView",
            'const ACCEPT = "image/*";\n'
            'export async function save(id: string) {\n  "use server";\n  return id + ACCEPT;\n}\n'
            "/** The view. */\n"
            "export default function InputView",
        ),
        f"{INPUT_VIEW}: a Server Action outside",
    ),
    (
        "server_action_faults",
        "a Client Component whose directive follows a comment that ends at a lone CR",
        lambda tree: _import_into(ROUTE_PAGE, 'import Island from "./Island";')(
            tree.with_file(
                f"{SHELL}Island.tsx",
                '// an island\r"use client";\n'
                'import { refreshRoute } from "./actions/refreshRoute";\n'
                "export default function Island() { void refreshRoute; return null; }\n",
            )
        ),
        f"{SHELL}Island.tsx: a Client Component imports the Server Action",
    ),
    (
        "server_action_faults",
        "the client runtime imports the action in a statement that only looks type-only",
        _import_into(
            RUNTIME, 'import type , * as actions from "./actions/refreshRoute";'
        ),
        "a Client Component imports the Server Action",
    ),
    (
        "server_action_faults",
        "the client runtime imports the action after a type export without a semicolon",
        _import_into(
            RUNTIME,
            "export type Unused = number\n"
            'import { refreshRoute as direct } from "./actions/refreshRoute"',
        ),
        "a Client Component imports the Server Action",
    ),
    (
        "server_action_faults",
        "the action module loses its directive",
        lambda tree: tree.edited(REFRESH_ACTION, '"use server";', ""),
        "is not a Server Action module",
    ),
    (
        "server_action_faults",
        "a Server Action module appears beside a view",
        lambda tree: tree.with_file(
            f"{FEATURES}/planning/input/saveInput.ts",
            '"use server";\nexport async function saveInput(): Promise<void> {}\n',
        ),
        f"{FEATURES}/planning/input/saveInput.ts: a Server Action outside",
    ),
    (
        "server_action_faults",
        "a view declares a Server Action inside a function",
        lambda tree: tree.edited(
            INPUT_VIEW,
            "export default function InputView",
            'async function save() {\n  "use server";\n}\nexport default function InputView',
        ),
        f"{INPUT_VIEW}: a Server Action outside",
    ),
    (
        "server_action_faults",
        "the client runtime imports the action instead of being handed it",
        _import_into(RUNTIME, 'import { refreshRoute } from "./actions/refreshRoute";'),
        "a Client Component imports the Server Action",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view reads a task id that a client module exports",
        lambda tree: tree.edited(
            ACTUALS_TASKS,
            "export default function ActualTasks",
            'export const REVIEW_ID = "actuals-task-review";\n'
            "export default function ActualTasks",
        ).edited(
            ACTUALS_VIEW,
            'import ActualTasks from "./ActualTasks";',
            'import ActualTasks, { REVIEW_ID } from "./ActualTasks";',
        ),
        f"{ACTUALS_VIEW}: takes REVIEW_ID from the client module {ACTUALS_TASKS}",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view calls a hook of a client module",
        _import_into(
            ACTUALS_VIEW,
            'import { useLive as live } from "../../shell/WorkspaceRuntime";',
        ),
        f"takes useLive from the client module {RUNTIME}",
    ),
    (
        "client_values_read_by_server_modules",
        "a module without the directive passes a client module's value on",
        _import_into(
            f"{FEATURES}/governance/actuals/model.ts",
            'export { REVIEW_ID } from "./ActualTasks";',
        ),
        f"takes REVIEW_ID from the client module {ACTUALS_TASKS}",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view reads a property of what it imported as a component",
        lambda tree: tree.edited(
            ACTUALS_VIEW,
            "export default function ActualsView",
            "const REVIEW_ID = ActualTasks.reviewId;\nexport default function ActualsView",
        ),
        f"{ACTUALS_VIEW}: reads ActualTasks of the client module {ACTUALS_TASKS} as a value (ActualTasks.)",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view calls what a client module exports under a component's name",
        lambda tree: tree.edited(
            ACTUALS_TASKS,
            "export default function ActualTasks",
            "export function TaskLabels() { return {}; }\n"
            "export default function ActualTasks",
        ).edited(
            ACTUALS_VIEW,
            'import ActualTasks from "./ActualTasks";',
            'import ActualTasks, { TaskLabels as Labels } from "./ActualTasks";\n'
            "const LABELS = Labels();",
        ),
        f"{ACTUALS_VIEW}: reads Labels of the client module {ACTUALS_TASKS} as a value (Labels()",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view renders a member of a client module's export",
        lambda tree: tree.edited(
            ACTUALS_VIEW,
            "export default function ActualsView",
            "export const Part = () => <ActualTasks.Review />;\nexport default function ActualsView",
        ),
        f"{ACTUALS_VIEW}: reads ActualTasks of the client module {ACTUALS_TASKS} as a value (<ActualTasks.)",
    ),
    (
        "client_values_read_by_server_modules",
        "a client module's default export is a hook, and a server-rendered view takes it",
        lambda tree: tree.edited(
            ACTUALS_TASKS,
            "export default function ActualTasks",
            "export function ActualTasks",
        )
        .edited(
            ACTUALS_TASKS,
            '"use client";',
            '"use client";\nexport default function useActualTasks() { return null; }',
        )
        .edited(
            ACTUALS_VIEW,
            'import ActualTasks from "./ActualTasks";',
            'import Tasks, { ActualTasks } from "./ActualTasks";',
        ),
        f"{ACTUALS_VIEW}: takes the default export of the client module {ACTUALS_TASKS}, which is not a component (useActualTasks)",
    ),
    (
        "client_values_read_by_server_modules",
        "a server-rendered view takes a client module as a namespace",
        _import_into(ACTUALS_VIEW, 'import * as tasks from "./ActualTasks";'),
        f"{ACTUALS_VIEW}: takes * from the client module {ACTUALS_TASKS}",
    ),
    (
        "showcase_differences",
        "the showcase gets a screen of its own",
        lambda tree: _import_into(
            SHOWCASE_ROUTE, 'import Own from "../planning/own/OwnView";'
        )(
            tree.with_file(
                f"{FEATURES}/planning/own/OwnView.tsx",
                "export default function OwnView() { return null; }\n",
            )
        ),
        "only in the showcase: features/workspace/planning/own/OwnView.tsx",
    ),
    (
        "cross_purpose_renders",
        "a view renders the cross-purpose compliance screen",
        lambda tree: tree.edited(
            INPUT_VIEW,
            STACK,
            'return <div className="ideal-stack"><ComplianceWorkspace section="leave" />',
        ),
        "<ComplianceWorkspace",
    ),
    (
        "foreign_class_names",
        "a view is wrapped in the adapter again",
        lambda tree: tree.edited(
            INPUT_VIEW,
            STACK,
            'return <div className="ideal-v3-purpose ideal-v3-purpose--process">',
        ),
        "ideal-v3-purpose",
    ),
    (
        "foreign_class_names",
        "an island uses a class of the established screens inside an expression",
        lambda tree: tree.edited(
            HOME_QUEUE,
            'className="ideal-link ideal-link--target"',
            'className={`ideal-link ${ready ? "ui-button" : "workflow-panel"}`}',
        ),
        "workflow-panel",
    ),
    (
        "foreign_class_names",
        "a view uses a utility class",
        lambda tree: tree.edited(
            INPUT_VIEW, STACK, 'return <div className="ideal-stack space-y-2">'
        ),
        "space-y-2",
    ),
    (
        "unstyled_class_names",
        "a view uses a class no stylesheet has a rule for",
        lambda tree: tree.edited(
            INPUT_VIEW,
            STACK,
            'return <div className="ideal-stack ideal-unruled-example">',
        ),
        f"{INPUT_VIEW}: ideal-unruled-example has no rule",
    ),
    (
        "unstyled_class_names",
        "an island marks a state with an is- class no stylesheet knows",
        lambda tree: tree.edited(
            HOME_QUEUE,
            'className="ideal-link ideal-link--target"',
            'className={`ideal-link ${ready ? "is-unruled" : ""}`}',
        ),
        f"{HOME_QUEUE}: is-unruled has no rule",
    ),
    (
        "unstyled_class_names",
        "a view builds a class from a prefix whose values nobody declared",
        lambda tree: tree.edited(
            INPUT_VIEW,
            STACK,
            "return <div className={`ideal-stack ideal-step--${step}`}>",
        ),
        f"{INPUT_VIEW}: ideal-step--${{…}} has no declared variants",
    ),
    (
        "unstyled_class_names",
        "the tone union gains a value that the pill has no rule for",
        lambda tree: tree.edited(
            MODEL, '| "danger" | "info";', '| "danger" | "info" | "urgent";'
        ),
        "ideal/ui/atoms.tsx: ideal-pill--urgent has no rule",
    ),
    (
        "forbidden_imports_under_features",
        "a workspace test imports an established component",
        _import_into(
            f"{FEATURES}/shell/__tests__/WorkspaceLink.test.tsx",
            'import ContextLink from "@/components/ContextLink";',
        ),
        "components/ContextLink.tsx",
    ),
    (
        "unreached_workspace_sources",
        "an established implementation is parked under features/workspace again",
        lambda tree: tree.with_file(
            f"{FEATURES}/people/ContractWorkflow.tsx",
            tree.read("components/ContractWorkflow.tsx"),
        ),
        f"{FEATURES}/people/ContractWorkflow.tsx",
    ),
    (
        "compatibility_showcase_faults",
        "a workspace page renders the v1/v2 IdealWorkspace",
        _import_into(
            VIEW_PAGE, 'import IdealWorkspace from "@/components/ideal/IdealWorkspace";'
        ),
        "the workspace reaches the v1/v2 IdealWorkspace",
    ),
    (
        "compatibility_showcase_faults",
        "the showcase route drops the statement that it is not v3 evidence",
        lambda tree: tree.edited(
            "app/showcase/[screen]/page.tsx", "not v3 evidence", "evidence"
        ),
        "app/showcase does not state",
    ),
    (
        "workspace_boundary_faults",
        "the workspace loses its own not-found page",
        lambda tree: tree.with_file(NOT_FOUND, None),
        f"{WORKSPACE} has no not-found.tsx of its own",
    ),
    (
        "workspace_boundary_faults",
        "the workspace loses its own error page",
        lambda tree: tree.with_file(ERROR, None),
        f"{WORKSPACE} has no error.tsx of its own",
    ),
    (
        "workspace_boundary_faults",
        "the workspace's error page stops being a Client Component",
        lambda tree: tree.edited(ERROR, '"use client";', ""),
        "is not a Client Component",
    ),
    (
        "undeclared_route_links",
        "a route links to a route no use case of it passes through",
        lambda tree: tree.edited(
            f"{FEATURES}/planning/publications/PublicationsView.tsx",
            'routeOf("settings/notifications")',
            'routeOf("governance/recovery")',
        ),
        "the link from /workspace/plan/publications to /workspace/governance/recovery",
    ),
    (
        "re_exports_left_in_components",
        "an established path becomes a re-export of a workspace module again",
        lambda tree: tree.with_file("components/PublicationExport.tsx", RE_EXPORT),
        "components/PublicationExport.tsx",
    ),
]


@pytest.mark.parametrize(
    ("rule", "mutation", "expected"),
    [(rule, mutation, expected) for rule, _what, mutation, expected in MUTATIONS],
    ids=[what for _rule, what, _mutation, _expected in MUTATIONS],
)
def test_every_structural_rule_fails_on_its_mutation(
    rule: str, mutation: Callable[[Tree], Tree], expected: str
) -> None:
    violations = RULES[rule](mutation(REAL))
    assert any(expected in violation for violation in violations), violations


def test_every_rule_has_a_mutation_that_proves_it_can_fail() -> None:
    assert {rule for rule, *_ in MUTATIONS} == set(RULES)


def test_a_missing_or_added_route_of_the_contract_is_a_fault() -> None:
    contract = _contract()
    assert len(contract) == 25
    grown = {**contract, "plan/archive": "/workspace/plan/archive"}
    assert "route without a definition: plan/archive" in route_definition_faults(
        REAL, grown
    )
    shrunk = {key: path for key, path in contract.items() if key != "settings/flextime"}
    faults = route_definition_faults(REAL, shrunk)
    assert (
        f"definition without a route: {FEATURES}/settings/flextime/route.ts" in faults
    )
    assert "registered twice or unknown: settings/flextime" in faults
    # The directory of a key: the screen's purpose, then the view in camel case.
    assert _route_directory("plan/input") == f"{FEATURES}/planning/input"
    assert (
        _route_directory("settings/absence-consent")
        == f"{FEATURES}/settings/absenceConsent"
    )
    assert _route_directory("home/index") == f"{FEATURES}/home"


def test_public_documents_rule_fails_on_the_old_notice_and_on_a_missing_statement() -> (
    None
):
    good_readme = f"- {ENFORCED_STATEMENT}{COMPATIBILITY_STATEMENT}"
    good_record = "## Structural independence from the established screens\nEnforced."
    assert document_faults(good_readme, good_record) == []
    assert document_faults(good_readme + RETIRED_GAP_NOTICE, good_record)
    assert document_faults("", good_record)
    assert document_faults(ENFORCED_STATEMENT, good_record)
    assert document_faults(good_readme, "Independence: not achieved")
    # Beyond its heading the record is free to state limits and open points.
    assert document_faults(good_readme, good_record + " This is not achieved.") == []


# --- the import-graph resolver itself --------------------------------------------------


def test_import_graph_resolver_follows_aliases_relatives_and_indexes() -> None:
    reachable = REAL.reachable([WORKSPACE])
    assert "features/workspace/shell/WorkspaceShell.tsx" in reachable  # "@/..." alias
    assert "ideal/live/context.ts" in reachable  # relative, reached transitively
    assert len(reachable) > 50
    tree = Tree(
        {
            "probe/page.tsx": 'import a from "./purpose";\nimport type { B } from "@/probe/types";\n'
            'const c = import("../probe/lazy");\nimport "react";\nexport { d } from "./purpose/deep/../d";\n',
            "probe/purpose/index.ts": "export default 1;\n",
            "probe/purpose/d.tsx": "export const d = 1;\n",
            "probe/types.ts": "export type B = 1;\n",
            "probe/lazy.ts": "export default 1;\n",
        }
    )
    assert (
        tree.resolve("./purpose", "probe/page.tsx") == "probe/purpose/index.ts"
    )  # a directory's index
    assert tree.resolve("react", "probe/page.tsx") is None  # packages are skipped
    # A bare specifier whose first segment is a top-level directory of frontend/src is
    # resolved through the baseUrl; any other bare specifier is a package.
    assert tree.resolve("probe/purpose/d", "probe/page.tsx") == "probe/purpose/d.tsx"
    assert tree.resolve("probe/missing", "probe/page.tsx") is None
    assert tree.resolve("lucide-react", "probe/page.tsx") is None
    assert tree.resolve("next/navigation", "probe/page.tsx") is None
    assert REAL.resolve("components/ContextLink", INPUT_VIEW) == (
        "components/ContextLink.tsx"
    )
    assert REAL.resolve("ideal/screens/HomeScreen", INPUT_VIEW) == (
        "ideal/screens/HomeScreen.tsx"
    )
    assert {"app", "components", "features", "ideal", "lib"} <= REAL.roots
    assert tree.resolve("@/probe/missing", "probe/page.tsx") is None
    assert tree.reachable(["probe/page.tsx"]) == {
        "probe/page.tsx",
        "probe/purpose/index.ts",
        "probe/purpose/d.tsx",
        "probe/types.ts",
        "probe/lazy.ts",
    }
    # A type-only import is erased by the compiler: it is not a run-time edge.
    assert "probe/types.ts" not in tree.reachable(["probe/page.tsx"], runtime_only=True)
    assert (
        tree.with_file("probe/lazy.ts", None).resolve("../probe/lazy", "probe/page.tsx")
        is None
    )


def test_class_names_are_read_from_literals_templates_and_expressions() -> None:
    text = (
        '<a className="ideal-a sr-only" />'
        "<b className={`ideal-b ideal-dot--${tone} ${open ? `is-open` : ''}`} />"
        '<i className={current ? "ideal-c is-current" : done ? "is-done" : undefined} />'
        "<u className={styles.plain} />"
    )
    assert _class_names(text) == {
        "ideal-a",
        "sr-only",
        "ideal-b",
        "ideal-dot--",
        "is-open",
        "ideal-c",
        "is-current",
        "is-done",
    }
    assert _USE_CLIENT.match('// note\n/* more */\n"use client";\nimport x from "y";')
    assert not _USE_CLIENT.match('import x from "y";\nconst s = "use client";')


def test_a_client_export_is_rendered_or_handed_on_and_never_read() -> None:
    """Positive and negative strings for the two readers the rule gained."""
    for text, use in (
        ("const id = Labels.review;", "Labels."),
        ("const all = Labels [0];", "Labels ["),
        ("const view = Tasks({ a: 1 });", "Tasks("),
        ("const made = new Tasks();", "new Tasks"),
        ("const said = Tasks`x`;", "Tasks`"),
        ("return <Tasks.Review />;", "<Tasks."),
        ("return <p>{Labels.name}</p>;", "Labels."),
    ):
        local = "Labels" if "Labels" in text else "Tasks"
        assert _value_use(text, local) == use, text
    for text in (
        "return <Tasks listing={listing} />;",
        "return <Tasks>{children}</Tasks>;",
        "type Props = ComponentProps<typeof Tasks>;",
        "export default defineRoute({ key, View: Tasks });",
        "const parts = [Tasks, Labels];",
        "return <Frame icon={Tasks} {...Labels} />;",
        "const other = model.Tasks(1) + AllTasks(2) + TasksList.x + $Tasks.y;",
        "return <AllTasks.Item />;",
    ):
        assert _value_use(text, "Tasks") is None, text
    for text, what in (
        ("export default function useTasks() {}", "useTasks"),
        ("export default async function load() {}", "load"),
        ("export default class store {}", "store"),
        ("const labels = {};\nexport default labels;", "labels"),
        ("export default LABELS;", "LABELS"),
        ('export default { review: "x" };', "a literal"),
        ('export default "review";', "a literal"),
        ("export default [1, 2];", "a literal"),
        ("const labels = {};\nexport { labels as default };", "labels"),
    ):
        assert _default_export_that_is_no_component(text) == what, text
    for text in (
        "export default function Tasks() {}",
        "export default class Tasks extends Component {}",
        "function Tasks() {}\nexport default Tasks;",
        "export { Tasks as default };",
        # Not readable here: taken to be a component (a stated blind spot).
        "export default function () {}",
        "export default memo(Tasks);",
        "export default () => null;",
        "export const Tasks = 1;",
    ):
        assert _default_export_that_is_no_component(text) is None, text
    assert _imported_bindings("Tasks, { A, B as C, type T, default as D }") == [
        ("default", "Tasks"),
        ("A", "A"),
        ("B", "C"),
        ("default", "D"),
    ]
    assert _imported_bindings("* as all") == [("*", "all")]
    assert _imported_names("Tasks, { A, B as C, type T }") == ["default", "A", "B"]


def test_a_template_class_needs_a_rule_for_each_declared_value() -> None:
    css = _stylesheets()
    assert _union(REAL, "Tone") == ("neutral", "good", "warn", "danger", "info")
    assert _union(REAL, "MetricTone") == ("neutral", "good", "warn", "danger")
    # The neutral tone is the base class's own look, so its absence is not a fault ...
    without_neutral = re.sub(r"\.ideal-pill--neutral(?![\w-])", ".ideal-lost", css)
    assert not _has_rule(without_neutral, "ideal-pill--neutral")
    assert unstyled_class_names(REAL, without_neutral) == []
    # ... and every other value is: a stylesheet that loses one is reported.
    for token in ("ideal-pill--info", "ideal-metric--danger", "ideal-dot--new"):
        assert _has_rule(css, token)
        lost = re.sub(rf"\.{token}(?![\w-])", ".ideal-lost", css)
        assert any(
            fault.endswith(f"{token} has no rule")
            for fault in unstyled_class_names(REAL, lost)
        ), token
    # A rule for a longer name is not a rule for the shorter one.
    assert _has_rule(
        ".ideal-case-summary__head { margin: 0 }", "ideal-case-summary__head"
    )
    assert not _has_rule(
        ".ideal-case-summary__head { margin: 0 }", "ideal-case-summary"
    )
    assert not _has_rule(
        ".ideal-button--danger-soft { margin: 0 }", "ideal-button--danger"
    )


def test_a_class_is_ruled_by_a_selector_and_by_nothing_else() -> None:
    """A class named in a comment or in a declaration has no look: only a selector gives one."""
    ruled = "@media (max-width: 520px) { @supports (display: grid) { .ideal-v3-app .ideal-v3-example > li { margin: 0; } } }"
    assert _has_rule(ruled, "ideal-v3-example")
    for unruled in (
        "/* .ideal-v3-example is drawn by the browser */ .ideal-v3-app .ideal-note { margin: 0; }",
        "/* .ideal-v3-example { margin: 0; } */",
        '.ideal-v3-app .ideal-note::before { content: ".ideal-v3-example"; }',
        ".ideal-v3-app .ideal-note { --ideal-v3-note: .ideal-v3-example; }",
        "@keyframes ideal-v3-turn { from { rotate: 0deg; } } .ideal-v3-app .ideal-note { animation-name: ideal-v3-example; }",
        '@import "./.ideal-v3-example.css";',
    ):
        assert not _has_rule(unruled, "ideal-v3-example"), unruled
    # A brace in a string does not end the rule, and a comment mark in a string starts none.
    quoted = '.ideal-v3-app .ideal-note::before { content: "}"; } .ideal-v3-app .ideal-v3-example { margin: 0; }'
    assert _has_rule(quoted, "ideal-v3-example")
    marked = '.ideal-v3-app .ideal-note::before { content: "/*"; } .ideal-v3-app .ideal-v3-example { margin: 0; } /* */'
    assert _has_rule(marked, "ideal-v3-example")
    # On the real tree: a class that loses its selector and keeps only a mention in a comment is reported.
    css = _stylesheets()
    token = "ideal-v3-scroll-cue"
    assert _has_rule(css, token)
    commented = (
        re.sub(rf"\.{token}(?![\w-])", ".ideal-lost", css) + f"\n/* .{token} */\n"
    )
    assert any(
        fault.endswith(f"{token} has no rule")
        for fault in unstyled_class_names(REAL, commented)
    )


def test_the_pending_style_list_names_only_what_is_still_unstyled() -> None:
    """The list is not a way around the rule: without it each entry is reported, an entry that
    has gained a rule is reported, and so is one that nothing uses."""
    css = _stylesheets()
    unlisted = unstyled_class_names(REAL, css, frozenset())
    assert sorted(fault.rsplit(": ", 1)[1] for fault in unlisted) == sorted(
        f"{token} has no rule" for token in PENDING_STYLE
    )
    for token in sorted(PENDING_STYLE):
        ruled = f"{css}\n.ideal-v3-app .{token} {{ margin: 0; }}\n"
        assert unstyled_class_names(REAL, ruled) == [
            f"PENDING_STYLE: {token} has a rule now"
        ]
    assert unstyled_class_names(
        REAL, css, PENDING_STYLE | {"ideal-retired-example"}
    ) == ["PENDING_STYLE: ideal-retired-example is not used any more"]


SCOPED_STYLES = """
/* A comment with a selector in it: .ideal-panel { font-size: 2rem } */
.ideal-v3-app { --ideal-v3-on-teal: 255 255 255; --ideal-v3-measure: 48rem; }
:root[data-theme="dark"] .ideal-v3-app { --ideal-v3-tint: .45; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .ideal-v3-app { --ideal-v3-tint: .45; }
}
.ideal-v3-app .ideal-panel > h2, .ideal-v3-app .ideal-toolbar h2 {
  font-size: var(--ideal-v3-text-lg); font-weight: var(--ideal-v3-weight-heading);
}
.ideal-v3-app :is(.ideal-table th, .ideal-table td) { min-width: 5em; font: inherit; }
.ideal-v3-app .ideal-table-wrap { border: 1px solid rgb(var(--color-line)); border-radius: var(--radius-control); }
.ideal-v3-app .ideal-dot { border-radius: 50%; font-size: inherit; }
.ideal-v3-app .ideal-v3-task { border-start-start-radius: var(--ideal-v3-radius-flat) !important; }
.ideal-v3-app .ideal-note { font-size: var(--font-size-dense); }
.ideal-v3-app .ideal-table-wrap + .ideal-v3-disclosure, .ideal-v3-app .ideal-note ~ .ideal-note { margin-top: 0; }
.ideal-v3-app > .ideal-v3-main [title="a) b, c ~ d"], .ideal-v3-app:has(.ideal-detail) .ideal-note::before { content: "} ; { /* +"; }
html:has(.ideal-v3-app .ideal-detail) { scroll-padding-bottom: 6rem; }
body:has(.ideal-v3-app) { overflow-x: clip; }
@media (max-width: 520px) { @supports (display: grid) { .ideal-v3-app .ideal-button { white-space: normal; min-width: 8em; } } }
@keyframes ideal-v3-turn { from { rotate: 0deg; } to { rotate: 90deg; } }
"""
# What only two files may hold: the scale's own variables, and the imports of the others.
SCALE_STYLES = """
.ideal-v3-app { --ideal-v3-text-xs: .75rem; --ideal-v3-radius-flat: 0px; --ideal-v3-measure: 48rem; }
:root[data-theme="dark"] .ideal-v3-app { --ideal-v3-tint: .45; }
"""
INDEX_STYLES = """
@charset "utf-8";
@import "./scale.css";
@import './people-contracts.css';
@import url("./shell.css");
"""


def test_a_workspace_stylesheet_is_scoped_to_the_workspace_and_sized_by_tokens() -> (
    None
):
    assert css_scope_faults(SCOPED_STYLES) == []
    assert css_scope_faults(SCOPED_STYLES, "people.css") == []
    assert css_scope_faults(SCALE_STYLES, SCALE_SHEET) == []
    assert css_scope_faults(INDEX_STYLES, INDEX_SHEET) == []
    sheets = _workspace_stylesheets()  # none until the directory exists
    for path in sheets:
        name = path.relative_to(WORKSPACE_STYLES).as_posix()
        assert css_scope_faults(path.read_text(encoding="utf-8"), name) == [], name
    # The two files with a part of their own exist, at the top of the directory.
    assert {INDEX_SHEET, SCALE_SHEET} <= {
        path.relative_to(WORKSPACE_STYLES).as_posix() for path in sheets
    }


def test_a_stylesheet_in_a_sub_directory_is_read_like_the_others(
    tmp_path, monkeypatch
) -> None:
    """A file in a folder under styles/workspace is one of the workspace's stylesheets: its
    rules count for a class, and its selectors and sizes are judged. It is neither index.css
    nor scale.css, whatever it is called."""
    module = sys.modules[__name__]
    monkeypatch.setattr(module, "WORKSPACE_STYLES", tmp_path)
    (tmp_path / "parts").mkdir()
    (tmp_path / "index.css").write_text('@import "./scale.css";\n', encoding="utf-8")
    (tmp_path / "parts" / "index.css").write_text(
        '@import "./deep.css";\n.ideal-panel { margin: 0; }\n', encoding="utf-8"
    )
    (tmp_path / "parts" / "scale.css").write_text(
        ".ideal-v3-app .ideal-v3-deep-example { --ideal-v3-text-sm: 9px; }\n",
        encoding="utf-8",
    )
    names = [path.relative_to(tmp_path).as_posix() for path in _workspace_stylesheets()]
    assert names == ["index.css", "parts/index.css", "parts/scale.css"]
    assert _has_rule(_stylesheets(), "ideal-v3-deep-example")
    faults = {
        name: css_scope_faults((tmp_path / name).read_text(encoding="utf-8"), name)
        for name in names
    }
    assert faults["index.css"] == []
    assert faults["parts/index.css"] == [
        '@import outside index.css: @import "./deep.css"',
        "selector outside the workspace: .ideal-panel",
    ]
    assert faults["parts/scale.css"] == [
        "--ideal-v3-text-sm is a variable of the scale, declared outside scale.css (.ideal-v3-app .ideal-v3-deep-example)"
    ]


@pytest.mark.parametrize(
    ("css", "name", "expected"),
    [
        # @import: index.css alone, and only a .css file beside it.
        ('@import "./scale.css";', "primitives.css", "@import outside index.css"),
        ('@import "./scale.css";', "", "@import outside index.css"),
        ('@import "../globals.css";', INDEX_SHEET, "@import of something other than"),
        ('@import "./parts/deep.css";', INDEX_SHEET, "@import of something other than"),
        (
            '@import "https://example.invalid/x.css";',
            INDEX_SHEET,
            "@import of something other than",
        ),
        (
            '@import "./scale.css" screen;',
            INDEX_SHEET,
            "@import of something other than",
        ),
        ('@import "./scale.scss";', INDEX_SHEET, "@import of something other than"),
        # A sibling of the frame is not in the frame.
        (
            ".ideal-v3-app ~ .ideal-panel { margin: 0; }",
            "people.css",
            "selector outside the workspace (a sibling of the frame): .ideal-v3-app ~ .ideal-panel",
        ),
        (
            ".ideal-v3-app + * { margin: 0; }",
            "people.css",
            "selector outside the workspace (a sibling of the frame): .ideal-v3-app + *",
        ),
        (
            ".ideal-v3-app~.ideal-panel { margin: 0; }",
            "people.css",
            "a sibling of the frame",
        ),
        (
            ':root[data-theme="dark"] .ideal-v3-app:has(.ideal-detail, [title=")"]):hover + .ideal-panel { margin: 0; }',
            "people.css",
            "a sibling of the frame",
        ),
        (
            ".ideal-v3-app .ideal-note, .ideal-v3-app ~ footer { margin: 0; }",
            "people.css",
            "(a sibling of the frame): .ideal-v3-app ~ footer",
        ),
        # A parenthesis in a quoted attribute closes nothing: the next selector is its own.
        (
            '.ideal-v3-app .ideal-note, .ideal-panel[title=")"] { margin: 0; }',
            "people.css",
            'selector outside the workspace: .ideal-panel[title=")"]',
        ),
        (
            '.ideal-v3-app :is(.ideal-note, [title="("]), .ideal-done { margin: 0; }',
            "people.css",
            "selector outside the workspace: .ideal-done",
        ),
        # A brace in a string does not hide the rule after it.
        (
            '.ideal-v3-app .ideal-note::before { content: "}"; } .ideal-panel { margin: 0; }',
            "people.css",
            "selector outside the workspace: .ideal-panel",
        ),
        # A variable that is not of the property's family may hold a literal.
        (
            ".ideal-v3-app .ideal-note { --s: 9px; font-size: var(--s); }",
            "people.css",
            "font-size: var(--s) is not a token",
        ),
        (
            ".ideal-v3-app .ideal-note { font-size: var(--radius-control); }",
            "people.css",
            "font-size: var(--radius-control) is not a token",
        ),
        (
            ".ideal-v3-app .ideal-note { font-size: 50%; }",
            "people.css",
            "font-size: 50% is not a token",
        ),
        (
            ".ideal-v3-app .ideal-table-wrap { border-radius: var(--ideal-v3-text-sm); }",
            "people.css",
            "border-radius: var(--ideal-v3-text-sm) is not a token",
        ),
        (
            ".ideal-v3-app .ideal-table-wrap { border-radius: var(--space-2); }",
            "people.css",
            "border-radius: var(--space-2) is not a token",
        ),
        # ... and a variable of a family is declared by the scale only.
        (
            ".ideal-v3-app .ideal-note { --ideal-v3-text-sm: 9px; }",
            "people.css",
            "--ideal-v3-text-sm is a variable of the scale, declared outside scale.css",
        ),
        (
            ".ideal-v3-app .ideal-note { --radius-control: 2px; }",
            INDEX_SHEET,
            "--radius-control is a variable of the scale, declared outside scale.css",
        ),
        (
            ".ideal-v3-app .ideal-note { --font-size-dense: 9px; }",
            "",
            "--font-size-dense is a variable of the scale, declared outside scale.css",
        ),
    ],
)
def test_a_workspace_stylesheet_that_imports_leaves_the_frame_or_hides_a_size_is_a_fault(
    css: str, name: str, expected: str
) -> None:
    """Each gap an independent review found in the rule, with the string that passed. The
    sample without the addition has no fault under the same file name (the test above), so
    the fault comes from the addition."""
    base = INDEX_STYLES if name == INDEX_SHEET else SCOPED_STYLES
    assert css_scope_faults(base, name) == []
    faults = css_scope_faults(base + css, name)
    assert len(faults) == 1 and expected in faults[0], faults


@pytest.mark.parametrize(
    ("css", "expected"),
    [
        # The established product and /preview, /showcase would be restyled.
        (
            ".ideal-panel h2 { font-weight: 700; }",
            "selector outside the workspace: .ideal-panel h2",
        ),
        # A class with v3 in its name is not the scope: ideal/screens uses these.
        (
            ".ideal-v3-disclosure > summary { font-weight: 700; }",
            "selector outside the workspace: .ideal-v3-disclosure > summary",
        ),
        (
            ".ideal-v3-application .ideal-panel { margin: 0; }",
            "selector outside the workspace",
        ),
        # One unscoped selector in a list is enough.
        (
            ".ideal-v3-app .ideal-note, .ideal-done { margin: 0; }",
            "selector outside the workspace: .ideal-done",
        ),
        ("h2 { margin: 0; }", "selector outside the workspace: h2"),
        (":root { --ideal-amber: 1 2 3; }", "selector outside the workspace: :root"),
        (
            '@media (max-width: 820px) { :root[data-theme="dark"] .ideal-panel { margin: 0; } }',
            'selector outside the workspace: :root[data-theme="dark"] .ideal-panel',
        ),
        (
            "body:has(.ideal-app) { margin: 0; }",
            "selector outside the workspace: body:has(.ideal-app)",
        ),
        # Sizes outside the scale.
        (
            ".ideal-v3-app .ideal-note { font-size: .75rem; }",
            "font-size: .75rem is not a token (.ideal-v3-app .ideal-note)",
        ),
        (
            ".ideal-v3-app .ideal-note { font-size: var(--ideal-v3-text-sm, .8rem); }",
            "font-size: var(--ideal-v3-text-sm, .8rem) is not a token",
        ),
        (
            ".ideal-v3-app .ideal-table-wrap { border-radius: .6rem; }",
            "border-radius: .6rem is not a token",
        ),
        (
            ".ideal-v3-app .ideal-table-wrap { border-radius: var(--radius-control) 0; }",
            "border-radius: var(--radius-control) 0 is not a token",
        ),
        (
            ".ideal-v3-app .ideal-v3-task { border-top-left-radius: 4px !important; }",
            "border-top-left-radius: 4px is not a token",
        ),
        (
            ".ideal-v3-app .ideal-button { font: 700 1rem/1.4 sans-serif; }",
            "font: 700 1rem/1.4 sans-serif is not a token",
        ),
        # What this reader cannot follow is refused rather than passed unread.
        (
            ".ideal-v3-app .ideal-panel { h2 { font-size: 2rem; } }",
            "nested rule in: .ideal-v3-app .ideal-panel",
        ),
        ('@font-face { font-family: "Other"; }', "at-rule not allowed: @font-face"),
        (
            "@namespace svg url(http://www.w3.org/2000/svg);",
            "at-rule not allowed: @namespace",
        ),
    ],
)
def test_a_workspace_stylesheet_out_of_scope_or_scale_is_a_fault(
    css: str, expected: str
) -> None:
    faults = css_scope_faults(SCOPED_STYLES + css)
    assert len(faults) == 1 and expected in faults[0], faults


def test_workspace_stylesheets_are_picked_up_when_the_directory_exists(
    tmp_path, monkeypatch
) -> None:
    """Without styles/workspace globals.css is all there is; with it, a rule in any of its
    .css files counts (and nothing else in the directory does). The workspace's own classes
    have their rules there: without the directory the real tree is reported."""
    module = sys.modules[__name__]
    assert WORKSPACE_STYLES == SRC / "styles/workspace"
    assert unstyled_class_names(REAL) == []
    monkeypatch.setattr(module, "WORKSPACE_STYLES", tmp_path / "absent")
    assert _stylesheets() == STYLES.read_text(encoding="utf-8")
    alone = unstyled_class_names(REAL)
    assert any(fault.endswith("ideal-field-label has no rule") for fault in alone)
    assert any(fault.endswith("ideal-button--danger has no rule") for fault in alone)
    monkeypatch.setattr(module, "WORKSPACE_STYLES", tmp_path)
    (tmp_path / "primitives.css").write_text(
        ".ideal-v3-app .ideal-field-label { display: block; }\n", encoding="utf-8"
    )
    (tmp_path / "notes.txt").write_text(".ideal-button--danger { }", encoding="utf-8")
    picked = unstyled_class_names(REAL)
    assert not any(fault.endswith("ideal-field-label has no rule") for fault in picked)
    assert any(fault.endswith("ideal-button--danger has no rule") for fault in picked)


# --- the frame ------------------------------------------------------------------------


def test_the_import_graph_starts_from_the_workspace_boundaries_too() -> None:
    assert set(BOUNDARIES) <= set(REAL.names)
    modules = _workspace_modules(REAL)
    assert set(BOUNDARIES) <= modules
    # What they import is part of the workspace: the frame is theirs alone.
    for name in BOUNDARIES:
        assert f"{SHELL}BoundaryFrame.tsx" in REAL.imports(name)
    # On, the not-found page leads to the workspace's entry through the workspace's link.
    # Off, it offers the site's entry and nothing else.
    not_found = REAL.read(NOT_FOUND)
    assert f"{SHELL}WorkspaceLink.tsx" in REAL.imports(NOT_FOUND)
    assert 'routeOf("home/index").route' in not_found
    assert "idealUiEnabled()" in not_found
    assert re.findall(r'href="([^"]*)"', not_found) == ["/"]
    # The error page is a Client Component and cannot read the server's flag, so it cannot
    # know whether the workspace exists: it names the site's entry only, never a workspace
    # screen, and keeps the retry.
    error = REAL.read(ERROR)
    assert REAL.imports(ERROR) == [f"{SHELL}BoundaryFrame.tsx"]
    assert re.findall(r'href="([^"]*)"', error) == ["/"]
    assert "routeOf(" not in error and "idealUiEnabled" not in error
    assert "reset()" in error and "error.digest" in error


def test_workspace_shell_is_server_rendered_and_pages_only_delegate() -> None:
    assert not _uses_client(REAL, f"{SHELL}WorkspaceShell.tsx")
    assert not _uses_client(REAL, f"{SHELL}WorkspaceRoutePage.tsx")
    assert not _uses_client(REAL, f"{WORKSPACE}/layout.tsx")
    for page in (f"{WORKSPACE}/[screen]/page.tsx", VIEW_PAGE):
        text = REAL.read(page)
        # A page checks the flag and the URL, then hands over to the per-route pipeline.
        assert "idealUiEnabled()" in text and "notFound()" in text
        assert 'export const dynamic = "force-dynamic"' in text
        assert "generateMetadata" in text
        assert "<WorkspaceRoutePage " in text
        features = [
            target for target in REAL.imports(page) if target.startswith("features/")
        ]
        assert features == [f"{SHELL}WorkspaceRoutePage.tsx"]


def test_the_route_is_read_again_through_the_refresh_action_only() -> None:
    """After a change the route is read again by one Server Action that the server-rendered
    route hands to the runtime. `router.refresh()` is not used: when its request fails the
    router navigates the document to the current address, which in Firefox and WebKit
    cancelled a navigation the user had started in the meantime."""
    assert REAL.under(ACTIONS) == [REFRESH_ACTION]
    action = _strip_comments(REAL.read(REFRESH_ACTION))
    body = action.split("export async function refreshRoute(): Promise<void> {", 1)[1]
    assert body.split() == ["refresh();", "}"]
    # Handed over by the route (a Server Component), never imported by the runtime.
    page = REAL.read(ROUTE_PAGE)
    assert REFRESH_ACTION in REAL.imports(ROUTE_PAGE)
    assert not _uses_client(REAL, ROUTE_PAGE)
    assert "<WorkspaceRuntime ctx={ctx} refreshRoute={refreshRoute}>" in page
    assert REAL.imports(RUNTIME, runtime_only=True).count(REFRESH_ACTION) == 0
    for name in sorted(_workspace_modules(REAL)):
        if _is_source(name):
            assert "router.refresh(" not in _strip_comments(REAL.read(name)), name
    runtime = _strip_comments(REAL.read(RUNTIME))
    assert "useRouter" not in runtime
    # The showcase bundles the runtime's module, and with it no server module at all.
    assert not any(
        target.startswith((ACTIONS, SERVER_ONLY))
        for target in REAL.reachable([SHOWCASE], runtime_only=True)
    )


def test_workspace_has_eight_domains_and_no_classic_navigation() -> None:
    expected = {
        "shell",
        "home",
        "schedule",
        "planning",
        "operations",
        "requests",
        "people",
        "governance",
        "settings",
        "shared",
        "generated",
        "showcase",
    }
    present = {path.name for path in (SRC / FEATURES).iterdir() if path.is_dir()}
    assert present == expected
    assert "従来の画面へ" not in REAL.read(f"{SHELL}WorkspaceShell.tsx")


def test_workspace_links_have_no_free_destination() -> None:
    link = REAL.read(f"{SHELL}WorkspaceLink.tsx")
    assert 'Omit<ComponentProps<"a">, "href">' in link
    assert "route: R" in link and "R extends WorkspaceRoutePath" in link
    assert not re.search(r"\b(?:returnTo|redirectTo|returnUrl|next)\b", link)
    # Nothing in the workspace uses the established product's free-href link any more.
    users = [
        name for name in _workspace_modules(REAL) if "ContextLink" in REAL.read(name)
    ]
    assert users == []


def test_next_type_declarations_never_capture_a_local_build_directory() -> None:
    declarations = (ROOT / "frontend/next-env.d.ts").read_text(encoding="utf-8")
    assert 'import "./.next/types/routes.d.ts";' in declarations
    assert 'import "./.next/types/root-params.d.ts";' in declarations
    assert "/private/" not in declarations
    assert "NEXT_DIST_DIR" not in declarations


def test_mobile_brand_keeps_an_accessible_name_when_visual_text_is_hidden() -> None:
    shell = (
        ROOT / "frontend/src/features/workspace/shell/WorkspaceShell.tsx"
    ).read_text()
    assert (
        'className="ideal-v3-brand" href={hrefFor("home")} aria-label="PharmShiftMaker 今日へ"'
        in shell
    )


def test_mobile_header_does_not_occlude_workspace_controls() -> None:
    css = (ROOT / "frontend/src/app/globals.css").read_text()
    mobile = css.rsplit("@media (max-width: 820px)", 1)[1].split(
        "@media (max-width: 520px)", 1
    )[0]
    header_rule = mobile.split(".ideal-v3-mobile-header {", 1)[1].split("}", 1)[0]
    assert "position: relative" in header_rule
    assert "position: sticky" not in header_rule
    assert "position: fixed" not in header_rule


def test_wide_content_scrolls_in_its_own_region_and_never_widens_the_page() -> None:
    """A table keeps readable columns (34rem at least) and scrolls inside a labelled,
    keyboard-focusable region; nothing on a workspace route may make the page itself wider
    than the screen. WebKit did, in two ways, and the two rules below answer them. They are
    written for the workspace only: .ideal-v3-app and .ideal-v3-content exist in the
    workspace's shell and nowhere else, while .ideal-v3-disclosure and .ideal-input are
    also used by the v1/v2 screens and keep their rules.

    The region and the table are found as these exact tags, so neither may take a second
    class: a table is given its frame, header fill and row header by rules scoped to the
    workspace (styles/workspace), not by a variant class or a wrapping component."""
    region = re.compile(
        r'<div className="ideal-table-wrap" role="region" '
        r'aria-label=(?:"[^"]+"|\{[^}]+\}) tabIndex=\{0\}>\s*$'
    )
    tables = 0
    for name in sorted(_workspace_modules(REAL)):
        text = REAL.read(name)
        for match in re.finditer(r'<table className="ideal-table">', text):
            tables += 1
            assert region.search(text[: match.start()]), name
    assert tables >= 15
    css = (ROOT / "frontend/src/app/globals.css").read_text(encoding="utf-8")
    # A chosen option longer than its control is not scrollable overflow of the page.
    assert "\n.ideal-v3-app select { contain: paint; }\n" in css
    # A disclosure that is a grid item does not grow its track to the table inside it.
    assert "\n.ideal-v3-content .ideal-v3-disclosure { min-width: 0; }\n" in css
    for wrapper in ("ideal-v3-app", "ideal-v3-content"):
        users = {
            name
            for name in REAL.names
            if name.endswith(".tsx")
            and _is_source(name)
            and re.search(rf'className="{wrapper}[ "]', REAL.read(name))
        }
        assert users == {f"{SHELL}WorkspaceShell.tsx", f"{SHELL}BoundaryFrame.tsx"}


def test_v3_package_requires_every_release_verification_gate() -> None:
    from devtools.ideal_ui.package_showcase import (
        REQUIRED_VERIFICATION_CHECKS,
        validate_verification,
    )

    manifest = {
        "source_commit": "a" * 40,
        "source_state_sha256": "different-until-mocked",
        "required_checks": dict.fromkeys(REQUIRED_VERIFICATION_CHECKS, "passed"),
    }
    with pytest.raises(SystemExit, match="source state"):
        validate_verification(manifest, "a" * 40)
    manifest["source_commit"] = "b" * 40
    with pytest.raises(SystemExit, match="current commit"):
        validate_verification(manifest, "a" * 40)


def test_v3_package_rejects_links_and_binds_scans_to_exact_artifacts(tmp_path) -> None:
    from devtools.ideal_ui.package_showcase import (
        REQUIRED_VERIFICATION_CHECKS,
        artifact_bundle_digest,
        digest,
        require_regular_file,
        safe_tree_inventory,
        validate_artifact_evidence,
    )

    tree = tmp_path / "artifact"
    tree.mkdir()
    (tree / "index.html").write_text("synthetic", encoding="utf-8")
    inventory = safe_tree_inventory(tree)
    inventories = {"storybook": inventory}
    bundle = artifact_bundle_digest(inventories)
    source = "a" * 64
    verification_assets = tmp_path / "verification"
    verification_assets.mkdir()
    for check in REQUIRED_VERIFICATION_CHECKS:
        (verification_assets / f"{check}.json").write_text(
            f'{{"check":"{check}","status":"passed"}}\n', encoding="utf-8"
        )
    manifest = {
        "source_state_sha256": source,
        "artifact_trees": inventories,
        "required_check_evidence": {
            check: {
                "source_state_sha256": source,
                "artifact_bundle_sha256": bundle,
                "path": f"{check}.json",
                "sha256": digest(verification_assets / f"{check}.json"),
            }
            for check in REQUIRED_VERIFICATION_CHECKS
        },
    }
    validate_artifact_evidence(manifest, inventories, verification_assets)
    manifest["required_check_evidence"]["secret_scan"][
        "artifact_bundle_sha256"
    ] = "wrong"
    with pytest.raises(SystemExit, match="exact package inputs"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    manifest["required_check_evidence"]["secret_scan"][
        "artifact_bundle_sha256"
    ] = bundle
    manifest["required_check_evidence"]["secret_scan"]["path"] = "../outside.txt"
    with pytest.raises(SystemExit, match="escapes"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    manifest["required_check_evidence"].pop("secret_scan")
    with pytest.raises(SystemExit, match="exactly cover"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    outside = tmp_path / "outside.txt"
    outside.write_text("must not be copied", encoding="utf-8")
    (tree / "linked.txt").symlink_to(outside)
    with pytest.raises(SystemExit, match="symbolic link"):
        safe_tree_inventory(tree)
    with pytest.raises(SystemExit, match="regular file"):
        require_regular_file(tree, "artifact manifest")
