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

import json
import posixpath
import re
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


RULES: dict[str, Callable[[Tree], list[str]]] = {
    "established_modules_reached": established_modules_reached,
    "established_links": established_links,
    "free_workspace_urls": free_workspace_urls,
    "route_definition_faults": route_definition_faults,
    "server_modules_reached_by_client_code": server_modules_reached_by_client_code,
    "server_action_faults": server_action_faults,
    "showcase_differences": showcase_differences,
    "cross_purpose_renders": cross_purpose_renders,
    "foreign_class_names": foreign_class_names,
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
AUDIT_VIEW = f"{FEATURES}/governance/audit/AuditView.tsx"
HOME_QUEUE = f"{FEATURES}/home/HomeQueue.tsx"
SHOWCASE_ROUTE = f"{SHOWCASE}/ShowcaseRoute.tsx"
VIEW_PAGE = f"{WORKSPACE}/[screen]/[view]/page.tsx"
NOT_FOUND, ERROR = BOUNDARIES
ROUTES = f"{SHELL}routes.ts"
RUNTIME = f"{SHELL}WorkspaceRuntime.tsx"
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
            AUDIT_VIEW,
            'routeOf("governance/privacy").route',
            '"/workspace/governance/privacy"',
        ),
        AUDIT_VIEW,
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
    also used by the v1/v2 screens and keep their rules."""
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
