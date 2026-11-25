"""Capture into an application-private directory before verifying/unlinking.

All relative directories use openat/O_NOFOLLOW (on Windows, the checked
equivalents in ops/platform_fs). A crash between rename and unlink
leaves a deterministic quarantine object recoverable from the committed intent.
"""

import hashlib
import os
import stat
from contextlib import suppress
from pathlib import Path

from shift_scheduler.ops import platform_fs


def erase_verified(root: Path, relative: str, copy_id: str, expected_hash: str) -> bool:
    parts = Path(relative).parts
    if (
        not parts
        or Path(relative).is_absolute()
        or any(p in {"..", ".erasure"} for p in parts)
    ):
        raise ValueError("Invalid managed erasure location")
    key = hashlib.sha256(copy_id.encode()).hexdigest()
    root_fd = platform_fs.open_directory(root)
    parent_fd = platform_fs.duplicate_directory(root_fd)
    quarantine_fd = None
    try:
        with suppress(FileExistsError):
            platform_fs.mkdir_at(".erasure", 0o700, directory=root_fd)
        quarantine_fd = platform_fs.open_subdirectory(".erasure", root_fd)
        if not platform_fs.directory_is_private(quarantine_fd):
            raise ValueError("Erasure quarantine must be private")
        try:
            platform_fs.stat_at(key, directory=quarantine_fd)
            captured = True
        except FileNotFoundError:
            captured = False
        if not captured:
            for part in parts[:-1]:
                child = platform_fs.open_subdirectory(part, parent_fd)
                platform_fs.close_directory(parent_fd)
                parent_fd = child
            try:
                platform_fs.rename_at(parts[-1], parent_fd, key, quarantine_fd)
                platform_fs.fsync_directory(parent_fd)
                platform_fs.fsync_directory(quarantine_fd)
            except FileNotFoundError:
                return (
                    False  # committed intent can acknowledge a prior completed unlink
                )
        fd = platform_fs.open_at(
            key, os.O_RDONLY | platform_fs.O_NOFOLLOW, directory=quarantine_fd
        )
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
        platform_fs.unlink_at(key, directory=quarantine_fd)
        platform_fs.fsync_directory(quarantine_fd)
        return True
    finally:
        if quarantine_fd is not None:
            platform_fs.close_directory(quarantine_fd)
        platform_fs.close_directory(parent_fd)
        platform_fs.close_directory(root_fd)
