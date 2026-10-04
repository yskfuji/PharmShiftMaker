"""Conservative producer inventory; syntax detection is NOT complete data-flow proof.

Every detected route has an expression digest and explicit review status. Runtime
byte/row reconciliation remains required, including delegated native writers.
"""

import ast
import hashlib
import json
from pathlib import Path


def writer_call(node):
    if not isinstance(node, ast.Call):
        return False
    name = ast.unparse(node.func)
    leaf = name.rsplit(".", 1)[-1]
    if leaf in {
        "write",
        "write_text",
        "write_bytes",
        "writelines",
        "dump",
        "dump_all",
        "copyfile",
        "copy2",
        "copytree",
        "NamedTemporaryFile",
        "TemporaryDirectory",
        "mkstemp",
    }:
        return True
    if name in {
        "subprocess.run",
        "subprocess.Popen",
        "subprocess.check_call",
        "subprocess.check_output",
    }:
        return True  # Delegated program may write; reviewer must classify it.
    if leaf not in {"open", "fdopen"}:
        return False
    if name == "os.open":
        flags = ast.unparse(node.args[1]) if len(node.args) > 1 else "unknown"
        return "O_RDONLY" not in flags or any(
            x in flags for x in ("O_CREAT", "O_RDWR", "O_WRONLY", "O_TRUNC")
        )
    mode = next((k.value for k in node.keywords if k.arg == "mode"), None)
    if mode is None:
        position = 1 if name in {"open", "io.open", "os.fdopen", "tarfile.open"} else 0
        mode = node.args[position] if len(node.args) > position else ast.Constant("r")
    if isinstance(mode, ast.Constant) and isinstance(mode.value, str):
        return any(c in mode.value for c in ("w", "a", "x", "+"))
    return True


_PARSED = {}


def discover(root):
    result = {}
    for directory in ("src/shift_scheduler", "scripts"):
        for file in sorted((Path(root) / directory).rglob("*.py")):
            source = file.read_text()
            # Re-parse only when the file content changed; identical bytes give
            # identical routes, so the cache cannot hide a new writer.
            key = (
                str(file.relative_to(root)),
                hashlib.sha256(source.encode()).hexdigest(),
            )
            if key not in _PARSED:
                _PARSED[key] = _routes(file, root, source)
            result.update(_PARSED[key])
    return result


def _routes(file, root, source):
    result = {}

    def visit(node, parents=()):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            parents = (*parents, node.name)
        if isinstance(node, ast.Call) and writer_call(node):
            expression = ast.dump(node, include_attributes=False)
            digest = hashlib.sha256(expression.encode()).hexdigest()
            identity = (
                str(file.relative_to(root)) + ":" + ".".join(parents) + ":" + digest
            )
            result[identity] = {
                "path": str(file.relative_to(root)),
                "symbol": ".".join(parents),
                "line": node.lineno,
                "expression_hash": digest,
                "call": ast.unparse(node.func),
            }
        for child in ast.iter_child_nodes(node):
            visit(child, parents)

    visit(ast.parse(source))
    return result


def inspect_routes(root=None):
    root = Path(root) if root else Path(__file__).resolve().parents[3]
    registry = json.loads(Path(__file__).with_name("storage_routes.json").read_text())
    declared = registry["entries"]
    if not (root / "src/shift_scheduler").is_dir() or not (root / "scripts").is_dir():
        return {
            "reviewed": False,
            "issues": ["source_inventory_unavailable"],
            "routes": declared,
        }
    actual = discover(root)
    missing, obsolete = sorted(actual.keys() - declared.keys()), sorted(
        declared.keys() - actual.keys()
    )
    categories = {
        "PRODUCT_PERSONAL",
        "NON_PERSONAL",
        "ISOLATED_EVALUATION",
        "DELEGATED_PROGRAM",
    }
    unclassified = sorted(
        key
        for key in actual.keys() & declared.keys()
        if declared[key].get("classification") not in categories
        or declared[key].get("classification_evidence", {}).get("expression_hash")
        != actual[key]["expression_hash"]
        or not declared[key].get("classification_evidence", {}).get("reason")
    )
    pending = sorted(
        key
        for key in actual.keys() & declared.keys()
        if declared[key].get("classification")
        in {"PRODUCT_PERSONAL", "DELEGATED_PROGRAM"}
        and declared[key].get("handler_status", declared[key]["status"]) == "UNVERIFIED"
    )
    return {
        "reviewed": not (missing or obsolete or pending or unclassified),
        "classified": not (missing or obsolete or unclassified),
        "classification_counts": {
            category: sum(
                e.get("classification") == category for e in declared.values()
            )
            for category in sorted(categories)
        },
        "unclassified": unclassified,
        "missing": missing,
        "obsolete": obsolete,
        "pending": sorted(pending),
        "routes": declared,
        "issues": [
            *("unregistered:" + k for k in missing),
            *("stale:" + k for k in obsolete),
            *("unclassified:" + k for k in unclassified),
            *("unverified_handler:" + k for k in pending),
        ],
        "boundary": "Python syntax producer inventory only; indirect/dynamic/native writers and runtime artifacts require reconciliation",
    }
