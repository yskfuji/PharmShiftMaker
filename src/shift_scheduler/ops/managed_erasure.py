"""Capture into an application-private directory before verifying/unlinking.

All relative directories use openat/O_NOFOLLOW. A crash between rename and unlink
leaves a deterministic quarantine object recoverable from the committed intent.
"""

import hashlib
import os
import stat
from contextlib import suppress
from pathlib import Path


def erase_verified(root: Path, relative: str, copy_id: str, expected_hash: str) -> bool:
    parts = Path(relative).parts
    if (
        not parts
        or Path(relative).is_absolute()
        or any(p in {"..", ".erasure"} for p in parts)
    ):
        raise ValueError("Invalid managed erasure location")
    key = hashlib.sha256(copy_id.encode()).hexdigest()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    parent_fd = os.dup(root_fd)
    quarantine_fd = None
    try:
        with suppress(FileExistsError):
            os.mkdir(".erasure", mode=0o700, dir_fd=root_fd)
        quarantine_fd = os.open(".erasure", flags, dir_fd=root_fd)
        if stat.S_IMODE(os.fstat(quarantine_fd).st_mode) & 0o077:
            raise ValueError("Erasure quarantine must be private")
        try:
            os.stat(key, dir_fd=quarantine_fd, follow_symlinks=False)
            captured = True
        except FileNotFoundError:
            captured = False
        if not captured:
            for part in parts[:-1]:
                child = os.open(part, flags, dir_fd=parent_fd)
                os.close(parent_fd)
                parent_fd = child
            try:
                os.rename(
                    parts[-1], key, src_dir_fd=parent_fd, dst_dir_fd=quarantine_fd
                )
                os.fsync(parent_fd)
                os.fsync(quarantine_fd)
            except FileNotFoundError:
                return (
                    False  # committed intent can acknowledge a prior completed unlink
                )
        fd = os.open(key, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=quarantine_fd)
        with os.fdopen(fd, "rb") as stream:
            details = os.fstat(stream.fileno())
            if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
                raise ValueError(
                    "Erasure target is not an exclusively managed regular file"
                )
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected_hash:
                raise ValueError(
                    "Captured content differs; preserved in private quarantine"
                )
        os.unlink(key, dir_fd=quarantine_fd)
        os.fsync(quarantine_fd)
        return True
    finally:
        if quarantine_fd is not None:
            os.close(quarantine_fd)
        os.close(parent_fd)
        os.close(root_fd)
