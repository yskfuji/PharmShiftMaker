"""Fixed ports and the on-disk layout of the desktop edition.

The web build bakes ``https://127.0.0.1:WEB/api`` and the ``/api`` rewrite to
``https://127.0.0.1:API`` at build time, so the ports are fixed per release.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

HOST = "127.0.0.1"
WEB_PORT = 18513
API_PORT = 18510
CONTROL_PORT = 18511
DB_PORT = 18512

APP_DB = "pharmshift"
CONTROL_DB = "pharmshift_control"
# The superuser is used only by the launcher (role and database management).
# Each database is owned by its own non-superuser login role.
ADMIN_USER = "pharmshift_admin"
APP_USER = "pharmshift_app"
CONTROL_USER = "pharmshift_control"

WEB_ORIGIN = f"https://{HOST}:{WEB_PORT}"
API_URL = f"https://{HOST}:{API_PORT}"
CONTROL_URL = f"https://{HOST}:{CONTROL_PORT}"


def default_data_root() -> Path:
    """Per-user application data directory (never a temporary or shared path)."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "PharmShiftMaker"
    if sys.platform == "win32":
        return Path(os.environ["LOCALAPPDATA"]) / "PharmShiftMaker"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / (
        "PharmShiftMaker"
    )


@dataclass(frozen=True)
class DataLayout:
    root: Path

    @property
    def state(self) -> Path:
        return self.root / "state"

    @property
    def secrets(self) -> Path:
        return self.state / "secrets.json"

    @property
    def tls(self) -> Path:
        return self.state / "tls"

    @property
    def ca(self) -> Path:
        return self.tls / "ca.pem"

    @property
    def cert(self) -> Path:
        return self.tls / "server.pem"

    @property
    def key(self) -> Path:
        return self.tls / "server-key.pem"

    @property
    def pgdata(self) -> Path:
        return self.root / "pgdata"

    @property
    def pgdata_new(self) -> Path:
        """First-run cluster under construction; renamed to pgdata when complete."""
        return self.root / "pgdata.new"

    @property
    def lock(self) -> Path:
        """Held exclusively by the running launcher (see launcher.acquire_lock)."""
        return self.state / "launcher.lock"

    @property
    def children(self) -> Path:
        """PIDs of the previous session's children, for recovery after a crash."""
        return self.state / "children.json"

    @property
    def storage(self) -> Path:
        return self.root / "storage"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    def directories(self) -> tuple[Path, ...]:
        return (self.root, self.state, self.tls, self.storage, self.logs)


def _exe(name: str) -> str:
    return name + ".exe" if sys.platform == "win32" else name


@dataclass(frozen=True)
class RuntimeLayout:
    """Bundled runtimes and application files (read-only, inside the app)."""

    root: Path

    @property
    def python(self) -> Path:
        if sys.platform == "win32":
            return self.root / "python" / "python.exe"
        return self.root / "python" / "bin" / "python3"

    def pg(self, tool: str) -> Path:
        return self.root / "pg" / "bin" / _exe(tool)

    @property
    def node(self) -> Path:
        if sys.platform == "win32":
            return self.root / "node" / "node.exe"
        return self.root / "node" / "bin" / "node"

    @property
    def app(self) -> Path:
        """alembic/, alembic.ini and scripts/control_authority.py."""
        return self.root / "app"

    @property
    def web(self) -> Path:
        """Next.js standalone output plus the HTTPS entry point."""
        return self.root / "web"
