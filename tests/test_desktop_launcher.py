"""Unit tests of the desktop launcher's pure parts (no PostgreSQL, no children)."""

from __future__ import annotations

import datetime
import ipaddress
import json
import os
import stat
import sys
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec

from shift_scheduler.api.auth import settings as auth_settings
from shift_scheduler.config import desktop as desktop_config
from shift_scheduler.desktop import environment, layout, secrets, tls
from shift_scheduler.desktop.layout import DataLayout, RuntimeLayout

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")


def test_issue_signs_loopback_leaf_and_discards_ca_key() -> None:
    ca_pem, leaf_pem, key_pem = tls.issue()
    ca = x509.load_pem_x509_certificate(ca_pem)
    leaf = x509.load_pem_x509_certificate(leaf_pem)
    public = ca.public_key()
    assert isinstance(public, ec.EllipticCurvePublicKey)
    leaf.verify_directly_issued_by(ca)
    constraints = ca.extensions.get_extension_for_class(x509.BasicConstraints).value
    assert constraints.ca and constraints.path_length == 0
    san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert san.get_values_for_type(x509.IPAddress) == [
        ipaddress.ip_address("127.0.0.1")
    ]
    assert not leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    assert b"PRIVATE KEY" in key_pem and b"PRIVATE KEY" not in ca_pem


@posix_only
def test_ensure_writes_owner_only_files_and_reissues_partial_sets(
    tmp_path: Path,
) -> None:
    ca, cert, key = tmp_path / "ca.pem", tmp_path / "server.pem", tmp_path / "key.pem"
    tls.ensure(ca, cert, key)
    for path in (ca, cert, key):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    first = ca.read_bytes()
    tls.ensure(ca, cert, key)
    assert ca.read_bytes() == first  # complete set is kept
    cert.unlink()
    tls.ensure(ca, cert, key)
    assert ca.read_bytes() != first  # partial set: whole new CA and leaf
    leaf = x509.load_pem_x509_certificate(cert.read_bytes())
    leaf.verify_directly_issued_by(x509.load_pem_x509_certificate(ca.read_bytes()))


def test_leaf_renewal_window(tmp_path: Path) -> None:
    ca, cert, key = tmp_path / "ca.pem", tmp_path / "server.pem", tmp_path / "key.pem"
    tls.ensure(ca, cert, key)
    assert not tls.leaf_expires_within(cert, 30)
    assert tls.leaf_expires_within(cert, tls.LEAF_DAYS + 1)


@posix_only
def test_secrets_created_once_and_owner_only(tmp_path: Path) -> None:
    path = tmp_path / "secrets.json"
    first = secrets.load_or_create(path)
    assert set(first) == set(secrets.FIELDS)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert secrets.load_or_create(path) == first
    assert len(first["jwt_secret"]) >= 32 and "setup_token" not in first
    assert len(bytes.fromhex(first["authority_private_key"])) == 32


@posix_only
def test_secrets_refuse_group_readable_or_incomplete(tmp_path: Path) -> None:
    path = tmp_path / "secrets.json"
    secrets.load_or_create(path)
    os.chmod(path, 0o640)
    with pytest.raises(PermissionError):
        secrets.load_or_create(path)
    os.chmod(path, 0o600)
    path.write_text(json.dumps({"install_id": "x"}), encoding="utf-8")
    with pytest.raises(ValueError, match="incomplete"):
        secrets.load_or_create(path)


def test_write_private_never_overwrites(tmp_path: Path) -> None:
    path = tmp_path / "file"
    secrets.write_private(path, b"one")
    with pytest.raises(FileExistsError):
        secrets.write_private(path, b"two")
    assert path.read_bytes() == b"one"


def _secret() -> dict[str, str]:
    return secrets.generate()


def test_children_do_not_inherit_unlisted_variables(tmp_path: Path) -> None:
    parent = {"PATH": "/bin", "AWS_SECRET_ACCESS_KEY": "x", "DATABASE_URL": "other"}
    data = DataLayout(tmp_path)
    secret = _secret()
    for env in (
        environment.application(parent, secret, data, "t"),
        environment.control(parent, secret, data),
        environment.web(parent, data),
        environment.postgres(parent),
    ):
        assert "AWS_SECRET_ACCESS_KEY" not in env
        assert env["PATH"] == "/bin"
    assert "PGPASSWORD" not in environment.postgres(parent)
    assert environment.application(parent, secret, data, "t")["DATABASE_URL"] != "other"


def test_web_and_control_do_not_receive_application_secrets(tmp_path: Path) -> None:
    data, secret = DataLayout(tmp_path), _secret()
    web = environment.web({}, data)
    control = environment.control({}, secret, data)
    for value in (
        secret["jwt_secret"],
        secret["app_db_password"],
        secret["admin_db_password"],
        "setup-token-value",
    ):
        assert value not in json.dumps(web)
    assert secret["jwt_secret"] not in json.dumps(control)
    assert "DATABASE_URL" not in control


def test_application_and_control_use_separate_databases(tmp_path: Path) -> None:
    data, secret = DataLayout(tmp_path), _secret()
    app_url = environment.application({}, secret, data, "t")["DATABASE_URL"]
    control_url = environment.control({}, secret, data)["PHARMSHIFT_AUTHORITY_DB_URL"]
    assert f"/{layout.APP_DB}?" in app_url and f"//{layout.APP_USER}:" in app_url
    assert f"/{layout.CONTROL_DB}?" in control_url
    assert f"//{layout.CONTROL_USER}:" in control_url
    for url in (app_url, control_url):
        assert url.endswith("?require_auth=scram-sha-256")
        assert layout.ADMIN_USER not in url
    assert "control" in layout.CONTROL_DB and "control" not in layout.APP_DB


def test_credentials_match_the_client_settings(tmp_path: Path) -> None:
    data, secret = DataLayout(tmp_path), _secret()
    app = environment.application({}, secret, data, "t")
    granted = json.loads(
        environment.control({}, secret, data)["PHARMSHIFT_AUTHORITY_CREDENTIALS"]
    )
    node = granted[app["PHARMSHIFT_CONTROL_NODE"]]
    assert node == {"role": "source", "token": app["PHARMSHIFT_CONTROL_TOKEN"]}
    assert granted[environment.OPERATOR]["role"] == "operator"


@posix_only
def test_application_environment_passes_the_desktop_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path.resolve() / "data"
    data = DataLayout(root)
    data.storage.mkdir(parents=True, mode=0o700)
    os.chmod(data.storage, 0o700)
    env = environment.application({}, _secret(), data, "t" * 32)
    for key in list(os.environ):
        if key.startswith(("PHARMSHIFT_", "AUTH_", "API_", "FRONTEND_", "DATABASE_")):
            monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(desktop_config, "_local_filesystem", lambda _path: True)
    auth_settings.get_auth_mode.cache_clear()
    auth_settings.get_session_settings.cache_clear()
    try:
        desktop_config.check_desktop()
    finally:
        auth_settings.get_auth_mode.cache_clear()
        auth_settings.get_session_settings.cache_clear()


def test_runtime_layout_paths() -> None:
    runtime = RuntimeLayout(Path("/r"))
    if sys.platform == "win32":
        assert runtime.python == Path("/r/python/python.exe")
    else:
        assert runtime.python == Path("/r/python/bin/python3")
        assert runtime.pg("pg_ctl") == Path("/r/pg/bin/pg_ctl")
    assert runtime.web == Path("/r/web")


def test_cert_lifetime_constants_are_sane() -> None:
    assert tls.LEAF_DAYS <= 825
    now = datetime.datetime.now(datetime.UTC)
    leaf = x509.load_pem_x509_certificate(tls.issue(now)[1])
    assert leaf.not_valid_before_utc <= now


def test_each_database_admits_only_its_owner_role() -> None:
    from shift_scheduler.desktop import launcher

    rules = [line.split() for line in launcher.PG_HBA.splitlines()]
    assert all(rule[0] == "host" and rule[3] == "127.0.0.1/32" for rule in rules)
    assert all(rule[4] == "scram-sha-256" for rule in rules)
    assert {(rule[1], rule[2]) for rule in rules} == {
        (layout.APP_DB, layout.APP_USER),
        (layout.CONTROL_DB, layout.CONTROL_USER),
        ("postgres", layout.ADMIN_USER),
    }


def test_postgres_logs_exclude_statements_and_details() -> None:
    from shift_scheduler.desktop import launcher

    assert "log_min_error_statement = panic" in launcher.POSTGRES_CONF
    assert "log_error_verbosity = terse" in launcher.POSTGRES_CONF
    assert "unix_socket_directories = ''" in launcher.POSTGRES_CONF


@posix_only
def test_reap_previous_stops_only_processes_from_this_runtime(tmp_path: Path) -> None:
    import subprocess
    import time

    from shift_scheduler.desktop import launcher

    runtime = RuntimeLayout(tmp_path / "runtime-root")
    data = DataLayout(tmp_path / "data")
    data.state.mkdir(parents=True)
    ours = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)", str(runtime.root)]
    )
    other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        data.children.write_text(json.dumps([ours.pid, other.pid, "x", 1]))
        time.sleep(0.3)
        assert launcher.reap_previous(data, runtime) == [ours.pid]
        assert ours.wait(10) is not None
        assert other.poll() is None
        assert not data.children.exists()
    finally:
        for process in (ours, other):
            if process.poll() is None:
                process.kill()
            process.wait()


def test_corrupted_leaf_is_reissued(tmp_path: Path) -> None:
    from shift_scheduler.desktop import launcher

    data = DataLayout(tmp_path)
    data.tls.mkdir(parents=True)
    tls.ensure(data.ca, data.cert, data.key)
    first_ca = data.ca.read_bytes()
    data.cert.write_bytes(b"-----BEGIN CERTIFICATE-----\ntruncated")
    launcher.ensure_tls(data)
    assert data.ca.read_bytes() != first_ca
    x509.load_pem_x509_certificate(data.cert.read_bytes()).verify_directly_issued_by(
        x509.load_pem_x509_certificate(data.ca.read_bytes())
    )


def test_setup_token_changes_per_launch_and_is_not_stored(tmp_path: Path) -> None:
    assert secrets.setup_token() != secrets.setup_token()
    assert "setup_token" not in secrets.FIELDS
