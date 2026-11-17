"""F08: managed attendance conversion recovers across processes.

A child process runs the real conversion and is killed (SIGKILL) at one of six
points of the capture (including a torn staging write and a final link whose
staging name was not yet removed); the next run is the unmodified operator command
`python -m scripts.attendance_adapter managed`. It must complete the same
registered output: one PRESENT copy, one file with the committed hash, no
staging file, reconciliation complete, and a third run changes nothing. A second
process started while the first holds the capture lock fails instead of writing.
The output is also read back into intervals (overnight and 24-hour duties) and
the character encoding is fixed to UTF-8 without rejecting non-CP932 names.
Local temporary files and an isolated database only; no product code is modified
(the kill points are installed in the child by monkeypatching).
"""

import csv
import hashlib
import io
import json
import os
import signal
import subprocess
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pytest

from shift_scheduler.db.compliance_models import ManagedCopy
from shift_scheduler.ops import managed_writer as writer
from shift_scheduler.ops.attendance_adapter import managed_attendance_copy_id
from tests.test_managed_writer import SCOPE, reservation
from tests.test_planning_postgres import (
    pg,  # noqa: F401  (fixture; skips without an isolated database)
)

ROOT = Path(__file__).resolve().parents[1]
# 𠮷 (U+20BB7) cannot be encoded in CP932; the output keeps it (UTF-8 is fixed).
NAME = "𠮷田"
MAPPING = {
    "defaults": {
        "break_minutes": 60,
        "output_columns": [
            "date",
            "employee_code",
            "person_id",
            "person_name",
            "shift_id",
            "shift_code",
            "start_time",
            "end_time",
            "end_day_offset",
            "break_minutes",
        ],
    },
    "people": {"p0": {"employee_code": "E0", "person_name": NAME}},
    "shifts": {
        "DAY": {"start_time": "08:30", "end_time": "17:15"},
        "NIGHT": {"start_time": "17:00", "end_time": "09:30", "break_minutes": 120},
        "DUTY24": {
            "start_time": "09:00",
            "end_time": "09:00",
            "end_day_offset": 1,
            "break_minutes": 120,
        },
    },
}
ASSIGNMENTS = [("2026-04-01", "DAY"), ("2026-04-02", "NIGHT"), ("2026-04-04", "DUTY24")]
# Expected intervals, written out by hand (Japan time, no offset in the file).
EXPECTED = {
    ("2026-04-01", "DAY"): (datetime(2026, 4, 1, 8, 30), datetime(2026, 4, 1, 17, 15)),
    ("2026-04-02", "NIGHT"): (datetime(2026, 4, 2, 17, 0), datetime(2026, 4, 3, 9, 30)),
    ("2026-04-04", "DUTY24"): (datetime(2026, 4, 4, 9, 0), datetime(2026, 4, 5, 9, 0)),
}

CHILD = r"""
import os, signal, sys
point, action = sys.argv[1], sys.argv[2]
from shift_scheduler.control import client
from shift_scheduler.ops import managed_writer
hit = lambda: os.kill(os.getpid(), signal.SIGKILL if action == "kill" else signal.SIGSTOP)
state = {"capturing": False, "access": 0}
original_capture, original_access, original_link = managed_writer.capture, client.require_access, os.link
def capture(*args, **kwargs):
    if point == "reserved":
        hit()
    state["capturing"] = True
    return original_capture(*args, **kwargs)
def access():
    # Calls made by capture itself: 1 at entry, 2 after the staging file is written
    # and synced, 3 after the final name is linked (before the copy is PRESENT).
    caller = sys._getframe(1)
    if (state["capturing"] and caller.f_code.co_name == "capture"
            and caller.f_globals.get("__name__") == "shift_scheduler.ops.managed_writer"):
        state["access"] += 1
        if state["access"] == {"staged": 2, "linked": 3}.get(point):
            hit()
    return original_access()
def link(*args, **kwargs):
    if point == "before_link":
        hit()
    return original_link(*args, **kwargs)
original_unlink, original_fdopen = os.unlink, os.fdopen
def unlink(path, *args, **kwargs):
    if point == "not_unlinked" and str(path).startswith(".pending-"):
        hit()   # both names exist: the final link and the staging name
    return original_unlink(path, *args, **kwargs)
class Torn:
    # The staging file receives half of the first write, then the process dies.
    def __init__(self, stream):
        self.stream = stream
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return self.stream.__exit__(*exc)
    def write(self, data):
        self.stream.write(data[:len(data) // 2])
        self.stream.flush()
        hit()
    def __getattr__(self, name):
        return getattr(self.stream, name)
def fdopen(fd, mode="r", *args, **kwargs):
    stream = original_fdopen(fd, mode, *args, **kwargs)
    return Torn(stream) if point == "torn" and state["capturing"] and mode == "wb" else stream
managed_writer.capture, client.require_access, os.link, os.unlink, os.fdopen = capture, access, link, unlink, fdopen
from scripts.attendance_adapter import managed_main
sys.exit(managed_main(sys.argv[3:]))
"""


@pytest.fixture
def setup(tmp_path, monkeypatch, request):
    backend = request.param
    if backend == "sqlite":
        factory = request.getfixturevalue("sqlite_session_factory")
        url = f"sqlite+pysqlite:///{tmp_path / 'pharmshift.db'}"
    else:
        factory = request.getfixturevalue("pg")
        url = os.environ["SHIFT_SCHEDULER_DB_URL"]
    root = tmp_path / "managed"
    root.mkdir()
    schedule = json.dumps(
        {
            "assignments": [
                {"assignment_date": d, "person_id": "p0", "shift_id": s}
                for d, s in ASSIGNMENTS
            ]
        }
    ).encode()
    source = reservation(factory, root, monkeypatch, data=schedule)
    writer.publish_bytes(factory, SCOPE, source.copy_id, schedule)
    mapping = tmp_path / "mapping.json"
    mapping.write_text(json.dumps(MAPPING, ensure_ascii=False), encoding="utf-8")
    source_hash = hashlib.sha256(schedule).hexdigest()
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(
            ("PHARMSHIFT_CONTROL", "DATABASE_URL", "SHIFT_SCHEDULER_DB_URL")
        )
    }
    env.update(
        PHARMSHIFT_MANAGED_STORAGE=str(root),
        DATABASE_URL=url,
        SHIFT_SCHEDULER_DB_URL=url,
        PYTHONPATH=os.pathsep.join([str(ROOT / "src"), str(ROOT)]),
    )
    env.pop("PHARMSHIFT_ENV", None)
    args = [
        "--scope",
        SCOPE,
        "--source-copy-id",
        source.copy_id,
        "--source-hash",
        source_hash,
        "--mapping",
        str(mapping),
    ]
    copy_id = managed_attendance_copy_id(SCOPE, source.copy_id, source_hash, mapping)
    return factory, root, env, args, copy_id, source.copy_id


def child(env, args, point, action="kill"):
    return subprocess.Popen(
        [sys.executable, "-c", CHILD, point, action, *args],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def operator(env, args):
    return subprocess.run(
        [sys.executable, "-m", "scripts.attendance_adapter", "managed", *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def row(factory, copy_id):
    with factory() as session:
        found = session.get(ManagedCopy, copy_id)
        return (
            None
            if found is None
            else (found.state, found.content_hash, dict(found.evidence))
        )


def files(root):
    return sorted(p.name for p in root.iterdir() if not p.name.startswith(".lock-"))


def intervals(data):
    """The attendance file read back as the importer would: date + times + day offset."""
    assert not data.startswith(b"\xef\xbb\xbf")  # UTF-8 without a byte order mark
    text = data.decode("utf-8")  # strict: fails on anything but UTF-8
    result = {}
    for r in csv.DictReader(io.StringIO(text, newline="")):
        day = date.fromisoformat(r["date"])
        start = datetime.combine(day, time.fromisoformat(r["start_time"]))
        end = datetime.combine(
            day + timedelta(days=int(r["end_day_offset"])),
            time.fromisoformat(r["end_time"]),
        )
        result[(r["date"], r["shift_id"])] = (start, end)
        assert r["person_name"] == NAME
    return result


BACKENDS = ["sqlite", "postgres"]  # postgres skips without PHARMSHIFT_TEST_PG_URL
POINTS = {
    # point: expected state right after the kill, and whether staging/final exist
    "reserved": ("CAPTURE_RESERVED", False, False),
    "torn": ("CAPTURING", True, False),
    "staged": ("CAPTURING", True, False),
    "before_link": ("CAPTURE_READY", True, False),
    "not_unlinked": ("CAPTURE_READY", True, True),
    "linked": ("CAPTURE_READY", False, True),
}


@pytest.mark.parametrize("setup", BACKENDS, indirect=True)
@pytest.mark.parametrize("point", list(POINTS))
def test_a_killed_conversion_is_completed_by_the_operator_command(setup, point):
    factory, root, env, args, copy_id, source_id = setup
    killed = child(env, args, point)
    killed.wait(timeout=120)
    assert killed.returncode == -signal.SIGKILL, killed.stderr.read().decode()
    state, _, evidence = row(factory, copy_id)
    expected_state, staged, final = POINTS[point]
    assert state == expected_state
    assert (".pending-" + copy_id in files(root), copy_id in files(root)) == (
        staged,
        final,
    )
    if point == "torn":
        torn_size = (root / (".pending-" + copy_id)).stat().st_size
    if expected_state == "CAPTURE_READY":
        # The committed bytes are reused, never produced again: the same file (inode
        # and modification time) becomes the output.
        kept = os.stat(root / (copy_id if final else ".pending-" + copy_id))
    first = operator(env, args)
    assert first.returncode == 0, first.stderr
    state, content_hash, evidence = row(factory, copy_id)
    assert state == "PRESENT" and not evidence["hash_pending"]
    assert files(root) == sorted([source_id, copy_id])  # one output, no staging left
    data = (root / copy_id).read_bytes()
    assert hashlib.sha256(data).hexdigest() == content_hash
    assert intervals(data) == EXPECTED
    if point == "torn":
        assert 0 < torn_size < len(data)  # the kill really left a partial staging file
    if expected_state == "CAPTURE_READY":
        now = os.stat(root / copy_id)
        assert (now.st_ino, now.st_mtime_ns) == (kept.st_ino, kept.st_mtime_ns)
    with factory() as session:
        assert writer.reconcile_files(session)["complete"]
    again = operator(env, args)
    assert again.returncode == 0, again.stderr
    assert row(factory, copy_id)[:2] == (state, content_hash)
    assert (
        files(root) == sorted([source_id, copy_id])
        and (root / copy_id).read_bytes() == data
    )


@pytest.mark.parametrize("setup", BACKENDS, indirect=True)
def test_a_second_process_fails_while_the_first_holds_the_capture(setup):
    factory, root, env, args, copy_id, source_id = setup
    stopped = child(env, args, "staged", action="stop")
    try:
        _, status = os.waitpid(stopped.pid, os.WUNTRACED)
        assert os.WIFSTOPPED(status)
        second = operator(env, args)
        assert second.returncode == 1 and "変換に失敗しました" in second.stderr
        assert row(factory, copy_id)[0] == "CAPTURING"
    finally:
        os.kill(stopped.pid, signal.SIGCONT)
    stopped.wait(timeout=120)
    assert stopped.returncode == 0, stopped.stderr.read().decode()
    assert row(factory, copy_id)[0] == "PRESENT"
    assert files(root) == sorted([source_id, copy_id])


def test_the_premise_a_name_outside_cp932():
    with pytest.raises(UnicodeEncodeError):
        NAME.encode("cp932")
    # The bytes of a converted file are checked in the tests above (strict UTF-8
    # decoding and the name kept as entered); a CP932 target needs conversion on
    # the receiving side, which this adapter does not claim (ops mapping example).
