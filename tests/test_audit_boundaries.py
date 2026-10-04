import io
import tarfile

import pytest

from shift_scheduler.logging_utils.forwarder import (
    FileTailer,
    LogBackend,
    LogForwarder,
    LogSource,
)
from shift_scheduler.ops.archive import create_archive, restore_archive
from shift_scheduler.ops.attendance_adapter import (
    AdapterConfig,
    AttendanceAdapterError,
    PersonMapping,
    ShiftMapping,
    build_attendance_rows,
)
from shift_scheduler.ops.exporter import _write_csv


def test_archive_roundtrip_duplicate_basenames_and_traversal(tmp_path):
    a, b = tmp_path / "a" / "config", tmp_path / "b" / "config"
    a.mkdir(parents=True)
    b.mkdir(parents=True)
    (a / "state.txt").write_text("first")
    (b / "state.txt").write_text("second")
    archive = tmp_path / "backup.tar.gz"
    create_archive([a, b], archive)
    restored = tmp_path / "restored"
    restore_archive(archive, restored)
    assert (restored / "sources/0000/config/state.txt").read_text() == "first"
    assert (restored / "sources/0001/config/state.txt").read_text() == "second"
    with pytest.raises(ValueError):
        restore_archive(archive, restored)
    malicious = tmp_path / "malicious.tar.gz"
    with tarfile.open(malicious, "w:gz") as tar:
        entry = tarfile.TarInfo("../escaped.txt")
        entry.size = 1
        tar.addfile(entry, io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        restore_archive(malicious, tmp_path / "target")
    assert not (tmp_path / "escaped.txt").exists()


@pytest.mark.parametrize("name", ["/absolute", "a/../b", "a\\b"])
def test_archive_rejects_unsafe_paths(tmp_path, name):
    path = tmp_path / "bad.tar.gz"
    with tarfile.open(path, "w:gz") as tar:
        info = tarfile.TarInfo(name)
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        restore_archive(path, tmp_path / "out")


def test_log_failed_send_replays_after_restart_and_partial_line(tmp_path):
    path = tmp_path / "audit.log"
    path.write_text("one\npartial")

    class Backend(LogBackend):
        fail = True
        received = []

        def send(self, records):
            if self.fail:
                raise OSError("injected transport failure")
            self.received.extend(r.message for r in records)

    backend = Backend()
    forwarder = LogForwarder(
        [LogSource("audit", FileTailer(path, start_from_end=False))], backend
    )
    with pytest.raises(OSError):
        forwarder.drain_once()
    backend.fail = False
    forwarder = LogForwarder(
        [LogSource("audit", FileTailer(path, start_from_end=False))], backend
    )
    assert forwarder.drain_once() == 1
    assert backend.received == ["one"]
    with path.open("a") as f:
        f.write("-complete\n")
    assert forwarder.drain_once() == 1
    assert backend.received == ["one", "partial-complete"]
    restarted = LogForwarder(
        [LogSource("audit", FileTailer(path, start_from_end=False))], backend
    )
    assert restarted.drain_once() == 0


def test_machine_unknown_mapping_fails_and_human_csv_escapes(tmp_path):
    cfg = AdapterConfig(people={"p": PersonMapping(employee_code="0001")}, shifts={})
    with pytest.raises(AttendanceAdapterError):
        build_attendance_rows(
            [
                {
                    "person_id": "p",
                    "shift_id": "UNKNOWN",
                    "assignment_date": "2026-01-01",
                }
            ],
            cfg,
        )
    cfg.shifts["DAY"] = ShiftMapping(
        start_time="99:99", end_time="17:00", break_minutes=-1
    )
    with pytest.raises(AttendanceAdapterError):
        build_attendance_rows(
            [{"person_id": "p", "shift_id": "DAY", "assignment_date": "not-a-date"}],
            cfg,
        )
    out = tmp_path / "human.csv"
    _write_csv(out, [{"id": "=1+1"}], ["id"])
    assert "'=1+1" in out.read_text()
