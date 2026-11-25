"""Storage platform layer: unchanged POSIX calls and the Windows ACL lock-out.

The POSIX tests pin the exact system calls the reviewed code issued before the
layer existed. The Windows tests only run on Windows (the "Backend (Windows)"
CI job) and exercise real DACLs, junctions and LockFileEx contention.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import pytest

from shift_scheduler.ops import platform_fs

ROOT = Path(__file__).resolve().parents[1]
POSIX_ONLY = pytest.mark.skipif(sys.platform == "win32", reason="POSIX system calls")
WINDOWS_ONLY = pytest.mark.skipif(sys.platform != "win32", reason="Windows only")


def _child_env() -> dict[str, str]:
    path = os.pathsep.join(
        [str(ROOT / "src"), str(ROOT), os.environ.get("PYTHONPATH", "")]
    )
    return {**os.environ, "PYTHONPATH": path}


# --- every platform ---------------------------------------------------------------


@pytest.mark.parametrize(
    "module",
    [
        "shift_scheduler.ops.platform_fs",
        "shift_scheduler.ops.managed_writer",
        "shift_scheduler.ops.erasure_control",
        "shift_scheduler.ops.managed_erasure",
        "shift_scheduler.ops.archive",
        "shift_scheduler.application.publication_artifacts",
        "shift_scheduler.application.storage_reconciliation",
        "shift_scheduler.config.desktop",
        "shift_scheduler.api.main",
    ],
)
def test_storage_modules_import_on_this_platform(module: str) -> None:
    importlib.import_module(module)


def test_fstat_and_lstat_report_the_same_identity(tmp_path: Path) -> None:
    # The Windows layer compares these after every open; if CPython disagreed
    # with itself, every Windows open would be refused as "replaced".
    path = tmp_path / "identity"
    path.write_bytes(b"synthetic")
    fd = os.open(path, os.O_RDONLY)
    try:
        opened, named = os.fstat(fd), os.lstat(path)
    finally:
        os.close(fd)
    assert (opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino)


# Every caller of the delegated open primitives, with its exact flags. The pinned
# storage-route scanner sees only the primitive itself (storage_routes.json), so
# this list keeps each moved call site, and any new one, under explicit review.
_DELEGATED_OPENS = sorted(
    [
        (
            "src/shift_scheduler/application/publication_artifacts.py",
            "read_registered",
            "platform_fs.open_at",
            "os.O_RDONLY | platform_fs.O_NOFOLLOW",
        ),
        (
            "src/shift_scheduler/ops/archive.py",
            "create_archive",
            "platform_fs.open_path",
            "os.O_RDONLY | platform_fs.O_NOFOLLOW | platform_fs.O_NONBLOCK",
        ),
        (
            "src/shift_scheduler/ops/archive.py",
            "create_managed_archive.produce",
            "platform_fs.open_path",
            "os.O_RDONLY | platform_fs.O_NOFOLLOW | platform_fs.O_NONBLOCK",
        ),
        (
            "src/shift_scheduler/ops/erasure_control.py",
            "locked_control",
            "platform_fs.open_path",
            "os.O_CREAT | os.O_RDWR | platform_fs.O_NOFOLLOW",
        ),
        (
            "src/shift_scheduler/ops/managed_erasure.py",
            "erase_verified",
            "platform_fs.open_at",
            "os.O_RDONLY | platform_fs.O_NOFOLLOW",
        ),
        (
            "src/shift_scheduler/ops/managed_writer.py",
            "file_lock",
            "platform_fs.open_at",
            "os.O_RDWR | os.O_CREAT | platform_fs.O_NOFOLLOW",
        ),
        *[
            (
                "src/shift_scheduler/ops/managed_writer.py",
                "publish_bytes",
                "platform_fs.open_at",
                "os.O_RDONLY | platform_fs.O_NOFOLLOW",
            )
        ]
        * 2,
        (
            "src/shift_scheduler/ops/managed_writer.py",
            "publish_bytes",
            "platform_fs.open_at",
            "os.O_WRONLY | os.O_CREAT | os.O_TRUNC | platform_fs.O_NOFOLLOW",
        ),
        (
            "src/shift_scheduler/ops/managed_writer.py",
            "capture",
            "platform_fs.open_at",
            "os.O_CREAT | os.O_WRONLY | os.O_TRUNC | platform_fs.O_NOFOLLOW",
        ),
        *[
            (
                "src/shift_scheduler/ops/managed_writer.py",
                "capture",
                "platform_fs.open_at",
                "os.O_RDONLY | platform_fs.O_NOFOLLOW",
            )
        ]
        * 3,
    ]
)


def test_every_delegated_open_is_a_reviewed_call_site() -> None:
    import ast

    found = []
    for directory in ("src/shift_scheduler", "scripts"):
        for file in sorted((ROOT / directory).rglob("*.py")):
            if file.name == "platform_fs.py":
                continue
            relative = file.relative_to(ROOT).as_posix()

            def visit(node: ast.AST, parents: tuple[str, ...], where: str) -> None:
                if isinstance(
                    node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
                ):
                    parents = (*parents, node.name)
                if isinstance(node, ast.Call):
                    name = ast.unparse(node.func)
                    if name.rsplit(".", 1)[-1] in {"open_at", "open_path"}:
                        flags = ast.unparse(node.args[1]) if len(node.args) > 1 else ""
                        found.append((where, ".".join(parents), name, flags))
                for child in ast.iter_child_nodes(node):
                    visit(child, parents, where)

            visit(ast.parse(file.read_text(encoding="utf-8")), (), relative)
    assert sorted(found) == _DELEGATED_OPENS


def test_failure_after_publication_is_retried(
    sqlite_session_factory: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Platform-neutral form of the directory-ACK fault in test_managed_writer: the
    # fault is injected into the platform layer, which on Windows has no directory
    # fsync for the original test to hook.
    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.ops import managed_writer as writer
    from tests.test_database_erasure_postgres import SCOPE
    from tests.test_managed_writer import reservation

    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    item = reservation(sqlite_session_factory, root, monkeypatch)
    data = b"synthetic p0 export"

    def fail(_directory: Any) -> None:
        raise OSError("Injected directory ACK failure after publication")

    with monkeypatch.context() as patch:
        patch.setattr(platform_fs, "fsync_directory", fail)
        with pytest.raises(OSError, match="Injected"):
            writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, data)
    assert (root / item.copy_id).read_bytes() == data
    assert not (root / (".pending-" + item.copy_id)).exists()
    with sqlite_session_factory() as session:
        assert session.get(ManagedCopy, item.copy_id).state == "WRITE_RETRY"
    path = writer.publish_bytes(sqlite_session_factory, SCOPE, item.copy_id, data)
    assert path == root / item.copy_id
    with sqlite_session_factory() as session:
        assert session.get(ManagedCopy, item.copy_id).state == "PRESENT"
        assert writer.reconcile_files(session)["complete"]


_HOLDER = """
import os, sys
from shift_scheduler.ops import platform_fs
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
platform_fs.lock_exclusive(fd, blocking=True)
print("locked", flush=True)
sys.stdin.readline()
platform_fs.unlock(fd)
os.close(fd)
"""


def test_exclusive_lock_is_contended_between_processes(tmp_path: Path) -> None:
    path = tmp_path / ".lock-contention"
    holder = subprocess.Popen(
        [sys.executable, "-c", _HOLDER, str(path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env=_child_env(),
    )
    assert holder.stdout is not None and holder.stdin is not None
    try:
        assert holder.stdout.readline().strip() == "locked"
        fd = os.open(path, os.O_RDWR)
        try:
            with pytest.raises(BlockingIOError):
                platform_fs.lock_exclusive(fd, blocking=False)
            acquired = threading.Event()

            def wait_for_lock() -> None:
                platform_fs.lock_exclusive(fd, blocking=True)
                acquired.set()

            waiter = threading.Thread(target=wait_for_lock, daemon=True)
            waiter.start()
            assert not acquired.wait(0.5)  # the blocking variant waits
            holder.stdin.write("release\n")
            holder.stdin.flush()
            assert acquired.wait(20)
            waiter.join(5)
            platform_fs.unlock(fd)
        finally:
            os.close(fd)
    finally:
        holder.stdin.close()
        holder.wait(20)
    assert holder.returncode == 0


def test_managed_file_lock_refuses_a_second_holder(tmp_path: Path) -> None:
    from shift_scheduler.ops.managed_writer import file_lock

    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    identity = "a" * 32
    with file_lock(root, identity):
        with pytest.raises(BlockingIOError):
            with file_lock(root, identity):
                pytest.fail("a second holder acquired the managed file lock")
    with file_lock(root, identity):
        pass  # released on exit


def test_erasure_moves_through_private_quarantine_and_refuses_hard_links(
    tmp_path: Path,
) -> None:
    from shift_scheduler.ops.managed_erasure import erase_verified

    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    (root / "dir").mkdir()
    data = b"synthetic erasure bytes"
    digest = hashlib.sha256(data).hexdigest()
    (root / "dir" / "file").write_bytes(data)
    assert erase_verified(root, "dir/file", "c1", digest) is True
    assert not (root / "dir" / "file").exists()
    assert list((root / ".erasure").iterdir()) == []
    (root / "dir" / "kept").write_bytes(data)
    os.link(root / "dir" / "kept", root / "dir" / "other-name")
    with pytest.raises(ValueError, match="exclusively managed"):
        erase_verified(root, "dir/kept", "c2", digest)
    assert (root / "dir" / "other-name").read_bytes() == data


def test_prepare_data_dir_command_line(tmp_path: Path) -> None:
    target = tmp_path / "PharmShiftMaker" / "data"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "shift_scheduler.ops.platform_fs",
            "prepare-data-dir",
            str(target),
        ],
        capture_output=True,
        text=True,
        env=_child_env(),
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["ok"] is True and Path(report["path"]) == target
    assert target.is_dir()
    assert platform_fs.main(["prepare-data-dir", "relative/path"]) == 1
    assert platform_fs.main(["prepare-data-dir", str(tmp_path / "again")]) == 0


# --- POSIX: the reviewed system calls are unchanged --------------------------------


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def __call__(self, name: str, result: Any = None) -> Any:
        def record(*args: Any, **kwargs: Any) -> Any:
            self.calls.append((name, args, kwargs))
            return result

        return record


@POSIX_ONLY
def test_posix_layer_issues_the_same_system_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import fcntl

    calls = _Recorder()
    for name, result in [
        ("open", 7),
        ("dup", 8),
        ("close", None),
        ("stat", "stat"),
        ("mkdir", None),
        ("link", None),
        ("rename", None),
        ("unlink", None),
        ("fsync", None),
    ]:
        monkeypatch.setattr(os, name, calls(f"os.{name}", result))
    monkeypatch.setattr(fcntl, "flock", calls("fcntl.flock"))
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    write_flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW

    assert platform_fs.open_directory("/root") == 7
    assert platform_fs.open_subdirectory("part", 3) == 7
    assert platform_fs.duplicate_directory(3) == 8
    platform_fs.close_directory(3)
    assert platform_fs.open_at("name", write_flags, 0o600, directory=3) == 7
    assert platform_fs.open_at("name", os.O_RDONLY | os.O_NOFOLLOW, directory=3) == 7
    assert platform_fs.open_path("/root/.lock", os.O_RDONLY, 0o600) == 7
    assert platform_fs.stat_at("name", directory=3) == "stat"
    platform_fs.mkdir_at(".erasure", 0o700, directory=3)
    platform_fs.link_at("staged", "final", directory=3)
    platform_fs.rename_at("file", 3, "key", 4)
    platform_fs.unlink_at("staged", directory=3)
    platform_fs.fsync_directory(3)
    platform_fs.fsync_directory_path("/root")
    platform_fs.lock_exclusive(5, blocking=False)
    platform_fs.lock_exclusive(5, blocking=True)
    platform_fs.unlock(5)  # no system call: closing releases flock

    assert calls.calls == [
        ("os.open", ("/root", directory_flags), {}),
        ("os.open", ("part", directory_flags), {"dir_fd": 3}),
        ("os.dup", (3,), {}),
        ("os.close", (3,), {}),
        ("os.open", ("name", write_flags, 0o600), {"dir_fd": 3}),
        ("os.open", ("name", os.O_RDONLY | os.O_NOFOLLOW, 0o777), {"dir_fd": 3}),
        ("os.open", ("/root/.lock", os.O_RDONLY, 0o600), {}),
        ("os.stat", ("name",), {"dir_fd": 3, "follow_symlinks": False}),
        ("os.mkdir", (".erasure",), {"mode": 0o700, "dir_fd": 3}),
        (
            "os.link",
            ("staged", "final"),
            {"src_dir_fd": 3, "dst_dir_fd": 3, "follow_symlinks": False},
        ),
        ("os.rename", ("file", "key"), {"src_dir_fd": 3, "dst_dir_fd": 4}),
        ("os.unlink", ("staged",), {"dir_fd": 3}),
        ("os.fsync", (3,), {}),
        ("os.open", ("/root", os.O_RDONLY), {}),
        ("os.fsync", (7,), {}),
        ("os.close", (7,), {}),
        ("fcntl.flock", (5, fcntl.LOCK_EX | fcntl.LOCK_NB), {}),
        ("fcntl.flock", (5, fcntl.LOCK_EX), {}),
    ]
    assert (
        platform_fs.O_NOFOLLOW,
        platform_fs.O_DIRECTORY,
        platform_fs.O_NONBLOCK,
    ) == (
        os.O_NOFOLLOW,
        os.O_DIRECTORY,
        os.O_NONBLOCK,
    )


@POSIX_ONLY
def test_posix_relative_open_refuses_a_symbolic_link(tmp_path: Path) -> None:
    (tmp_path / "secret").write_bytes(b"outside")
    (tmp_path / "link").symlink_to(tmp_path / "secret")
    directory = platform_fs.open_directory(tmp_path)
    try:
        with pytest.raises(OSError):
            platform_fs.open_at(
                "link", os.O_RDONLY | platform_fs.O_NOFOLLOW, directory=directory
            )
        assert platform_fs.is_link(tmp_path / "link")
        assert not platform_fs.is_link(tmp_path / "secret")
    finally:
        platform_fs.close_directory(directory)
    with pytest.raises(OSError):
        platform_fs.open_directory(tmp_path / "link")


@POSIX_ONLY
def test_posix_privacy_uses_the_mode_bits(tmp_path: Path) -> None:
    private = Path(platform_fs.prepare_data_dir(str(tmp_path / "private")))
    assert (private.stat().st_mode & 0o777) == 0o700
    directory = platform_fs.open_directory(private)
    try:
        assert platform_fs.directory_is_private(directory)
        os.chmod(private, 0o750)
        assert not platform_fs.directory_is_private(directory)
    finally:
        platform_fs.close_directory(directory)
    (tmp_path / "alias").symlink_to(private)
    with pytest.raises(RuntimeError, match="link"):
        platform_fs.prepare_data_dir(str(tmp_path / "alias"))


# --- Windows: ACL lock-out, reparse points and identities --------------------------


def _junction(target: Path, link: Path) -> None:
    import _winapi

    _winapi.CreateJunction(str(target), str(link))


def _icacls(*arguments: str) -> str:
    return subprocess.run(
        ["icacls", *arguments], capture_output=True, text=True, check=True
    ).stdout


@WINDOWS_ONLY
def test_windows_prepared_root_has_the_protected_private_dacl(tmp_path: Path) -> None:
    user = platform_fs.current_user_sid()
    assert user.startswith("S-1-5-")
    root = platform_fs.prepare_data_dir(str(tmp_path / "PharmShiftMaker"))
    state = platform_fs.security_state(root)
    assert state.protected and state.has_dacl
    granted = {e.sid for e in state.entries if e.kind == 0}
    assert user in granted
    assert granted <= {user, "S-1-5-18", "S-1-5-32-544"}
    assert platform_fs.windows_storage_problem(root) is None
    listing = _icacls(root)
    for broad in ("Everyone", "BUILTIN\\Users", "Authenticated Users"):
        assert broad not in listing, listing
    # Re-running on an existing root is idempotent.
    assert platform_fs.prepare_data_dir(root) == root


@WINDOWS_ONLY
def test_windows_inherited_or_widened_dacl_is_refused(tmp_path: Path) -> None:
    problem = platform_fs.windows_storage_problem
    plain = tmp_path / "plain"
    plain.mkdir()
    assert "private" in (problem(str(plain)) or "")
    root = platform_fs.prepare_data_dir(str(tmp_path / "data"))
    _icacls(root, "/grant", "*S-1-1-0:(R)")  # Everyone: read
    message = problem(root) or ""
    assert "private" in message and "S-1-1-0" in message


@WINDOWS_ONLY
def test_windows_shares_and_relative_paths_are_refused() -> None:
    problem = platform_fs.windows_storage_problem
    for share in (r"\\server\share\data", r"\\?\UNC\server\share\data", "//a/b"):
        assert "share" in (problem(share) or ""), share
    assert "existing directory" in (problem(r"relative\data") or "")
    assert "existing directory" in (problem("\\data") or "")  # current-drive root
    with pytest.raises(RuntimeError, match="share"):
        platform_fs.prepare_data_dir(r"\\server\share\data")


@WINDOWS_ONLY
def test_windows_junctions_are_refused_in_every_component(tmp_path: Path) -> None:
    real = Path(platform_fs.prepare_data_dir(str(tmp_path / "real")))
    (real / "inner").mkdir()
    (real / "inner" / "file").write_bytes(b"synthetic")
    alias = tmp_path / "alias"
    _junction(real, alias)
    assert platform_fs.is_link(alias) and not platform_fs.is_link(real)
    problem = platform_fs.windows_storage_problem
    assert "link" in (problem(str(alias)) or "")
    assert "link" in (problem(str(alias / "inner")) or "")
    with pytest.raises(OSError):
        platform_fs.open_directory(alias)
    with pytest.raises(OSError):
        platform_fs.open_directory(alias / "inner")
    with pytest.raises(OSError):
        platform_fs.open_path(alias / "inner" / "file", os.O_RDONLY)
    with pytest.raises(RuntimeError, match="link"):
        platform_fs.prepare_data_dir(str(alias / "new"))
    assert not (real / "new").exists()  # nothing was created through the junction


@WINDOWS_ONLY
def test_windows_junction_inside_the_root_is_not_followed(tmp_path: Path) -> None:
    from shift_scheduler.ops.managed_erasure import erase_verified

    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    outside = tmp_path / "outside"
    outside.mkdir()
    data = b"synthetic outside bytes"
    (outside / "file").write_bytes(data)
    _junction(outside, root / "linked")
    directory = platform_fs.open_directory(root)
    with pytest.raises(OSError):
        platform_fs.open_subdirectory("linked", directory)
    with pytest.raises(OSError):
        erase_verified(root, "linked/file", "c3", hashlib.sha256(data).hexdigest())
    assert (outside / "file").read_bytes() == data


@WINDOWS_ONLY
def test_windows_symbolic_link_file_is_refused(tmp_path: Path) -> None:
    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    (tmp_path / "secret").write_bytes(b"outside")
    try:
        os.symlink(tmp_path / "secret", root / "link")
    except OSError:
        pytest.skip("creating symbolic links needs a privilege on this runner")
    directory = platform_fs.open_directory(root)
    with pytest.raises(OSError):
        platform_fs.open_at("link", os.O_RDONLY, directory=directory)
    with pytest.raises(OSError):
        platform_fs.open_path(root / "link", os.O_RDONLY)


@WINDOWS_ONLY
def test_windows_file_swapped_before_open_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    (root / "object").write_bytes(b"original")
    directory = platform_fs.open_directory(root)
    real_open = os.open

    def swap_then_open(path: Any, flags: int, mode: int = 0o777) -> int:
        # Model a replacement between the lstat check and the open.
        os.unlink(path)
        Path(path).write_bytes(b"replacement")
        return real_open(path, flags, mode)

    monkeypatch.setattr(os, "open", swap_then_open)
    with pytest.raises(OSError, match="replaced"):
        platform_fs.open_at("object", os.O_RDONLY, directory=directory)


@WINDOWS_ONLY
def test_windows_replaced_directory_is_detected(tmp_path: Path) -> None:
    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    directory = platform_fs.open_directory(root)
    root.rename(tmp_path / "moved")
    root.mkdir()
    with pytest.raises(OSError, match="replaced"):
        platform_fs.open_at("x", os.O_RDWR | os.O_CREAT, 0o600, directory=directory)


@WINDOWS_ONLY
def test_windows_quarantine_must_stay_private(tmp_path: Path) -> None:
    from shift_scheduler.ops.managed_erasure import erase_verified

    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    data = b"synthetic quarantine bytes"
    digest = hashlib.sha256(data).hexdigest()
    (root / "a").write_bytes(data)
    assert erase_verified(root, "a", "c4", digest) is True
    _icacls(str(root / ".erasure"), "/grant", "*S-1-5-32-545:(R)")  # Users: read
    (root / "b").write_bytes(data)
    with pytest.raises(ValueError, match="private"):
        erase_verified(root, "b", "c5", digest)
    assert (root / "b").read_bytes() == data


@WINDOWS_ONLY
def test_windows_names_that_windows_would_rewrite_are_refused(tmp_path: Path) -> None:
    root = Path(platform_fs.prepare_data_dir(str(tmp_path / "managed")))
    directory = platform_fs.open_directory(root)
    for name in ("NUL", "con.txt", "trailing.", "trailing ", "file:stream", "a\\b"):
        with pytest.raises(ValueError):
            platform_fs.open_at(
                name, os.O_RDWR | os.O_CREAT, 0o600, directory=directory
            )
    alias = tmp_path / "alias"
    _junction(root, alias)
    with pytest.raises(platform_fs.LinkRefusedError):
        platform_fs.open_directory(alias)


@WINDOWS_ONLY
def test_windows_quarantine_inherits_the_root_dacl(tmp_path: Path) -> None:
    root = platform_fs.prepare_data_dir(str(tmp_path / "managed"))
    directory = platform_fs.open_directory(root)
    platform_fs.mkdir_at(".erasure", 0o700, directory=directory)
    quarantine = os.path.join(root, ".erasure")
    assert platform_fs.dacl_problems(quarantine, require_protected=False) == []
    assert not platform_fs.security_state(quarantine).protected
    assert platform_fs.directory_is_private(
        platform_fs.open_subdirectory(".erasure", directory)
    )
