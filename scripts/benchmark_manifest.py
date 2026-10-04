"""Freeze reproducible inputs without treating declarations as measured evidence."""

import hashlib
import json
from pathlib import Path


def build_manifest(
    root,
    *,
    configuration,
    workload,
    search_threads=None,
    image_evidence=None,
    resource_evidence=None,
):
    root = Path(root)
    extensions = {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".css",
        ".json",
        ".toml",
        ".ini",
        ".yaml",
        ".yml",
        ".lock",
        ".txt",
        ".sh",
    }
    excluded = {
        "node_modules",
        ".git",
        ".venv",
        "__pycache__",
        "test-results",
        "playwright-report",
    }
    files = []
    for directory in ("src", "scripts", "alembic", "frontend", "ops"):
        for path in (root / directory).rglob("*"):
            relative = path.relative_to(root)
            if any(
                part in excluded or part.startswith(".next") for part in relative.parts
            ):
                continue
            if (
                path.is_file()
                and not path.is_symlink()
                and (path.suffix in extensions or path.name.startswith("Dockerfile"))
            ):
                if path.name.startswith(".env"):
                    continue
                files.append(path)
    for name in (
        "pyproject.toml",
        "uv.lock",
        "poetry.lock",
        "requirements.txt",
        "requirements.lock",
        ".python-version",
    ):
        if (root / name).is_file():
            files.append(root / name)
    hashes = {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(set(files))
    }
    evidence = {}
    missing = []
    for name, source in (("images", image_evidence), ("resources", resource_evidence)):
        if source is None:
            evidence[name] = None
            missing.append(name + "_evidence_missing")
        else:
            path = Path(source)
            raw = path.read_bytes()
            evidence[name] = {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "document": json.loads(raw),
            }
    if search_threads not in (1, 2):
        missing.append("search_threads_not_declared")
    document = {
        "schema_version": 1,
        "configuration": configuration,
        "workload": workload,
        "source_hashes": hashes,
        "search_threads": search_threads,
        "evidence": evidence,
        "missing_evidence": missing,
        "acceptance_ready": False,
        "readiness_reason": "Manifest freezes claims; resource/build/functional verifiers must independently validate them",
    }
    document["manifest_hash"] = hashlib.sha256(
        json.dumps(document, sort_keys=True).encode()
    ).hexdigest()
    return document
