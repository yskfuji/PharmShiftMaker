"""Fail closed for the single-PC desktop profile (PHARMSHIFT_ENV=desktop).

The desktop shell starts every process on the loopback interface with a
per-install TLS certificate, a bundled PostgreSQL and a local control authority.
Any configuration that would expose personal data beyond this PC, or fall back
to development behaviour, stops the process at start-up.
"""

from __future__ import annotations

import ipaddress
import os
import stat
from pathlib import Path
from urllib.parse import urlsplit

from shift_scheduler.api.auth.settings import (
    AuthMode,
    get_auth_mode,
    get_session_settings,
)
from shift_scheduler.config.profile import is_desktop
from shift_scheduler.db.settings import DatabaseSettings


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
        mode = path.stat().st_mode
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise RuntimeError("Desktop managed storage must be private to this user")
        if path.stat().st_uid != os.getuid():
            raise RuntimeError("Desktop managed storage must belong to this user")
    from shift_scheduler.control.client import configured_client

    configured_client()  # Keys and token of the local authority must load.


__all__ = ["check_desktop"]
