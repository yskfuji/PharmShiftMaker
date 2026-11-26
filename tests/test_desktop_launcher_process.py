"""Launcher orchestration with stand-in children (no PostgreSQL, no network)."""

from __future__ import annotations

import io
import json
import os
import socket
import stat
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from shift_scheduler.desktop import launcher, layout
from shift_scheduler.desktop.layout import DataLayout, RuntimeLayout

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")


def _sup(tmp_path: Path) -> launcher.Supervisor:
    data = DataLayout(tmp_path / "data")
    data.state.mkdir(parents=True)
    data.logs.mkdir(parents=True)
    return launcher.Supervisor(data, RuntimeLayout(tmp_path / "rt"), threading.Event())


def _py(code: str) -> list[str]:
    return [sys.executable, "-c", code]


def test_run_succeeds_and_logs_output(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    sup.run("one", _py("print('hello')"), dict(os.environ), tmp_path)
    assert "hello" in (sup.data.logs / "one.log").read_text()


def test_run_failure_names_the_log(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    with pytest.raises(launcher.LaunchError) as raised:
        sup.run("bad", _py("raise SystemExit(3)"), dict(os.environ), tmp_path)
    assert raised.value.stage == "bad" and "3" in str(raised.value)
    assert raised.value.log == sup.data.logs / "bad.log"


def test_run_stops_on_request_and_on_timeout(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    sup.stop.set()
    started = time.monotonic()
    with pytest.raises(launcher.Stopped):
        sup.run("slow", _py("import time; time.sleep(30)"), dict(os.environ), tmp_path)
    assert time.monotonic() - started < 15
    sup.stop.clear()
    with pytest.raises(launcher.LaunchError, match="timed out"):
        sup.run(
            "slow",
            _py("import time; time.sleep(30)"),
            dict(os.environ),
            tmp_path,
            timeout=0.5,
        )


def test_uninterruptible_run_finishes_despite_stop(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    sup.stop.set()
    sup.run(
        "cleanup",
        _py("import time; time.sleep(0.3)"),
        dict(os.environ),
        tmp_path,
        interruptible=False,
    )


@posix_only
def test_children_are_recorded_watched_and_stopped(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    sleeper = sup.start(
        "sleeper", _py("import time; time.sleep(60)"), dict(os.environ), tmp_path
    )
    quick = sup.start("quick", _py("pass"), dict(os.environ), tmp_path)
    recorded = json.loads(sup.data.children.read_text())
    assert recorded == [sleeper.process.pid, quick.process.pid]
    assert stat.S_IMODE(sup.data.children.stat().st_mode) == 0o600
    quick.process.wait(10)
    assert sup.exited() is quick
    sup.stop_children()
    assert sleeper.process.poll() is not None
    assert not sup.data.children.exists() and sup.children == []


def test_command_of_reports_full_command_lines() -> None:
    if sys.platform == "win32":
        # The executable path stands in for the command line on Windows.
        image = launcher._command_of(os.getpid())
        assert image is not None
        assert os.path.normcase(image) == os.path.normcase(sys.executable)
        import subprocess

        child = subprocess.Popen(_py("import time; time.sleep(30)"))
        child.kill()
        child.wait()
        assert launcher._command_of(child.pid) is None
        return
    marker = "x" * 120  # longer than the 80 columns ps uses when piped
    import subprocess

    child = subprocess.Popen(_py("import time; time.sleep(30)") + [marker])
    try:
        time.sleep(0.3)
        command = launcher._command_of(child.pid)
        assert command is not None and marker in command
    finally:
        child.kill()
        child.wait()
    assert launcher._command_of(child.pid) is None


def test_reap_previous_ignores_missing_or_malformed_records(tmp_path: Path) -> None:
    data = DataLayout(tmp_path)
    data.state.mkdir()
    runtime = RuntimeLayout(tmp_path / "rt")
    assert launcher.reap_previous(data, runtime) == []
    data.children.write_text("not json")
    assert launcher.reap_previous(data, runtime) == []
    data.children.write_text(json.dumps({"pid": 1}))
    assert launcher.reap_previous(data, runtime) == []
    assert not data.children.exists()


@posix_only
def test_prepare_directories_creates_owner_only_tree_and_refuses_links(
    tmp_path: Path,
) -> None:
    data = DataLayout(tmp_path / "root")
    launcher.prepare_directories(data)
    for directory in data.directories():
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    other = tmp_path / "elsewhere"
    other.mkdir()
    data.logs.rmdir()
    data.logs.symlink_to(other)
    with pytest.raises(launcher.LaunchError, match="link"):
        launcher.prepare_directories(data)


def test_logs_rotate_one_generation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = DataLayout(tmp_path)
    data.logs.mkdir()
    monkeypatch.setattr(launcher, "LOG_LIMIT", 10)
    (data.logs / "api.log").write_bytes(b"x" * 20)
    with launcher.open_log(data, "api") as log:
        log.write(b"new")
    assert (data.logs / "api.log.1").read_bytes() == b"x" * 20
    assert (data.logs / "api.log").read_bytes() == b"new"


def test_ports_free_detects_a_listener(monkeypatch: pytest.MonkeyPatch) -> None:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        busy = server.getsockname()[1]
        for name in ("WEB_PORT", "API_PORT", "CONTROL_PORT"):
            with socket.socket() as spare:
                spare.bind(("127.0.0.1", 0))
                monkeypatch.setattr(layout, name, spare.getsockname()[1])
        monkeypatch.setattr(layout, "DB_PORT", busy)
        with pytest.raises(launcher.LaunchError, match=str(busy)):
            launcher.ports_free()


class _FakeProcess:
    def __init__(self, code: int | None = None) -> None:
        self.code = code
        self.returncode = code

    def poll(self) -> int | None:
        return self.code


def test_wait_returns_when_probe_succeeds_and_reports_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sup = _sup(tmp_path)
    alive = launcher.Child("api", _FakeProcess(), sup.data.logs / "api.log")  # type: ignore[arg-type]
    answers = iter([False, True])
    launcher._wait(sup, alive, lambda: next(answers))
    dead = launcher.Child("api", _FakeProcess(1), sup.data.logs / "api.log")  # type: ignore[arg-type]
    with pytest.raises(launcher.LaunchError, match="exited during startup"):
        launcher._wait(sup, dead, lambda: False)
    monkeypatch.setattr(launcher, "READY_SECONDS", 0.2)
    with pytest.raises(launcher.LaunchError, match="did not become ready"):
        launcher._wait(sup, alive, lambda: False)
    sup.stop.set()
    with pytest.raises(launcher.Stopped):
        launcher._wait(sup, alive, lambda: False)


def test_probes_answer_false_when_nothing_listens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import ssl

    sup = _sup(tmp_path)
    monkeypatch.setattr(launcher, "READY_SECONDS", 0.3)
    child = launcher.Child("web", _FakeProcess(), sup.data.logs / "web.log")  # type: ignore[arg-type]
    with socket.socket() as spare:
        spare.bind(("127.0.0.1", 0))
        port = spare.getsockname()[1]
    context = ssl.create_default_context()
    with pytest.raises(launcher.LaunchError, match="did not become ready"):
        launcher.wait_tls(sup, port, context, child)
    with pytest.raises(launcher.LaunchError, match="did not become ready"):
        launcher.wait_http(sup, f"https://127.0.0.1:{port}/healthz", context, child)


def _fake_runtime(tmp_path: Path) -> RuntimeLayout:
    """A runtime whose initdb creates a minimal cluster directory."""
    runtime = RuntimeLayout(tmp_path / "rt")
    bin_dir = runtime.root / "pg" / "bin"
    bin_dir.mkdir(parents=True)
    body = bin_dir / "fake_initdb.py"
    body.write_text(
        "import pathlib, sys\n"
        "target = pathlib.Path(sys.argv[sys.argv.index('-D') + 1])\n"
        "target.mkdir()\n"
        "(target / 'PG_VERSION').write_text('16')\n"
        "(target / 'postgresql.conf').write_text('# defaults\\n')\n"
        "(target / 'pg_hba.conf').write_text('host all all 0.0.0.0/0 trust\\n')\n"
    )
    script = bin_dir / "initdb"
    # A shebang cannot hold an interpreter path with spaces; go through sh.
    script.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{body}" "$@"\n')
    script.chmod(0o700)
    return runtime


@posix_only
def test_init_cluster_builds_aside_and_renames_when_configured(tmp_path: Path) -> None:
    from shift_scheduler.desktop import secrets

    sup = _sup(tmp_path)
    sup.runtime = _fake_runtime(tmp_path)
    sup.data.pgdata_new.mkdir()  # left by an interrupted first run
    (sup.data.pgdata_new / "partial").write_text("x")
    secret = secrets.generate()
    launcher.init_cluster(sup, secret)
    assert not sup.data.pgdata_new.exists()
    assert (sup.data.pgdata / "PG_VERSION").exists()
    assert not (sup.data.pgdata / "partial").exists()
    conf = (sup.data.pgdata / "postgresql.conf").read_text()
    assert (
        f"port = {layout.DB_PORT}" in conf and "log_min_error_statement = panic" in conf
    )
    assert (sup.data.pgdata / "pg_hba.conf").read_text() == launcher.PG_HBA
    assert not (sup.data.state / "initdb.pw").exists()
    launcher.init_cluster(sup, secret)  # complete cluster: nothing to do


def test_init_cluster_refuses_a_foreign_directory(tmp_path: Path) -> None:
    sup = _sup(tmp_path)
    sup.data.pgdata.mkdir()
    with pytest.raises(launcher.LaunchError, match="not a database cluster"):
        launcher.init_cluster(sup, {})


def _run_launch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    stop_after: float = 0.3,
    **overrides: Any,
) -> tuple[int, list[dict[str, Any]], list[str]]:
    calls: list[str] = []
    data = DataLayout(tmp_path / "data")
    runtime = RuntimeLayout(tmp_path / "rt")
    stop = threading.Event()

    def record(name: str, result: Any = None) -> Any:
        def step(*_args: Any, **_kwargs: Any) -> Any:
            calls.append(name)
            return result

        return step

    defaults: dict[str, Any] = {
        "prepare_directories": record("prepare"),
        "acquire_lock": record("lock", io.BytesIO()),
        "reap_previous": record("reap", []),
        "ensure_tls": record("tls"),
        "stop_postgres": record("stop_pg"),
        "ports_free": record("ports"),
        "init_cluster": record("initdb"),
        "start_postgres": record("start_pg"),
        "ensure_databases": record("databases"),
        "_start_services": record("services"),
        "initialized": record("initialized", False),
        "pg_running": record("pg_running", True),
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        monkeypatch.setattr(launcher, name, value)
    monkeypatch.setattr(
        launcher.secrets, "load_or_create", record("secrets", {"k": "v"})
    )
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    threading.Timer(stop_after, stop.set).start()
    code = launcher.launch(data, runtime, stop)
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    return code, events, calls


def test_launch_runs_the_stages_in_order_and_offers_setup_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code, events, calls = _run_launch(tmp_path, monkeypatch)
    assert code == 0
    assert calls[:11] == [
        "prepare",
        "lock",
        "reap",
        "secrets",
        "tls",
        "stop_pg",
        "ports",
        "initdb",
        "start_pg",
        "databases",
        "services",
    ]
    assert calls[-1] == "stop_pg"  # cleanup always stops PostgreSQL
    ready = [event for event in events if event["event"] == "ready"]
    assert ready and ready[0]["url"] == layout.WEB_ORIGIN
    assert (
        isinstance(ready[0]["setup_token"], str) and len(ready[0]["setup_token"]) >= 32
    )

    _, events, _ = _run_launch(tmp_path, monkeypatch, initialized=lambda *_: True)
    assert [e for e in events if e["event"] == "ready"][0]["setup_token"] is None


def test_launch_reports_errors_and_still_cleans_up(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args: Any) -> None:
        raise launcher.LaunchError("ports", "port 18512 on 127.0.0.1 is already in use")

    code, events, calls = _run_launch(tmp_path, monkeypatch, ports_free=broken)
    assert code == 2 and calls[-1] == "stop_pg"
    assert events[-1] == {
        "event": "error",
        "stage": "ports",
        "message": "port 18512 on 127.0.0.1 is already in use",
        "log": None,
    }

    def crash(*_args: Any) -> None:
        raise KeyError("boom")

    code, events, _ = _run_launch(tmp_path, monkeypatch, init_cluster=crash)
    assert code == 2 and events[-1]["stage"] == "unexpected"


def test_launch_stops_quietly_when_asked_during_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def interrupted(*_args: Any) -> None:
        raise launcher.Stopped

    code, events, calls = _run_launch(
        tmp_path, monkeypatch, _start_services=interrupted
    )
    assert code == 0
    assert not [e for e in events if e["event"] in ("ready", "error")]
    assert calls[-1] == "stop_pg"


def test_launch_notices_postgres_stopping(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(launcher, "PG_CHECK_SECONDS", 0.0)
    code, events, _ = _run_launch(
        tmp_path, monkeypatch, stop_after=3.0, pg_running=lambda *_: False
    )
    assert code == 2 and events[-1]["stage"] == "postgres"


def test_main_rejects_wrong_arguments(capsys: pytest.CaptureFixture[str]) -> None:
    assert launcher.main([]) == 64
    assert "usage" in capsys.readouterr().err


def _fake_pg_ctl(runtime: RuntimeLayout, state: Path) -> Path:
    """pg_ctl stand-in: 'status' answers from a flag file; start/stop toggle it."""
    bin_dir = runtime.root / "pg" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    body = bin_dir / "fake_pg_ctl.py"
    body.write_text(
        "import pathlib, sys\n"
        f"flag = pathlib.Path({str(state)!r})\n"
        "action = sys.argv[-1]\n"
        "log = flag.with_name('actions'); log.open('a').write(action + '\\n')\n"
        "if action == 'status': sys.exit(0 if flag.exists() else 3)\n"
        "if action == 'start': flag.write_text('up')\n"
        "if action == 'stop': flag.unlink(missing_ok=True)\n"
    )
    script = bin_dir / "pg_ctl"
    script.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{body}" "$@"\n')
    script.chmod(0o700)
    return state.with_name("actions")


@posix_only
def test_postgres_start_restarts_leftovers_and_stop_is_idempotent(
    tmp_path: Path,
) -> None:
    sup = _sup(tmp_path)
    flag = tmp_path / "pg-up"
    actions = _fake_pg_ctl(sup.runtime, flag)
    sup.data.pgdata.mkdir()
    flag.write_text("up")  # a server left by a crashed launcher
    launcher.start_postgres(sup)
    assert actions.read_text().split() == ["status", "stop", "start"]
    assert launcher.pg_running(sup)
    launcher.stop_postgres(sup)
    launcher.stop_postgres(sup)
    assert actions.read_text().split()[-3:] == ["status", "stop", "status"]
    assert not flag.exists()


class _Rows:
    def __init__(self, row: Any) -> None:
        self.row = row

    def fetchone(self) -> Any:
        return self.row


class _FakeConnection:
    def __init__(self, answers: dict[str, Any]) -> None:
        self.answers = answers
        self.statements: list[str] = []

    def __enter__(self) -> _FakeConnection:
        return self

    def __exit__(self, *_exc: Any) -> None:
        return None

    def execute(self, statement: Any, params: Any = None) -> _Rows:
        from psycopg import sql

        text = (
            statement.as_string(None)
            if isinstance(statement, sql.Composable)
            else statement
        )
        self.statements.append(text)
        for key, value in self.answers.items():
            if key in text:
                return _Rows(value)
        return _Rows(None)


def test_ensure_databases_creates_owned_non_superuser_roles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from shift_scheduler.desktop import secrets

    connection = _FakeConnection({})
    opened: list[tuple[str, str]] = []

    def connect(user: str, _password: str, database: str) -> _FakeConnection:
        opened.append((user, database))
        return connection

    monkeypatch.setattr(launcher, "_connect", connect)
    secret = secrets.generate()
    launcher.ensure_databases(secret)
    assert opened == [(layout.ADMIN_USER, "postgres")]
    text = "\n".join(connection.statements)
    for role in (layout.APP_USER, layout.CONTROL_USER):
        assert f'create role "{role}" login nosuperuser nocreatedb nocreaterole' in text
    assert f'create database "{layout.APP_DB}" owner "{layout.APP_USER}"' in text
    assert (
        f'create database "{layout.CONTROL_DB}" owner "{layout.CONTROL_USER}"' in text
    )
    assert text.count("revoke all on database") == 2

    existing = _FakeConnection({"pg_roles": (1,), "pg_database": (1,)})
    monkeypatch.setattr(launcher, "_connect", lambda *_: existing)
    launcher.ensure_databases(secret)
    joined = "\n".join(existing.statements)
    assert "alter role" in joined and "create database" not in joined


def test_initialized_reflects_local_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    from shift_scheduler.desktop import secrets

    secret = secrets.generate()
    monkeypatch.setattr(
        launcher, "_connect", lambda *_: _FakeConnection({"to_regclass": (False,)})
    )
    assert launcher.initialized(secret) is False
    monkeypatch.setattr(
        launcher,
        "_connect",
        lambda *_: _FakeConnection({"to_regclass": (True,), "exists": (True,)}),
    )
    assert launcher.initialized(secret) is True


def test_connect_requires_scram(monkeypatch: pytest.MonkeyPatch) -> None:
    import psycopg

    seen: dict[str, Any] = {}
    monkeypatch.setattr(psycopg, "connect", lambda **kwargs: seen.update(kwargs))
    launcher._connect("u", "p", "d")
    assert seen["require_auth"] == "scram-sha-256"
    assert seen["connect_timeout"] == launcher.CONNECT_SECONDS
    assert seen["host"] == layout.HOST and seen["port"] == layout.DB_PORT


def test_start_services_launches_children_with_their_own_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from shift_scheduler.desktop import secrets

    sup = _sup(tmp_path)
    runs: list[tuple[str, list[str], dict[str, str]]] = []
    starts: list[tuple[str, list[str], dict[str, str]]] = []

    def run(name: str, argv: Any, env: Any, _cwd: Path, **_kw: Any) -> None:
        runs.append((name, [str(a) for a in argv], dict(env)))

    def start(name: str, argv: Any, env: Any, _cwd: Path) -> launcher.Child:
        starts.append((name, [str(a) for a in argv], dict(env)))
        return launcher.Child(name, _FakeProcess(), sup.data.logs / f"{name}.log")  # type: ignore[arg-type]

    monkeypatch.setattr(sup, "run", run)
    monkeypatch.setattr(sup, "start", start)
    monkeypatch.setattr(launcher, "wait_tls", lambda *_: None)
    monkeypatch.setattr(launcher, "wait_http", lambda *_: None)
    enrolled: list[Any] = []
    monkeypatch.setattr(launcher, "enroll_source", lambda *args: enrolled.append(args))
    monkeypatch.setattr(launcher, "tls_context", lambda _data: "context")
    secret = secrets.generate()
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    launcher._start_services(sup, secret, "token-for-this-launch")
    assert [name for name, _, _ in runs] == ["migrate", "control_init"]
    assert [name for name, _, _ in starts] == ["control", "api", "worker", "web"]
    by_name = {name: (argv, env) for name, argv, env in starts}
    for name in ("control", "api"):
        argv = by_name[name][0]
        assert argv[argv.index("--host") + 1] == layout.HOST
        assert "--ssl-certfile" in argv and "--no-access-log" in argv
    assert by_name["api"][1]["PHARMSHIFT_SETUP_TOKEN"] == "token-for-this-launch"
    assert "DATABASE_URL" not in by_name["control"][1]
    assert "PHARMSHIFT_AUTHORITY_PRIVATE_KEY" not in by_name["api"][1]
    assert by_name["web"][0][-1].endswith("desktop-server.cjs")
    assert enrolled and enrolled[0][1] == "context"
    stages = [json.loads(line)["stage"] for line in out.getvalue().splitlines()]
    assert stages == ["migrate", "control", "api", "web"]


def test_enroll_source_registers_the_source_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ssl

    from shift_scheduler.control import client as control_client
    from shift_scheduler.desktop import environment, secrets

    calls: list[Any] = []

    class FakeClient:
        def __init__(
            self, url: str, client_id: str, token: str, key: str, **kw: Any
        ) -> None:
            calls.append(("init", url, client_id))

        def request(self, method: str, path: str, body: Any) -> None:
            calls.append((method, path, body))

    monkeypatch.setattr(control_client, "AuthorityClient", FakeClient)
    launcher.enroll_source(secrets.generate(), ssl.create_default_context())
    assert calls == [
        ("init", layout.CONTROL_URL, environment.OPERATOR),
        ("POST", "/nodes", {"node_id": environment.SOURCE_NODE, "role": "source"}),
    ]


def test_a_second_launcher_waits_for_the_lock_then_refuses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = DataLayout(tmp_path / "data")
    launcher.prepare_directories(data)
    monkeypatch.setattr(launcher, "LOCK_SECONDS", 0.3)
    first = launcher.acquire_lock(data, threading.Event())
    try:
        with pytest.raises(launcher.LaunchError, match="another PharmShiftMaker"):
            launcher.acquire_lock(data, threading.Event())
        stop = threading.Event()
        stop.set()
        monkeypatch.setattr(launcher, "LOCK_SECONDS", 30.0)
        with pytest.raises(launcher.Stopped):
            launcher.acquire_lock(data, stop)
    finally:
        first.close()
    launcher.acquire_lock(data, threading.Event()).close()


def test_launch_without_the_lock_leaves_the_running_launcher_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = DataLayout(tmp_path / "data")
    real_prepare, real_lock = launcher.prepare_directories, launcher.acquire_lock
    real_prepare(data)
    data.children.write_text("[12345]")
    monkeypatch.setattr(launcher, "LOCK_SECONDS", 0.3)
    held = launcher.acquire_lock(data, threading.Event())
    try:
        code, events, calls = _run_launch(
            tmp_path,
            monkeypatch,
            stop_after=10.0,
            prepare_directories=real_prepare,
            acquire_lock=real_lock,
        )
    finally:
        held.close()
    assert code == 2 and events[-1]["stage"] == "data"
    assert "reap" not in calls and "stop_pg" not in calls
    assert data.children.read_text() == "[12345]"


def test_missing_secrets_for_an_existing_cluster_are_not_regenerated(
    tmp_path: Path,
) -> None:
    data = DataLayout(tmp_path / "data")
    launcher.prepare_directories(data)
    launcher.require_secrets_for_existing_cluster(data)  # first run: fine
    data.pgdata.mkdir()
    with pytest.raises(launcher.LaunchError, match="restore the whole data folder"):
        launcher.require_secrets_for_existing_cluster(data)
    data.secrets.write_text("{}")
    launcher.require_secrets_for_existing_cluster(data)


def test_readiness_probe_never_uses_a_proxy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import http.server
    import ssl
    import urllib.error
    import urllib.request

    class Ok(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args: Any) -> None:
            pass

    with socket.socket() as spare:
        spare.bind(("127.0.0.1", 0))
        dead = spare.getsockname()[1]
    for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        monkeypatch.setenv(name, f"http://127.0.0.1:{dead}")
    for name in ("no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
    server = http.server.HTTPServer(("127.0.0.1", 0), Ok)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/healthz"
    try:
        with pytest.raises(urllib.error.URLError):
            urllib.request.urlopen(url, timeout=5)  # the default opener obeys the proxy
        sup = _sup(tmp_path)
        monkeypatch.setattr(launcher, "READY_SECONDS", 5.0)
        child = launcher.Child("api", _FakeProcess(), sup.data.logs / "api.log")  # type: ignore[arg-type]
        launcher.wait_http(sup, url, ssl.create_default_context(), child)
    finally:
        server.shutdown()
        server.server_close()


@posix_only
def test_reap_previous_tolerates_processes_it_may_not_or_can_no_longer_signal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = RuntimeLayout(tmp_path / "rt")
    data = DataLayout(tmp_path / "data")
    data.state.mkdir(parents=True)
    monkeypatch.setattr(launcher, "_command_of", lambda _pid: f"x {runtime.root} y")
    monkeypatch.setattr(launcher, "STOP_SECONDS", 0.2)

    def denied(_pid: int, _sig: int) -> None:
        raise PermissionError

    data.children.write_text("[4242]")
    monkeypatch.setattr(launcher.os, "kill", denied)
    assert launcher.reap_previous(data, runtime) == []

    sent: list[int] = []

    def gone_before_sigkill(_pid: int, sig: int) -> None:
        sent.append(sig)
        if len(sent) > 1:
            raise ProcessLookupError

    data.children.write_text("[4242]")
    monkeypatch.setattr(launcher.os, "kill", gone_before_sigkill)
    assert launcher.reap_previous(data, runtime) == [4242]
    assert not data.children.exists()


def test_launcher_process_exits_with_its_code_while_stdin_is_open(
    tmp_path: Path,
) -> None:
    import subprocess

    data = DataLayout(tmp_path / "data")
    launcher.prepare_directories(data)
    data.pgdata.mkdir()  # no secrets: the launcher refuses at the data stage
    source = Path(launcher.__file__).resolve().parents[2]
    process = subprocess.Popen(
        [
            sys.executable,
            "-B",
            "-m",
            "shift_scheduler.desktop",
            str(tmp_path / "rt"),
            str(data.root),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONPATH": str(source)},
    )
    assert process.stdin and process.stdout and process.stderr
    try:
        # stdin stays open, as it does under the shell.
        out = process.stdout.read()
        code = process.wait(60)
        err = process.stderr.read()
    finally:
        if process.poll() is None:
            process.kill()
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()
    assert code == 2, err
    errors = [e for e in map(json.loads, out.splitlines()) if e["event"] == "error"]
    assert errors[0]["stage"] == "data"


def test_windows_directories_get_the_private_folder_treatment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from shift_scheduler.ops import platform_fs

    prepared: list[str] = []
    real = platform_fs.prepare_data_dir

    def record(path: str) -> str:
        prepared.append(path)
        return real(path)

    monkeypatch.setattr(launcher.sys, "platform", "win32")
    monkeypatch.setattr(platform_fs, "prepare_data_dir", record)
    data = DataLayout(tmp_path / "data")
    launcher.prepare_directories(data)
    # Every directory, the managed storage included, is prepared on its own.
    assert prepared == [str(directory) for directory in data.directories()]
    assert all(directory.is_dir() for directory in data.directories())

    def refuse(path: str) -> str:
        raise RuntimeError("Desktop managed storage must be on this PC, not a share")

    monkeypatch.setattr(platform_fs, "prepare_data_dir", refuse)
    with pytest.raises(launcher.LaunchError, match="not a share") as raised:
        launcher.prepare_directories(data)
    assert raised.value.stage == "data"


def test_runtime_marker_ignores_case_only_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = RuntimeLayout(Path("/Apps/PharmShiftMaker/resources/runtime"))
    image = os.path.join(str(runtime.root).swapcase(), "python", "python.exe")
    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    assert not launcher._belongs_to(image, runtime)
    monkeypatch.setattr(launcher.sys, "platform", "win32")
    assert launcher._belongs_to(image, runtime)
    assert not launcher._belongs_to(os.path.join("other", "python.exe"), runtime)
