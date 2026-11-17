from __future__ import annotations

from pathlib import Path

import pytest

from shift_scheduler.logging_utils.forwarder import (
    FileTailer,
    ForwardRecord,
    LogForwarder,
    LogSource,
    StdoutBackend,
    parse_label_pairs,
)


def test_parse_label_pairs() -> None:
    labels = parse_label_pairs("env=prod,region=ap-northeast-1")
    assert labels["env"] == "prod"
    assert labels["region"] == "ap-northeast-1"
    assert parse_label_pairs(None) == {}
    with pytest.raises(ValueError):
        parse_label_pairs("invalid")


def test_file_tailer_reads_only_new_lines(tmp_path: Path) -> None:
    log_file = tmp_path / "audit.log"
    log_file.write_text("line-1\n", encoding="utf-8")
    tailer = FileTailer(log_file, start_from_end=False)

    first_batch = tailer.read_new_lines()
    assert first_batch == ["line-1"]

    log_file.write_text("line-1\nline-2\nline-3\n", encoding="utf-8")
    second_batch = tailer.read_new_lines()
    assert second_batch == ["line-2", "line-3"]


class RecordingBackend(StdoutBackend):
    def __init__(self) -> None:
        self.records: list[ForwardRecord] = []

    def send(self, records):  # type: ignore[override]
        self.records.extend(records)


def test_forwarder_batches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log_file = tmp_path / "audit.log"
    log_file.write_text("", encoding="utf-8")
    tailer = FileTailer(log_file, start_from_end=True)
    source = LogSource(name="audit", tailer=tailer)
    backend = RecordingBackend()
    forwarder = LogForwarder([source], backend, batch_size=10, poll_interval=0.01)

    log_file.write_text("entry-1\nentry-2\n", encoding="utf-8")
    forwarded = forwarder.drain_once()
    assert forwarded == 2
    assert [record.message for record in backend.records] == ["entry-1", "entry-2"]

    log_file.write_text("entry-1\nentry-2\nentry-3\n", encoding="utf-8")
    forwarder.drain_once()
    assert [record.message for record in backend.records][-1] == "entry-3"
