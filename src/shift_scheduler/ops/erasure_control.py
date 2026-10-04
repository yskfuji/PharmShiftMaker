"""Independent, local monotonic control register for a single restore operator host.

The directory must be outside backup/restore targets. All writers and restore
operators share this lock; it is not a distributed consensus service.
"""

import fcntl
import hashlib
import hmac
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

from shift_scheduler.domain.planning import content_hash


def signature(payload: Any, secret: bytes) -> str:
    if len(secret) < 32:
        raise ValueError("Independent signing key must contain at least 32 bytes")
    return hmac.new(secret, content_hash(payload).encode(), hashlib.sha256).hexdigest()


@contextmanager
def locked_control(
    directory: str | Path, secret: bytes
) -> Iterator[tuple[Path, dict[str, Any] | None]]:
    root = Path(directory)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError("Existing absolute independent control directory required")
    managed = os.environ.get("PHARMSHIFT_MANAGED_STORAGE")
    if managed and root.resolve().is_relative_to(Path(managed).resolve()):
        raise ValueError(
            "Control register cannot be inside managed backup/erasure storage"
        )
    fd = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = root / "current.json"
        current = None
        if path.is_symlink():
            raise ValueError("Control symlink rejected")
        if path.exists():
            current = json.loads(path.read_text())
            body = current["payload"]
            if (
                not hmac.compare_digest(signature(body, secret), current["signature"])
                or type(body.get("generation")) is not int
                or body["generation"] < 1
            ):
                raise ValueError("Independent control signature or generation invalid")
        yield root, current


def advance(
    directory: str | Path, manifest_hash: str, secret: bytes, expected_generation: int
) -> dict[str, Any]:
    if (
        os.getenv("PHARMSHIFT_CONTROL_URL")
        or os.getenv("PHARMSHIFT_ENV") == "production"
    ):
        raise ValueError(
            "Legacy file control is migration-read-only when independent authority is configured"
        )
    with locked_control(directory, secret) as (root, current):
        generation = current["payload"]["generation"] if current else 0
        if generation != expected_generation:
            raise ValueError("Independent control generation changed")
        if len(manifest_hash) != 64 or any(
            c not in "0123456789abcdef" for c in manifest_hash
        ):
            raise ValueError("Manifest SHA256 required")
        body = {
            "generation": generation + 1,
            "manifest_hash": manifest_hash,
            "previous_control_hash": content_hash(current) if current else None,
        }
        envelope = {"payload": body, "signature": signature(body, secret)}
        temporary = root / (".pending-" + uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(envelope, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, root / "current.json")
            directory_fd = os.open(root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)
        return envelope


@contextmanager
def restore_authority(
    directory: str | Path, manifest_hash: str, secret: bytes, expected_generation: int
) -> Iterator[dict[str, Any]]:
    # Hold through the replay transaction COMMIT. A concurrent control writer
    # either wins before this validation or publishes after replay is committed.
    with locked_control(directory, secret) as (_, current):
        if not current or current["payload"] != {
            **current["payload"],
            "generation": expected_generation,
            "manifest_hash": manifest_hash,
        }:
            raise ValueError("Restore control is missing, stale or superseded")
        yield current["payload"]
