"""CLI wrapper to forward audit/access logs to centralized systems."""

from __future__ import annotations

import argparse
import os
from collections.abc import Sequence
from pathlib import Path

from shift_scheduler.logging_utils import (
    CloudWatchBackend,
    FileTailer,
    LogForwarder,
    LogSource,
    LokiBackend,
    StdoutBackend,
    parse_label_pairs,
)


def _discover_default_sources() -> list[tuple[str, Path]]:
    candidates: list[tuple[str, Path]] = []
    audit_path = os.getenv("AUDIT_LOG_PATH")
    if audit_path:
        candidates.append(("audit", Path(audit_path)))
    access_path = os.getenv("ACCESS_LOG_PATH")
    if access_path:
        candidates.append(("access", Path(access_path)))
    return candidates


def _parse_source_arg(value: str) -> tuple[str, Path]:
    if ":" not in value:
        raise argparse.ArgumentTypeError("Expected '<name>:<path>' format for --source")
    name, raw_path = value.split(":", 1)
    if not name.strip():
        raise argparse.ArgumentTypeError("Source name must not be empty")
    return name.strip(), Path(raw_path).expanduser()


def _build_backend(args: argparse.Namespace):
    backend = args.backend
    if backend == "stdout":
        return StdoutBackend()
    if backend == "loki":
        if not args.loki_endpoint:
            raise SystemExit("--loki-endpoint is required for Loki backend")
        labels = parse_label_pairs(args.loki_labels)
        labels.setdefault("job", args.job_label)
        return LokiBackend(
            args.loki_endpoint,
            labels=labels,
            tenant_id=args.loki_tenant_id,
        )
    if backend == "cloudwatch":
        if not args.cloudwatch_log_group or not args.cloudwatch_log_stream:
            raise SystemExit(
                "CloudWatch backend needs --cloudwatch-log-group and --cloudwatch-log-stream"
            )
        return CloudWatchBackend(
            log_group=args.cloudwatch_log_group,
            log_stream=args.cloudwatch_log_stream,
            region=args.cloudwatch_region,
        )
    raise SystemExit(f"Unsupported backend: {backend}")


def _build_sources(
    config: Sequence[tuple[str, Path]], start_from_beginning: bool
) -> list[LogSource]:
    sources: list[LogSource] = []
    for name, path in config:
        tailer = FileTailer(path, start_from_end=not start_from_beginning)
        sources.append(LogSource(name=name, tailer=tailer))
    return sources


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Forward PharmShift logs to centralized storage"
    )
    parser.add_argument(
        "--source",
        action="append",
        type=_parse_source_arg,
        help="Explicit source definition in the form name:/path/to/log",
    )
    parser.add_argument(
        "--backend",
        default=os.getenv("LOG_FORWARDER_BACKEND", "stdout"),
        choices=["stdout", "loki", "cloudwatch"],
        help="Destination backend (default: stdout)",
    )
    parser.add_argument("--job-label", default=os.getenv("LOG_JOB_LABEL", "pharmshift"))
    parser.add_argument("--loki-endpoint", default=os.getenv("LOKI_ENDPOINT"))
    parser.add_argument("--loki-labels", default=os.getenv("LOKI_BASE_LABELS"))
    parser.add_argument("--loki-tenant-id", default=os.getenv("LOKI_TENANT_ID"))
    parser.add_argument(
        "--cloudwatch-log-group", default=os.getenv("CLOUDWATCH_LOG_GROUP")
    )
    parser.add_argument(
        "--cloudwatch-log-stream", default=os.getenv("CLOUDWATCH_LOG_STREAM")
    )
    parser.add_argument("--cloudwatch-region", default=os.getenv("AWS_REGION"))
    parser.add_argument(
        "--batch-size", type=int, default=int(os.getenv("LOG_FORWARDER_BATCH", "200"))
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.getenv("LOG_FORWARDER_INTERVAL", "2.0")),
        help="Seconds between polling the log files",
    )
    parser.add_argument(
        "--start-from-beginning",
        action="store_true",
        help="Read the entire file instead of tailing new lines",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    explicit_sources: Sequence[tuple[str, Path]] | None = args.source
    sources_config = (
        list(explicit_sources) if explicit_sources else _discover_default_sources()
    )
    if not sources_config:
        raise SystemExit(
            "No log sources detected. Use --source name:/path/to/log or set AUDIT_LOG_PATH/ACCESS_LOG_PATH."
        )
    backend = _build_backend(args)
    sources = _build_sources(sources_config, args.start_from_beginning)
    forwarder = LogForwarder(
        sources,
        backend,
        batch_size=args.batch_size,
        poll_interval=args.poll_interval,
    )
    forwarder.run()


if __name__ == "__main__":
    main()
