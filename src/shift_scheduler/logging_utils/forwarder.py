"""Utility classes for shipping logs to external backends.

The forwarder is intentionally lightweight so it can run as a cron job,
systemd service, or one-off troubleshooting command.  It currently supports
three backends:

* stdout (for local debugging)
* Grafana Loki (HTTP push API)
* AWS CloudWatch Logs (via boto3, imported lazily)

Each backend receives :class:`ForwardRecord` objects produced by
``LogForwarder``.  Files are tailed using ``FileTailer`` which keeps track of
the last read offset and gracefully handles file truncation (logrotate).
"""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import os
import time
from collections.abc import MutableMapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ForwardRecord:
    """A single log entry that will be shipped to a backend."""

    message: str
    source: str
    path: str
    timestamp_ns: int
    event_id: str = ""

    def to_message(self) -> str:
        return json.dumps(
            {
                "message": self.message,
                "source": self.source,
                "path": self.path,
                "timestamp": self.timestamp_ns,
                "event_id": self.event_id,
            },
            ensure_ascii=False,
        )


class FileTailer:
    """Bounded reads with an atomic durable cursor committed only after ACK.

    Delivery is at least once: receivers must deduplicate after an ambiguous ACK.
    Incomplete final lines are held until their newline arrives.
    """

    def __init__(
        self,
        path: Path,
        *,
        start_from_end: bool = True,
        cursor_path: Path | None = None,
    ) -> None:
        self.path = path
        self.cursor_path = cursor_path or path.with_name(path.name + ".cursor.json")
        self._position = 0
        self._inode = None
        self._pending: tuple[int, int] | None = None
        self.pending_ids: list[str] = []
        if self.cursor_path.exists():
            state = json.loads(self.cursor_path.read_text())
            self._position, self._inode = state["position"], state["inode"]
        elif path.exists():
            info = path.stat()
            self._inode = info.st_ino
            self._position = info.st_size if start_from_end else 0

    def peek_new_lines(self) -> list[str]:
        if not self.path.exists():
            return []
        info = self.path.stat()
        source = self.path
        position = self._position
        inode = self._inode
        if inode is not None and inode != info.st_ino:
            rotated = [
                p
                for p in self.path.parent.glob(self.path.name + ".*")
                if p.is_file() and p.stat().st_ino == inode
            ]
            if rotated and rotated[0].stat().st_size > position:
                source = rotated[0]
            else:
                position, inode = 0, info.st_ino
        else:
            inode = info.st_ino
        if source.stat().st_size < position:
            position = 0
        with source.open("rb") as stream:
            stream.seek(position)
            chunk = stream.read(1024 * 1024)
        newline = chunk.rfind(b"\n")
        if newline < 0:
            if len(chunk) == 1024 * 1024:
                raise ValueError("Log line exceeds forwarding resource limit")
            return []
        complete = chunk[: newline + 1]
        lines = []
        self.pending_ids = []
        offset = position
        for raw in complete.splitlines(keepends=True):
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.strip():
                lines.append(line)
                identity = f"{self.path.resolve()}|{inode}|{offset}|".encode() + raw
                self.pending_ids.append(hashlib.sha256(identity).hexdigest())
            offset += len(raw)
        self._pending = (position + len(complete), inode)
        return lines

    def acknowledge(self) -> None:
        if self._pending is None:
            return
        position, inode = self._pending
        temporary = self.cursor_path.with_name(self.cursor_path.name + ".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump({"position": position, "inode": inode}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.cursor_path)
        self._position, self._inode = position, inode
        self._pending = None

    def read_new_lines(self) -> list[str]:
        """Convenience consuming read; network forwarders must use peek/ack."""
        lines = self.peek_new_lines()
        self.acknowledge()
        return lines


@dataclass(slots=True)
class LogSource:
    name: str
    tailer: FileTailer


class LogBackend:
    def send(
        self, records: Sequence[ForwardRecord]
    ) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class StdoutBackend(LogBackend):
    def send(self, records: Sequence[ForwardRecord]) -> None:
        for record in records:
            logger.info("%s", record.to_message())


class LokiBackend(LogBackend):
    def __init__(
        self,
        endpoint: str,
        *,
        labels: MutableMapping[str, str] | None = None,
        tenant_id: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._labels = dict(labels or {})
        self._tenant_id = tenant_id
        self._client = httpx.Client(timeout=timeout)

    def send(self, records: Sequence[ForwardRecord]) -> None:
        if not records:
            return
        values = [[str(record.timestamp_ns), record.to_message()] for record in records]
        stream: dict[str, Any] = {"stream": self._labels, "values": values}
        url = f"{self._endpoint}/loki/api/v1/push"
        headers = {"Content-Type": "application/json"}
        if self._tenant_id:
            headers["X-Scope-OrgID"] = self._tenant_id
        response = self._client.post(url, headers=headers, json={"streams": [stream]})
        response.raise_for_status()


class CloudWatchBackend(LogBackend):
    def __init__(
        self,
        log_group: str,
        log_stream: str,
        *,
        region: str | None = None,
    ) -> None:
        try:
            boto3 = importlib.import_module("boto3")
            botocore_exceptions = importlib.import_module("botocore.exceptions")
            client_error = botocore_exceptions.ClientError
        except ModuleNotFoundError as exc:  # pragma: no cover - optional import
            raise RuntimeError(
                "CloudWatch backend requires boto3; install with `pip install boto3`."
            ) from exc

        self._client: Any = boto3.client("logs", region_name=region)
        self._log_group = log_group
        self._log_stream = log_stream
        self._sequence_token: str | None = None
        self._client_error: Any = client_error

    def send(self, records: Sequence[ForwardRecord]) -> None:
        if not records:
            return
        events: list[dict[str, Any]] = [
            {
                "message": record.to_message(),
                "timestamp": int(record.timestamp_ns / 1_000_000),
            }
            for record in records
        ]
        kwargs: dict[str, object] = {
            "logGroupName": self._log_group,
            "logStreamName": self._log_stream,
            "logEvents": events,
        }
        if self._sequence_token:
            kwargs["sequenceToken"] = self._sequence_token
        try:
            response = self._client.put_log_events(**kwargs)
            self._sequence_token = response.get("nextSequenceToken")
        except self._client_error as exc:  # pragma: no cover
            response_dict = getattr(exc, "response", {}) or {}
            error_code = response_dict.get("Error", {}).get("Code")
            expected = response_dict.get("expectedSequenceToken")
            if error_code == "InvalidSequenceTokenException" and expected:
                self._sequence_token = expected
                self.send(records)
            else:
                raise


class LogForwarder:
    def __init__(
        self,
        sources: Sequence[LogSource],
        backend: LogBackend,
        *,
        batch_size: int = 200,
        poll_interval: float = 2.0,
    ) -> None:
        self.sources = list(sources)
        self.backend = backend
        self.batch_size = batch_size
        self.poll_interval = poll_interval

    def drain_once(self) -> int:
        sent = 0
        for source in self.sources:
            lines = source.tailer.peek_new_lines()
            records = [
                ForwardRecord(
                    message=line,
                    source=source.name,
                    path=str(source.tailer.path),
                    timestamp_ns=time.time_ns(),
                    event_id=event_id,
                )
                for line, event_id in zip(lines, source.tailer.pending_ids, strict=True)
            ]
            for offset in range(0, len(records), self.batch_size):
                batch = records[offset : offset + self.batch_size]
                self.backend.send(batch)
                sent += len(batch)
            source.tailer.acknowledge()
        return sent

    def run(self) -> None:  # pragma: no cover - simple loop
        logger.info("Starting log forwarder for %d source(s).", len(self.sources))
        while True:
            self.drain_once()
            time.sleep(self.poll_interval)


def parse_label_pairs(pairs: str | None) -> dict[str, str]:
    if not pairs:
        return {}
    labels: dict[str, str] = {}
    for chunk in pairs.split(","):
        if not chunk:
            continue
        if "=" not in chunk:
            raise ValueError(f"Invalid label pair: '{chunk}'")
        key, value = chunk.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise ValueError("Label key must not be empty")
        labels[key] = value
    return labels


__all__ = [
    "CloudWatchBackend",
    "FileTailer",
    "ForwardRecord",
    "LogForwarder",
    "LogSource",
    "LokiBackend",
    "StdoutBackend",
    "parse_label_pairs",
]
