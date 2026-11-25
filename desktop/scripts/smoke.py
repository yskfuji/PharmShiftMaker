"""End-to-end smoke test of the assembled desktop runtime (synthetic data only).

usage: python -I desktop/scripts/smoke.py RUNTIME_DIR DATA_DIR RESULT_JSON
Starts the launcher twice against an empty DATA_DIR and checks: first-run setup
requires the setup token, the admin can sign in, servers listen on loopback
only, shutdown frees the ports, and the account survives a restart.
Prints only check results; the setup token and the generated password stay in memory.
"""

from __future__ import annotations

import json
import re
import secrets
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ORIGIN = "https://127.0.0.1:18513"
PORTS = (18510, 18511, 18512, 18513)


def python_of(runtime: Path) -> Path:
    if sys.platform == "win32":
        return runtime / "python" / "python.exe"
    return runtime / "python" / "bin" / "python3"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def call(
    context: ssl.SSLContext,
    path: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], str]:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=context),
        NoRedirect,
    )
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(ORIGIN + path, data=data, headers=headers or {})
    if data is not None:
        request.add_header("Content-Type", "application/json")
        request.add_header("Origin", ORIGIN)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, dict(response.headers), response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read().decode(errors="replace")


def start(runtime: Path, data: Path) -> tuple[subprocess.Popen[bytes], dict[str, Any]]:
    process = subprocess.Popen(
        [
            str(python_of(runtime)),
            "-I",
            "-B",
            "-m",
            "shift_scheduler.desktop",
            str(runtime),
            str(data),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert process.stdout is not None
    deadline = time.monotonic() + 420
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if not line:
            break
        event = json.loads(line)
        if event["event"] == "ready":
            return process, event
        if event["event"] == "error":
            raise RuntimeError(f"launcher error: {event}")
    raise RuntimeError(f"launcher did not become ready (exit {process.poll()})")


def stop(process: subprocess.Popen[bytes]) -> int:
    assert process.stdin is not None
    process.stdin.close()
    return process.wait(90)


def listening_hosts() -> list[str]:
    """Local addresses of listeners on our ports (best effort per OS)."""
    if sys.platform == "win32":
        output = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True
        ).stdout
        found = re.findall(r"TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING", output)
    else:
        output = subprocess.run(
            ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], capture_output=True, text=True
        ).stdout
        found = re.findall(r"TCP (\S+):(\d+) \(LISTEN\)", output)
    return sorted({host for host, port in found if int(port) in PORTS})


def ports_closed() -> bool:
    for port in PORTS:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return False
    return True


def main() -> int:
    runtime, data, result_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    password = secrets.token_urlsafe(18)
    checks: dict[str, Any] = {}

    process, ready = start(runtime, data)
    context = ssl.create_default_context(cafile=ready["ca"])
    try:
        checks["login_page"] = call(context, "/login")[0]
        checks["setup_status_first"] = json.loads(
            call(context, "/api/setup/status")[2]
        ).get("initialized")
        account = {
            "login_id": "smoke-admin",
            "display_name": "合成 管理者",
            "password": password,
            "facility_id": "synthetic-facility",
            "department_id": "synthetic-pharmacy",
        }
        checks["bootstrap_without_token"] = call(
            context, "/api/setup/bootstrap", account
        )[0]
        checks["bootstrap_with_token"] = call(
            context,
            "/api/setup/bootstrap",
            account,
            {"X-Setup-Token": ready["setup_token"]},
        )[0]
        status, headers, _ = call(
            context,
            "/api/auth/login",
            {"username": "smoke-admin", "password": password},
        )
        cookie = headers.get("Set-Cookie") or headers.get("set-cookie") or ""
        checks["login"] = status
        checks["cookie_secure_httponly"] = "Secure" in cookie and "HttpOnly" in cookie
        checks["listen_hosts"] = listening_hosts()
    finally:
        checks["first_exit"] = stop(process)
    checks["ports_closed_after_stop"] = ports_closed()

    process, ready = start(runtime, data)
    context = ssl.create_default_context(cafile=ready["ca"])
    try:
        checks["setup_status_second"] = json.loads(
            call(context, "/api/setup/status")[2]
        ).get("initialized")
        checks["setup_token_withheld_after_setup"] = ready.get("setup_token") is None
        checks["login_after_restart"] = call(
            context,
            "/api/auth/login",
            {"username": "smoke-admin", "password": password},
        )[0]
    finally:
        checks["second_exit"] = stop(process)

    ok = (
        checks["login_page"] == 200
        and checks["setup_status_first"] is False
        and checks["bootstrap_without_token"] in (401, 403)
        and checks["bootstrap_with_token"] in (200, 201)
        and checks["login"] == 200
        and checks["cookie_secure_httponly"]
        and checks["listen_hosts"] == ["127.0.0.1"]
        and checks["first_exit"] == 0
        and checks["ports_closed_after_stop"]
        and checks["setup_status_second"] is True
        and checks["setup_token_withheld_after_setup"]
        and checks["login_after_restart"] == 200
        and checks["second_exit"] == 0
    )
    checks["ok"] = ok
    result_path.write_text(
        json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(checks, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
