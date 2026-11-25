"""Per-install secrets, created once and kept in the owner-only state directory.

Threat model (see docs/desktop/desktop-shell.md): other local OS users are
excluded by the directory permissions; code running as the same OS user is out
of scope, so the file is not additionally encrypted.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

FIELDS = (
    "install_id",
    "admin_db_password",
    "app_db_password",
    "control_db_password",
    "jwt_secret",
    "authority_private_key",
    "authority_public_key",
    "source_token",
    "operator_token",
    "erasure_manifest_key",
    "archive_key",
)


def generate() -> dict[str, str]:
    signer = Ed25519PrivateKey.generate()
    private = signer.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    public = signer.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    return {
        "install_id": secrets.token_hex(16),
        "admin_db_password": secrets.token_urlsafe(32),
        "app_db_password": secrets.token_urlsafe(32),
        "control_db_password": secrets.token_urlsafe(32),
        "jwt_secret": secrets.token_urlsafe(48),
        "authority_private_key": private.hex(),
        "authority_public_key": public.hex(),
        "source_token": secrets.token_urlsafe(32),
        "operator_token": secrets.token_urlsafe(32),
        "erasure_manifest_key": secrets.token_hex(32),
        "archive_key": secrets.token_hex(32),
    }


def setup_token() -> str:
    """Per-launch first-run token; never stored, so it changes on every start."""
    return secrets.token_urlsafe(32)


def write_private(path: Path, data: bytes) -> None:
    """Create a new owner-only file; never overwrite an existing one."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def load_or_create(path: Path) -> dict[str, str]:
    if not path.exists():
        values = generate()
        temporary = path.with_name(path.name + ".new")
        if temporary.exists():
            temporary.unlink()
        write_private(temporary, json.dumps(values, indent=2).encode())
        os.replace(temporary, path)
        return values
    if sys.platform != "win32" and path.stat().st_mode & 0o077:
        raise PermissionError(f"{path} must be readable only by its owner")
    loaded: Any = json.loads(path.read_text(encoding="utf-8"))
    missing = [field for field in FIELDS if not isinstance(loaded.get(field), str)]
    if missing:
        raise ValueError(f"secrets file is incomplete: {', '.join(missing)}")
    return {field: loaded[field] for field in FIELDS}
