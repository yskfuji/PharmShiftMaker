"""Start, supervise and stop the desktop edition.

Protocol with the Electron shell (stdout, one JSON object per line):
  {"event": "stage", "stage": "..."}                  progress
  {"event": "ready", "url": ..., "ca": ..., "setup_token": ... | null}
  {"event": "error", "stage": ..., "message": ..., "log": ...}
The shell closes our stdin to request shutdown, at any stage; we also stop when
it dies, because its end of the pipe then closes. Nothing else is written to
stdout. ``setup_token`` is sent only while no local account exists.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any

from shift_scheduler.desktop import environment, layout, secrets, tls
from shift_scheduler.desktop.layout import DataLayout, RuntimeLayout

LOG_LIMIT = 10 * 1024 * 1024
STOP_SECONDS = 10.0
READY_SECONDS = 120.0
STEP_SECONDS = 600.0
RENEW_DAYS = 30
PG_CHECK_SECONDS = 5.0
LOCK_SECONDS = 60.0
CONNECT_SECONDS = 10

POSTGRES_CONF = f"""
# PharmShiftMaker desktop
listen_addresses = '{layout.HOST}'
port = {layout.DB_PORT}
unix_socket_directories = ''
password_encryption = 'scram-sha-256'
# Statement text and DETAIL lines can carry personal data: keep them out of logs.
log_min_error_statement = panic
log_error_verbosity = terse
"""

PG_HBA = (
    f"host {layout.APP_DB} {layout.APP_USER} {layout.HOST}/32 scram-sha-256\n"
    f"host {layout.CONTROL_DB} {layout.CONTROL_USER} {layout.HOST}/32 scram-sha-256\n"
    f"host postgres {layout.ADMIN_USER} {layout.HOST}/32 scram-sha-256\n"
)


class LaunchError(RuntimeError):
    def __init__(self, stage: str, message: str, log: Path | None = None) -> None:
        super().__init__(message)
        self.stage, self.log = stage, log


class Stopped(Exception):
    """Shutdown was requested before startup finished."""


def emit(event: str, **fields: Any) -> None:
    sys.stdout.write(json.dumps({"event": event, **fields}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------- directories


def prepare_directories(data: DataLayout) -> None:
    for directory in data.directories():
        if directory.is_symlink():
            raise LaunchError("data", f"{directory} must not be a link")
        directory.mkdir(mode=0o700, parents=directory == data.root, exist_ok=True)
        if sys.platform == "win32":
            raise LaunchError(
                "data", "Windows data directories require the M3 ACL support"
            )
        os.chmod(directory, 0o700)


def rotate(path: Path) -> None:
    if path.exists() and path.stat().st_size > LOG_LIMIT:
        os.replace(path, path.with_suffix(".log.1"))


def open_log(data: DataLayout, name: str) -> IO[bytes]:
    path = data.logs / f"{name}.log"
    rotate(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    return os.fdopen(fd, "ab")


# ------------------------------------------------------------------ processes


@dataclass
class Child:
    name: str
    process: subprocess.Popen[bytes]
    log: Path


@dataclass
class Supervisor:
    data: DataLayout
    runtime: RuntimeLayout
    stop: threading.Event
    children: list[Child] = field(default_factory=list)

    def check(self) -> None:
        if self.stop.is_set():
            raise Stopped

    def _popen(
        self, name: str, argv: Sequence[str | Path], env: Mapping[str, str], cwd: Path
    ) -> subprocess.Popen[bytes]:
        flags = 0
        if sys.platform == "win32":
            flags = subprocess.CREATE_NEW_PROCESS_GROUP
        with open_log(self.data, name) as log:
            return subprocess.Popen(
                [str(part) for part in argv],
                env=dict(env),
                cwd=cwd,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=flags,
            )

    def run(
        self,
        name: str,
        argv: Sequence[str | Path],
        env: Mapping[str, str],
        cwd: Path,
        timeout: float = STEP_SECONDS,
        interruptible: bool = True,
    ) -> None:
        """Run a one-shot command; a stop request terminates it."""
        process = self._popen(name, argv, env, cwd)
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            if (interruptible and self.stop.is_set()) or time.monotonic() > deadline:
                _terminate(process)
                if self.stop.is_set():
                    raise Stopped
                raise LaunchError(name, "timed out", self.data.logs / f"{name}.log")
            time.sleep(0.2)
        if process.returncode != 0:
            raise LaunchError(
                name,
                f"exited with {process.returncode}",
                self.data.logs / f"{name}.log",
            )

    def start(
        self, name: str, argv: Sequence[str | Path], env: Mapping[str, str], cwd: Path
    ) -> Child:
        child = Child(
            name, self._popen(name, argv, env, cwd), self.data.logs / f"{name}.log"
        )
        self.children.append(child)
        self._record()
        return child

    def _record(self) -> None:
        pids = [child.process.pid for child in self.children]
        temporary = self.data.children.with_suffix(".new")
        temporary.unlink(missing_ok=True)
        secrets.write_private(temporary, json.dumps(pids).encode())
        os.replace(temporary, self.data.children)

    def exited(self) -> Child | None:
        for child in self.children:
            if child.process.poll() is not None:
                return child
        return None

    def stop_children(self) -> None:
        for child in reversed(self.children):
            if child.process.poll() is None:
                child.process.terminate()
        deadline = time.monotonic() + STOP_SECONDS
        for child in reversed(self.children):
            try:
                child.process.wait(max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.process.kill()
                child.process.wait()
        self.children.clear()
        self.data.children.unlink(missing_ok=True)


def _terminate(process: subprocess.Popen[bytes]) -> None:
    process.terminate()
    try:
        process.wait(STOP_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _command_of(pid: int) -> str | None:
    if sys.platform == "win32":
        return None
    result = subprocess.run(
        # -ww: never truncate (ps cuts piped output at 80 columns on Linux).
        ["ps", "-ww", "-o", "command=", "-p", str(pid)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() or None


def reap_previous(data: DataLayout, runtime: RuntimeLayout) -> list[int]:
    """Stop children left by a launcher that died without cleaning up.

    Only processes whose command line points into this runtime are touched, so a
    recycled PID that now belongs to an unrelated program is left alone.
    """
    try:
        pids = json.loads(data.children.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return []
    stopped: list[int] = []
    marker = str(runtime.root)
    for pid in pids if isinstance(pids, list) else []:
        if not isinstance(pid, int) or pid <= 1:
            continue
        command = _command_of(pid)
        if command is None or marker not in command:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            continue
        deadline = time.monotonic() + STOP_SECONDS
        while time.monotonic() < deadline and _command_of(pid) is not None:
            time.sleep(0.2)
        if _command_of(pid) is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.kill(pid, signal.SIGKILL)
        stopped.append(pid)
    data.children.unlink(missing_ok=True)
    return stopped


# ----------------------------------------------------------------- postgresql


def pg_running(sup: Supervisor) -> bool:
    result = subprocess.run(
        [str(sup.runtime.pg("pg_ctl")), "-D", str(sup.data.pgdata), "status"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def init_cluster(sup: Supervisor, secret: Mapping[str, str]) -> None:
    """Create the cluster in pgdata.new and rename it only when fully configured."""
    data = sup.data
    if data.pgdata.exists():
        if not (data.pgdata / "PG_VERSION").exists():
            raise LaunchError(
                "initdb", f"{data.pgdata} exists but is not a database cluster"
            )
        return
    if data.pgdata_new.exists():
        shutil.rmtree(data.pgdata_new)  # an interrupted first run; start over
    password_file = data.state / "initdb.pw"
    password_file.unlink(missing_ok=True)
    secrets.write_private(password_file, secret["admin_db_password"].encode())
    try:
        sup.run(
            "initdb",
            [
                sup.runtime.pg("initdb"),
                "-D",
                data.pgdata_new,
                "-U",
                layout.ADMIN_USER,
                f"--pwfile={password_file}",
                "-A",
                "scram-sha-256",
                "-E",
                "UTF8",
                "--locale=C",
            ],
            environment.postgres(os.environ),
            data.root,
        )
    finally:
        password_file.unlink(missing_ok=True)
    with (data.pgdata_new / "postgresql.conf").open("a", encoding="utf-8") as conf:
        conf.write(POSTGRES_CONF)
    (data.pgdata_new / "pg_hba.conf").write_text(PG_HBA, encoding="utf-8")
    os.replace(data.pgdata_new, data.pgdata)


def start_postgres(sup: Supervisor) -> None:
    pg_ctl = sup.runtime.pg("pg_ctl")
    env = environment.postgres(os.environ)
    if pg_running(sup):
        # Left over from a crashed session: restart under our supervision.
        sup.run(
            "pg_stop",
            [pg_ctl, "-D", sup.data.pgdata, "-m", "fast", "-w", "stop"],
            env,
            sup.data.root,
            interruptible=False,
        )
    log = sup.data.logs / "postgres.log"
    rotate(log)
    sup.run(
        "pg_start",
        [pg_ctl, "-D", sup.data.pgdata, "-l", log, "-w", "-t", "60", "start"],
        env,
        sup.data.root,
    )


def stop_postgres(sup: Supervisor) -> None:
    if sup.data.pgdata.exists() and pg_running(sup):
        sup.run(
            "pg_stop",
            [
                sup.runtime.pg("pg_ctl"),
                "-D",
                sup.data.pgdata,
                "-m",
                "fast",
                "-w",
                "stop",
            ],
            environment.postgres(os.environ),
            sup.data.root,
            interruptible=False,
        )


def _connect(user: str, password: str, database: str) -> Any:
    import psycopg

    return psycopg.connect(
        host=layout.HOST,
        port=layout.DB_PORT,
        user=user,
        password=password,
        dbname=database,
        require_auth=environment.REQUIRE_AUTH,
        connect_timeout=CONNECT_SECONDS,
        autocommit=True,
    )


def ensure_databases(secret: Mapping[str, str]) -> None:
    """Non-superuser owner roles; each database is reachable only by its owner."""
    from psycopg import sql

    owners = (
        (layout.APP_DB, layout.APP_USER, secret["app_db_password"]),
        (layout.CONTROL_DB, layout.CONTROL_USER, secret["control_db_password"]),
    )
    with _connect(layout.ADMIN_USER, secret["admin_db_password"], "postgres") as db:
        for database, role, password in owners:
            exists = db.execute(
                "select 1 from pg_roles where rolname = %s", (role,)
            ).fetchone()
            verb = "alter" if exists else "create"
            db.execute(
                sql.SQL(
                    "{} role {} login nosuperuser nocreatedb nocreaterole "
                    "noreplication nobypassrls password {}"
                ).format(sql.SQL(verb), sql.Identifier(role), sql.Literal(password))
            )
            if not db.execute(
                "select 1 from pg_database where datname = %s", (database,)
            ).fetchone():
                db.execute(
                    sql.SQL("create database {} owner {} encoding 'UTF8'").format(
                        sql.Identifier(database), sql.Identifier(role)
                    )
                )
            db.execute(
                sql.SQL("revoke all on database {} from public").format(
                    sql.Identifier(database)
                )
            )


def initialized(secret: Mapping[str, str]) -> bool:
    """Whether a local account exists (first-run setup is then closed)."""
    with _connect(layout.APP_USER, secret["app_db_password"], layout.APP_DB) as db:
        row = db.execute(
            "select to_regclass('public.local_accounts') is not null"
        ).fetchone()
        if not row or not row[0]:
            return False
        return bool(
            db.execute("select exists (select 1 from local_accounts)").fetchone()[0]
        )


# ----------------------------------------------------------------- readiness


def tls_context(data: DataLayout) -> ssl.SSLContext:
    return ssl.create_default_context(cafile=str(data.ca))


def _wait(sup: Supervisor, child: Child, probe: Any) -> None:
    deadline = time.monotonic() + READY_SECONDS
    while time.monotonic() < deadline:
        sup.check()
        if child.process.poll() is not None:
            raise LaunchError(child.name, "exited during startup", child.log)
        if probe():
            return
        sup.stop.wait(0.5)
    raise LaunchError(child.name, "did not become ready", child.log)


def wait_tls(sup: Supervisor, port: int, context: ssl.SSLContext, child: Child) -> None:
    def probe() -> bool:
        try:
            with (
                socket.create_connection((layout.HOST, port), timeout=2) as raw,
                context.wrap_socket(raw, server_hostname=layout.HOST),
            ):
                return True
        except OSError:
            return False

    _wait(sup, child, probe)


def direct_opener(context: ssl.SSLContext) -> urllib.request.OpenerDirector:
    """HTTPS to our own loopback servers; never through a system or env proxy."""
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context)
    )


def wait_http(sup: Supervisor, url: str, context: ssl.SSLContext, child: Child) -> None:
    opener = direct_opener(context)

    def probe() -> bool:
        try:
            with opener.open(url, timeout=5) as response:
                return bool(response.status < 500)
        except urllib.error.HTTPError as error:
            return bool(error.code < 500)
        except OSError:
            return False

    _wait(sup, child, probe)


def ports_free() -> None:
    for port in (layout.WEB_PORT, layout.API_PORT, layout.CONTROL_PORT, layout.DB_PORT):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex((layout.HOST, port)) == 0:
                raise LaunchError(
                    "ports", f"port {port} on {layout.HOST} is already in use"
                )


def enroll_source(secret: Mapping[str, str], context: ssl.SSLContext) -> None:
    import httpx

    from shift_scheduler.control.client import AuthorityClient

    client = AuthorityClient(
        layout.CONTROL_URL,
        environment.OPERATOR,
        secret["operator_token"],
        secret["authority_public_key"],
        transport=httpx.HTTPTransport(verify=context),
    )
    client.request(
        "POST", "/nodes", {"node_id": environment.SOURCE_NODE, "role": "source"}
    )


def ensure_tls(data: DataLayout) -> None:
    """Issue once; reissue the whole set when the leaf is due or unreadable."""
    if data.cert.exists():
        try:
            due = tls.leaf_expires_within(data.cert, RENEW_DAYS)
        except Exception:  # truncated or corrupted by an interrupted write
            due = True
        if due:
            data.cert.unlink()
    tls.ensure(data.ca, data.cert, data.key)


# --------------------------------------------------------------------- launch


def _start_services(
    sup: Supervisor, secret: Mapping[str, str], setup_token: str
) -> None:
    data, runtime = sup.data, sup.runtime
    python = runtime.python
    app_env = environment.application(os.environ, secret, data, setup_token)
    control_env = environment.control(os.environ, secret, data)
    control_env["PYTHONPATH"] = environment.python_path(runtime)

    emit("stage", stage="migrate")
    sup.run(
        "migrate", [python, "-m", "alembic", "upgrade", "head"], app_env, runtime.app
    )
    sup.run(
        "control_init",
        [python, "-m", "scripts.control_authority"],
        control_env,
        runtime.app,
    )

    context = tls_context(data)
    uvicorn_tls: list[str | Path] = [
        "--ssl-certfile",
        data.cert,
        "--ssl-keyfile",
        data.key,
    ]
    uvicorn_common: list[str | Path] = [
        "--host",
        layout.HOST,
        "--no-access-log",
        "--no-server-header",
    ]

    emit("stage", stage="control")
    control = sup.start(
        "control",
        [
            python,
            "-m",
            "uvicorn",
            "scripts.control_authority:build_app",
            "--factory",
            "--port",
            str(layout.CONTROL_PORT),
            *uvicorn_common,
            *uvicorn_tls,
        ],
        control_env,
        runtime.app,
    )
    wait_tls(sup, layout.CONTROL_PORT, context, control)
    enroll_source(secret, context)

    emit("stage", stage="api")
    api = sup.start(
        "api",
        [
            python,
            "-m",
            "uvicorn",
            "shift_scheduler.api.main:app",
            "--port",
            str(layout.API_PORT),
            *uvicorn_common,
            *uvicorn_tls,
        ],
        app_env,
        runtime.app,
    )
    wait_http(sup, layout.API_URL + "/healthz", context, api)
    sup.start(
        "worker",
        [python, "-m", "shift_scheduler.application.worker"],
        app_env,
        runtime.app,
    )

    emit("stage", stage="web")
    web = sup.start(
        "web",
        [runtime.node, runtime.web / "desktop-server.cjs"],
        environment.web(os.environ, data),
        runtime.web,
    )
    wait_http(sup, layout.WEB_ORIGIN + "/login", context, web)


def acquire_lock(data: DataLayout, stop: threading.Event) -> IO[bytes]:
    """Hold an exclusive lock on the data folder for the launcher's lifetime.

    A second launcher on the same folder would otherwise reap the first one's
    children and stop its PostgreSQL. A launcher that is still cleaning up after
    its shell died releases the lock within about STOP_SECONDS per child, so we
    wait for a while before giving up.
    """
    handle = open_lock(data)
    deadline = time.monotonic() + LOCK_SECONDS
    while True:
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return handle
        except OSError:
            if time.monotonic() > deadline:
                handle.close()
                raise LaunchError(
                    "data", "another PharmShiftMaker is using this data folder"
                ) from None
        if stop.wait(0.2):
            handle.close()
            raise Stopped()


def open_lock(data: DataLayout) -> IO[bytes]:
    fd = os.open(
        data.lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600
    )
    return os.fdopen(fd, "r+b")


def require_secrets_for_existing_cluster(data: DataLayout) -> None:
    """Refuse to mint new secrets for a database that was created with others."""
    if not data.secrets.exists() and data.pgdata.exists():
        raise LaunchError(
            "data",
            f"{data.secrets} is missing but {data.pgdata} exists; "
            "restore the whole data folder from the same backup",
        )


def launch(data: DataLayout, runtime: RuntimeLayout, stop: threading.Event) -> int:
    sup = Supervisor(data, runtime, stop)
    secret: Mapping[str, str] | None = None
    lock: IO[bytes] | None = None
    try:
        emit("stage", stage="data")
        prepare_directories(data)
        lock = acquire_lock(data, stop)
        reap_previous(data, runtime)
        require_secrets_for_existing_cluster(data)
        secret = secrets.load_or_create(data.secrets)
        ensure_tls(data)
        # A PostgreSQL left running by a launcher that was killed holds its port.
        stop_postgres(sup)
        ports_free()
        sup.check()

        emit("stage", stage="database")
        init_cluster(sup, secret)
        start_postgres(sup)
        ensure_databases(secret)
        sup.check()

        setup_token = secrets.setup_token()
        _start_services(sup, secret, setup_token)
        open_setup = not initialized(secret)

        emit(
            "ready",
            url=layout.WEB_ORIGIN,
            ca=str(data.ca),
            setup_token=setup_token if open_setup else None,
        )
        last_pg_check = time.monotonic()
        while not stop.wait(0.5):
            gone = sup.exited()
            if gone:
                raise LaunchError(
                    gone.name,
                    f"stopped unexpectedly ({gone.process.returncode})",
                    gone.log,
                )
            if time.monotonic() - last_pg_check > PG_CHECK_SECONDS:
                last_pg_check = time.monotonic()
                if not pg_running(sup):
                    raise LaunchError(
                        "postgres", "stopped unexpectedly", data.logs / "postgres.log"
                    )
        return 0
    except Stopped:
        return 0
    except LaunchError as error:
        emit(
            "error",
            stage=error.stage,
            message=str(error),
            log=str(error.log) if error.log else None,
        )
        return 2
    except Exception as error:  # report, then stop everything below
        emit(
            "error",
            stage="unexpected",
            message=f"{type(error).__name__}: {error}",
            log=None,
        )
        return 2
    finally:
        # Without the lock, another launcher owns the children and PostgreSQL.
        if lock is not None:
            sup.stop_children()
            try:
                stop_postgres(sup)
            except LaunchError as error:
                emit("error", stage=error.stage, message=str(error), log=str(error.log))
            except OSError as error:  # e.g. a damaged runtime without pg_ctl
                emit(
                    "error",
                    stage="postgres",
                    message=f"{type(error).__name__}: {error}",
                    log=None,
                )
            lock.close()


def _watch_stdin(stop: threading.Event) -> None:
    try:
        while sys.stdin.buffer.read(1):
            pass
    finally:
        stop.set()


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) not in (1, 2):
        sys.stderr.write(
            "usage: python -m shift_scheduler.desktop RUNTIME_DIR [DATA_DIR]\n"
        )
        return 64
    runtime = RuntimeLayout(Path(args[0]).resolve())
    data = DataLayout(
        Path(args[1]).resolve() if len(args) == 2 else layout.default_data_root()
    )
    stop = threading.Event()
    threading.Thread(target=_watch_stdin, args=(stop,), daemon=True).start()
    if sys.platform != "win32":
        for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(number, lambda *_: stop.set())
    return launch(data, runtime, stop)
