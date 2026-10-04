"""Strict type checking for the bodies of the hash-pinned modules.

The six modules below are hashed into the restore policy_hash / reconcile
code_hash, so their bytes stay unchanged and their public types live in .pyi
stubs. typing_shadow/shift_scheduler_hashed holds annotated copies. This test
proves each copy is the same program as the original once annotations, typing
casts and imports are removed, that its signatures equal the stub's, and that
strict mypy accepts it.
"""

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SHADOW = ROOT / "typing_shadow" / "shift_scheduler_hashed"
MODULES = {
    "storage_reconciliation": "application/storage_reconciliation",
    "copy_coverage": "application/copy_coverage",
    "copy_graph": "application/copy_graph",
    "subject_references": "application/subject_references",
    "storage_routes": "application/storage_routes",
    "restore_verification": "control/restore_verification",
}


class _Strip(ast.NodeTransformer):
    """Remove what cannot change behaviour: annotations, typing.cast and imports."""

    def __init__(self, typing_cast: bool) -> None:
        self.typing_cast = typing_cast  # module imported `cast` from typing

    def visit_ClassDef(self, node):
        # Class-level annotations are behaviour (pydantic fields), so they are kept;
        # only the methods are normalised.
        node.body = [
            (
                self.visit(n)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                else n
            )
            for n in node.body
        ]
        return node

    def visit_arg(self, node):
        node.annotation = None
        return node

    def _function(self, node):
        self.generic_visit(node)
        node.returns = None
        return node

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function

    def visit_AnnAssign(self, node):
        self.generic_visit(node)
        if node.value is None:
            return None  # declaration only
        return ast.Assign(targets=[node.target], value=node.value)

    def visit_Call(self, node):
        func = node.func
        is_cast = (
            isinstance(func, ast.Attribute)
            and func.attr == "cast"
            and isinstance(func.value, ast.Name)
            and func.value.id == "typing"
        ) or (self.typing_cast and isinstance(func, ast.Name) and func.id == "cast")
        if is_cast and len(node.args) == 2 and not node.keywords:
            return self.visit(node.args[1])
        return self.generic_visit(node)

    def visit_Import(self, node):
        return None

    visit_ImportFrom = visit_Import


def _imports_cast_from_typing(tree):
    return any(
        isinstance(n, ast.ImportFrom)
        and n.module == "typing"
        and any(a.name == "cast" for a in n.names)
        for n in ast.walk(tree)
    )


def _normalised(path):
    tree = ast.parse(path.read_text())
    return ast.dump(
        _Strip(_imports_cast_from_typing(tree)).visit(tree), include_attributes=False
    )


# Imports a copy may add: typing-only names that the original does not bind.
TYPING_ONLY = {
    "typing",
    "collections.abc",
    "sqlalchemy.orm",
    "sqlalchemy.engine",
    "sqlalchemy",
    "shift_scheduler.application.hashed_types",
}


def _scoped_imports(path):
    """(scope, [import statement dumps in order]) for the module and every function."""
    scopes = {}

    def walk(node, scope):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.Import, ast.ImportFrom)):
                scopes.setdefault(scope, []).append(child)
            inner = (
                scope + "." + child.name
                if isinstance(
                    child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
                )
                else scope
            )
            walk(child, inner)

    walk(ast.parse(path.read_text()), "<module>")
    return scopes


def _bound_names(tree):
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names |= {(a.asname or a.name).split(".")[0] for a in node.names}
    return names


def _is_subsequence(needles, haystack):
    it = iter(haystack)
    return all(any(n == h for h in it) for n in needles)


def _signatures(path):
    result = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = node.args
            params = [
                (a.arg, ast.unparse(a.annotation) if a.annotation else None)
                for a in (*args.posonlyargs, *args.args, *args.kwonlyargs)
            ]
            for extra in (args.vararg, args.kwarg):
                if extra:
                    params.append(
                        (
                            extra.arg,
                            ast.unparse(extra.annotation) if extra.annotation else None,
                        )
                    )
            result[node.name] = (
                params,
                ast.unparse(node.returns) if node.returns else None,
            )
    return result


@pytest.mark.parametrize("name", sorted(MODULES))
def test_shadow_is_the_same_program_as_the_hashed_original(name):
    original = ROOT / "src" / "shift_scheduler" / (MODULES[name] + ".py")
    shadow = SHADOW / (name + ".py")
    assert _normalised(shadow) == _normalised(original)
    original_imports, shadow_imports = _scoped_imports(original), _scoped_imports(
        shadow
    )
    import builtins

    original_tree = ast.parse(original.read_text())
    # A new import must not shadow a name the original binds or reads (incl. builtins).
    original_names = (
        _bound_names(original_tree)
        | {n.id for n in ast.walk(original_tree) if isinstance(n, ast.Name)}
        | set(dir(builtins))
    )
    for scope in set(original_imports) | set(shadow_imports):
        kept = [ast.dump(n) for n in original_imports.get(scope, [])]
        copied = shadow_imports.get(scope, [])
        # Same imports, same scope, same order; anything added is typing-only and new.
        assert _is_subsequence(kept, [ast.dump(n) for n in copied]), scope
        for node in copied:
            if ast.dump(node) in kept:
                continue
            module = (
                node.module if isinstance(node, ast.ImportFrom) else node.names[0].name
            )
            assert module in TYPING_ONLY, (scope, ast.unparse(node))
            bound = {(a.asname or a.name).split(".")[0] for a in node.names}
            assert not bound & original_names, (scope, ast.unparse(node))
    text = shadow.read_text()
    assert "type: ignore" not in text  # the copy must type-check honestly


@pytest.mark.parametrize("name", sorted(MODULES))
def test_declarations_do_not_make_new_locals(name):
    # A value-less annotation (x: T) makes x local to its function; it is only
    # allowed for a name that the same function already assigns.
    tree = ast.parse((SHADOW / (name + ".py")).read_text())
    for function in (
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ):
        own = [n for n in ast.walk(function) if n is not function]
        declared = {
            n.target.id
            for n in own
            if isinstance(n, ast.AnnAssign)
            and n.value is None
            and isinstance(n.target, ast.Name)
        }
        assigned = {
            n.id
            for n in own
            if isinstance(n, ast.Name)
            and isinstance(n.ctx, ast.Store)
            and not any(
                isinstance(a, ast.AnnAssign) and a.value is None and a.target is n
                for a in own
            )
        }
        assert declared <= assigned, (name, function.name, declared - assigned)


@pytest.mark.parametrize("name", sorted(MODULES))
def test_shadow_signatures_equal_the_stub(name):
    stub = ROOT / "src" / "shift_scheduler" / (MODULES[name] + ".pyi")
    shadow = _signatures(SHADOW / (name + ".py"))
    expected = _signatures(stub)
    assert expected, name
    assert {k: shadow[k] for k in expected} == expected
    assert set(expected) == set(shadow)  # every top-level function is in the stub


def test_strict_mypy_accepts_the_annotated_bodies():
    pytest.importorskip("mypy")
    env = {**os.environ, "MYPYPATH": str(ROOT / "src")}
    files = [str(p.relative_to(SHADOW.parent)) for p in sorted(SHADOW.glob("*.py"))]
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "mypy",
            "--config-file",
            str(ROOT / "pyproject.toml"),
            "--no-incremental",
            *files,
        ],
        cwd=SHADOW.parent,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]


def test_shared_result_types_are_declarations_only():
    import builtins

    # The copies may import hashed_types only because it cannot change behaviour:
    # typing imports without aliases, and undecorated TypedDict classes whose
    # bodies are docstrings and value-less annotations built from type syntax.
    tree = ast.parse(
        (
            ROOT / "src" / "shift_scheduler" / "application" / "hashed_types.py"
        ).read_text()
    )
    type_syntax = (
        ast.Name,
        ast.Subscript,
        ast.Attribute,
        ast.Constant,
        ast.Tuple,
        ast.BinOp,
        ast.BitOr,
        ast.Load,
    )

    def is_type(expression):
        return all(isinstance(n, type_syntax) for n in ast.walk(expression)) and all(
            isinstance(n.op, ast.BitOr)
            for n in ast.walk(expression)
            if isinstance(n, ast.BinOp)
        )

    imported = set()
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # docstring
        if isinstance(node, ast.ImportFrom) and node.module == "typing":
            assert all(a.asname is None for a in node.names), ast.unparse(node)
            imported |= {a.name for a in node.names}
            continue
        assert isinstance(node, ast.ClassDef), ast.unparse(node)
        assert not node.decorator_list and not node.keywords, node.name
        assert [ast.unparse(b) for b in node.bases] == [
            "TypedDict"
        ] and "TypedDict" in imported, node.name
        assert node.name not in dir(builtins), node.name
        for item in node.body:
            if isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant):
                continue
            assert (
                isinstance(item, ast.AnnAssign)
                and item.value is None
                and is_type(item.annotation)
            ), (node.name, ast.unparse(item))
