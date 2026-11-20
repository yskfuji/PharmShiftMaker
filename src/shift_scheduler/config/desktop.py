"""Fail closed for the single-PC desktop profile (PHARMSHIFT_ENV=desktop).

The desktop shell starts every process on the loopback interface with a
per-install TLS certificate, a bundled PostgreSQL and a local control authority.
Any configuration that would expose personal data beyond this PC, or fall back
to development behaviour, stops the process at start-up.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import ipaddress
import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

from shift_scheduler.api.auth.settings import (
    AuthMode,
    get_auth_mode,
    get_session_settings,
)
from shift_scheduler.config.profile import is_desktop
from shift_scheduler.db.settings import DatabaseSettings

_MNT_LOCAL = 0x00001000  # macOS <sys/mount.h>
# Linux: only these disk file systems count as local; any other type (network,
# FUSE, virtual-machine shares, unknown) is refused.
_LOCAL_FILESYSTEMS = {
    "ext2",
    "ext3",
    "ext4",
    "xfs",
    "btrfs",
    "zfs",
    "f2fs",
    "jfs",
    "reiserfs",
    "bcachefs",
}


class _MacStatfs(ctypes.Structure):
    # struct statfs with 64-bit inodes (the only layout on arm64).
    _fields_ = [
        ("f_bsize", ctypes.c_uint32),
        ("f_iosize", ctypes.c_int32),
        ("f_blocks", ctypes.c_uint64),
        ("f_bfree", ctypes.c_uint64),
        ("f_bavail", ctypes.c_uint64),
        ("f_files", ctypes.c_uint64),
        ("f_ffree", ctypes.c_uint64),
        ("f_fsid", ctypes.c_int32 * 2),
        ("f_owner", ctypes.c_uint32),
        ("f_type", ctypes.c_uint32),
        ("f_flags", ctypes.c_uint32),
        ("f_fssubtype", ctypes.c_uint32),
        ("f_fstypename", ctypes.c_char * 16),
        ("f_mntonname", ctypes.c_char * 1024),
        ("f_mntfromname", ctypes.c_char * 1024),
        ("f_flags_ext", ctypes.c_uint32),
        ("f_reserved", ctypes.c_uint32 * 7),
    ]


def _local_filesystem(path: Path) -> bool:
    """True only when the directory is on a local file system of this PC.

    Anything that cannot be determined counts as not local (fail closed).
    """
    if sys.platform == "darwin":
        libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        try:
            function = libc["statfs$INODE64"]
        except AttributeError:
            function = libc["statfs"]
        result = _MacStatfs()
        if function(os.fsencode(path), ctypes.byref(result)) != 0:
            return False
        return bool(result.f_flags & _MNT_LOCAL)
    if sys.platform.startswith("linux"):
        try:
            mountinfo = Path("/proc/self/mountinfo").read_text()
        except OSError:
            return False
        kind = mount_type(mountinfo, str(path))
        return kind in _LOCAL_FILESYSTEMS
    return False


def mount_type(mountinfo: str, target: str) -> str | None:
    """File-system type of the innermost mount holding ``target`` (Linux mountinfo)."""
    best, kind = "", None
    for line in mountinfo.splitlines():
        left, _, right = line.partition(" - ")
        fields = left.split()
        if len(fields) < 5 or not right.split():
            continue
        mount = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), fields[4])
        inside = target == mount or target.startswith(mount.rstrip("/") + "/")
        if inside and len(mount) >= len(best):
            best, kind = mount, right.split()[0]
    return kind


def _loopback(host: str | None) -> bool:
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _https_loopback(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and _loopback(parts.hostname)


def check_desktop() -> None:
    if not is_desktop():
        return
    if os.getenv("SHIFT_SCHEDULER_DATA_BACKEND") != "db":
        raise RuntimeError("Desktop cannot fall back to development YAML data")
    if get_auth_mode() != AuthMode.LOCAL:
        raise RuntimeError("Desktop requires local accounts (AUTH_MODE=local)")
    database = DatabaseSettings.from_environment().url
    if not database.startswith("postgresql") or not _loopback(
        urlsplit(database.replace("postgresql+psycopg", "postgresql")).hostname
    ):
        raise RuntimeError("Desktop requires the bundled PostgreSQL on loopback")
    session = get_session_settings()
    if len(session.secret) < 32 or not session.cookie_secure:
        raise RuntimeError(
            "Desktop requires a strong session secret and secure cookies"
        )
    if session.cookie_samesite != "strict" or session.cookie_domain:
        raise RuntimeError(
            "Desktop session cookies must be SameSite=Strict and host-only"
        )
    if not _https_loopback(session.frontend_base_url):
        raise RuntimeError("Desktop frontend must be served over HTTPS on loopback")
    origins = [
        o.strip()
        for o in os.getenv("API_CORS_ALLOW_ORIGINS", "").split(",")
        if o.strip()
    ]
    if not origins or any(not _https_loopback(o) for o in origins):
        raise RuntimeError("Desktop browser origins must be HTTPS on loopback")
    bind = os.getenv("PHARMSHIFT_BIND_HOST", "")
    if not _loopback(bind):
        raise RuntimeError("Desktop processes must listen on loopback only")
    control = os.getenv("PHARMSHIFT_CONTROL_URL", "")
    if not _https_loopback(control):
        raise RuntimeError("Desktop requires the local control authority over HTTPS")
    install = os.getenv("PHARMSHIFT_INSTALL_ID", "")
    if len(install) < 16:
        raise RuntimeError("Desktop requires a per-install identifier")
    storage = os.getenv("PHARMSHIFT_MANAGED_STORAGE", "")
    if not storage:
        raise RuntimeError("Desktop requires managed storage")
    path = Path(storage)
    if storage.startswith(("\\\\", "//")):
        raise RuntimeError("Desktop managed storage must be on this PC, not a share")
    if (
        not path.is_dir()
        or path.is_symlink()
        or (hasattr(path, "is_junction") and path.is_junction())
    ):
        raise RuntimeError("Desktop managed storage must be an existing directory")
    if os.name != "posix":
        # Windows ACLs (owner, inherited and explicit grants) are verified in the
        # Windows milestone. Until then the desktop profile does not start there.
        raise RuntimeError(
            "Desktop storage permissions cannot be verified on this platform yet"
        )
    if os.name == "posix":
        if path.resolve() != path.absolute():
            # A link anywhere in the path could point the data at another place.
            raise RuntimeError("Desktop managed storage must not go through a link")
        if not _local_filesystem(path.resolve()):
            raise RuntimeError(
                "Desktop managed storage must be on this PC, not a share"
            )
        mode = path.stat().st_mode
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise RuntimeError("Desktop managed storage must be private to this user")
        if path.stat().st_uid != os.getuid():
            raise RuntimeError("Desktop managed storage must belong to this user")
    from shift_scheduler.control.client import configured_client

    configured_client()  # Keys and token of the local authority must load.


__all__ = ["check_desktop"]
