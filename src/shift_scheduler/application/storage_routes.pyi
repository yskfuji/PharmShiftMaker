# Type stub: the implementation bytes are hashed into the restore policy_hash /
# reconcile code_hash, so annotations live here and the .py stays unchanged.
# Keep in sync with the implementation (checked by mypy.stubtest).
import ast
from pathlib import Path
from typing import Any, TypeGuard

from shift_scheduler.application.hashed_types import RouteInventory

def writer_call(node: ast.AST) -> TypeGuard[ast.Call]: ...

_PARSED: dict[tuple[str, str], dict[str, dict[str, Any]]]

def discover(root: str | Path) -> dict[str, dict[str, Any]]: ...
def _routes(file: Path, root: str | Path, source: str) -> dict[str, dict[str, Any]]: ...
def inspect_routes(root: str | Path | None = None) -> RouteInventory: ...
