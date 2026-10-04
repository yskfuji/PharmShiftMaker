"""Fast iteration loop for the 25-month person-erasure tail (development only).

`capture` replays the canonical events before the first hold/erasure event once
into a dedicated isolated database and saves the adapter state and managed files.
`replay` clones that database (PostgreSQL TEMPLATE) and runs only the tail events
with the registered reviewer, optionally followed by post-expiry processing.

This is NOT acceptance evidence: no physical PITR, no independent control
authority (a bounded fake control client is used), no restore or release. Final
evidence still needs one full `scripts.long_pitr_workflows` run on frozen code.
"""

import argparse
import json
import os
import pickle
import re
import shutil
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

TAIL_KINDS = {"hold", "erasure_attempt", "erasure", "backup_expiry", "restore"}
STATE_EXCLUDED = {"api", "factory", "stack", "reviewer", "wall_window"}


def admin_url():
    url = make_url(os.environ["PHARMSHIFT_TEST_PG_URL"])
    if url.host not in {"127.0.0.1", "localhost"} or not (
        url.database or ""
    ).startswith("pharmshift_audit"):
        raise ValueError("Only an isolated local pharmshift_audit database is allowed")
    return url


def database_url(name, schema):
    if not re.fullmatch(r"pharmshift_audit_(ckpt|fast)_[0-9a-f]{12}", name):
        raise ValueError("Unexpected fast-loop database name")
    return (
        admin_url()
        .set(database=name)
        .update_query_dict({"options": "-csearch_path=" + schema})
        .render_as_string(hide_password=False)
    )


def create_database(name, template=None):
    engine = create_engine(admin_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(
                text(
                    f'CREATE DATABASE "{name}"'
                    + (f' TEMPLATE "{template}"' if template else "")
                )
            )
    finally:
        engine.dispose()


def drop_database(name):
    if not re.fullmatch(r"pharmshift_audit_fast_[0-9a-f]{12}", name):
        raise ValueError("Only fast-loop replay databases are dropped automatically")
    engine = create_engine(admin_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    finally:
        engine.dispose()


def split_events():
    from scripts.long_integrated_scenario import scenario

    events = scenario()
    cut = next(i for i, e in enumerate(events) if e["kind"] in TAIL_KINDS)
    return events[:cut], events[cut:]


def capture(directory):
    from scripts.long_integrated_workflows import LongWorkflowDiagnostics
    from scripts.long_pitr_workflows import export_committed_input, source_manifest

    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=False)
    managed = directory / "managed"
    managed.mkdir()
    name, schema = "pharmshift_audit_ckpt_" + uuid4().hex[:12], "audit_" + uuid4().hex
    create_database(name)
    url = database_url(name, schema)
    bootstrap = create_engine(url)
    with bootstrap.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    bootstrap.dispose()
    head, tail = split_events()
    with patch.dict(
        os.environ,
        {
            "DATABASE_URL": url,
            "SHIFT_SCHEDULER_DB_URL": url,
            "PHARMSHIFT_MANAGED_STORAGE": str(managed),
        },
    ):
        command.upgrade(Config("alembic.ini"), "head")
        engine = create_engine(url)
        factory = sessionmaker(engine, expire_on_commit=False)
        adapter = LongWorkflowDiagnostics(factory, person_prefix="long-")
        adapter.setup()
        try:
            for event in head:
                if event["kind"] == "backup":
                    export_committed_input(adapter, managed, event)
                    adapter.applied_events.append(event)
                else:
                    adapter.apply(event)
            state = {k: v for k, v in vars(adapter).items() if k not in STATE_EXCLUDED}
        finally:
            adapter.close()
            engine.dispose()
    (directory / "adapter-state.pickle").write_bytes(pickle.dumps(state))
    meta = {
        "database": name,
        "schema": schema,
        "head_events": len(head),
        "tail_events": [e["event_id"] for e in tail],
        "captured_at": datetime.now(UTC).isoformat(),
        "source_manifest": source_manifest(),
        "boundary": "Development checkpoint only; not acceptance evidence.",
    }
    (directory / "checkpoint.json").write_text(json.dumps(meta, indent=2))
    return meta


def replay(checkpoint, output, protocol, *, deferred=False, keep=False):
    from scripts.long_integrated_workflows import LongWorkflowDiagnostics
    from scripts.long_pitr_workflows import source_manifest
    from scripts.long_subject_events import (
        apply_deferred_expiry,
        apply_subject_event,
        deferred_time,
    )
    from scripts.long_subject_review import SyntheticReviewer, protocol_digest
    from scripts.subject_run_summary import summarize

    from shift_scheduler.application import subject_controls
    from shift_scheduler.control import transaction

    checkpoint = Path(checkpoint).resolve()
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    meta = json.loads((checkpoint / "checkpoint.json").read_text())
    drift = sorted(
        k
        for k, v in source_manifest().items()
        if k.startswith("alembic/") and meta["source_manifest"].get(k) != v
    )
    if drift:
        raise ValueError(
            "Schema migrations changed since the checkpoint; capture again: "
            + ", ".join(drift)
        )
    name = "pharmshift_audit_fast_" + uuid4().hex[:12]
    create_database(name, template=meta["database"])
    managed = output / "managed"
    shutil.copytree(checkpoint / "managed", managed)
    url = database_url(name, meta["schema"])
    head, tail = split_events()
    result = {
        "status": "RUNNING",
        "mode": "FASTLOOP_DEVELOPMENT_ONLY",
        "acceptance_evidence": False,
        "checkpoint": str(checkpoint),
        "processed": [],
        "unconnected": [],
    }
    digest = protocol_digest(protocol)
    result["review_protocol"] = {"path": str(protocol), "sha256": digest}
    fake = SimpleNamespace(
        client_id="fastloop",
        require_access=lambda: {"generation": 1},
        request=lambda *_args: {},
    )
    engine = None
    adapter = None
    try:
        with ExitStack() as stack:
            stack.enter_context(
                patch.dict(
                    os.environ,
                    {
                        "DATABASE_URL": url,
                        "SHIFT_SCHEDULER_DB_URL": url,
                        "PHARMSHIFT_MANAGED_STORAGE": str(managed),
                        "PHARMSHIFT_ERASURE_MANIFEST_KEY": "x" * 32,
                    },
                )
            )
            stack.enter_context(
                patch.object(subject_controls, "configured_client", lambda: fake)
            )
            stack.enter_context(
                patch.object(transaction, "configured_client", lambda: fake)
            )
            engine = create_engine(url)
            factory = sessionmaker(engine, expire_on_commit=False)
            adapter = LongWorkflowDiagnostics(factory, person_prefix="long-")
            vars(adapter).update(
                pickle.loads((checkpoint / "adapter-state.pickle").read_bytes())
            )
            adapter.api.attach_existing()
            adapter.patch_clock()
            adapter.reviewer = SyntheticReviewer(
                protocol, digest, output / "review-decisions.jsonl"
            )
            adapter.wall_window = (datetime.now(UTC),)
            processed = list(head)
            for event in tail:
                if event["kind"] in {"restore", "backup_expiry"}:
                    result["unconnected"].append(event["event_id"])
                    continue
                if event["kind"] == "erasure":
                    result.setdefault("subject_events", []).append(
                        apply_subject_event(adapter, event, managed)
                    )
                else:
                    adapter.apply(event)
                processed.append(event)
                result["processed"].append(event["event_id"])
            if deferred:
                at = deferred_time(adapter.reviewer.protocol, processed)
                result["deferred_expiry"] = {
                    "synthetic_at": at.isoformat(),
                    "events": [
                        apply_deferred_expiry(adapter, p, at, managed)
                        for p in ("p0", "p1")
                    ],
                }
            result["status"] = "FASTLOOP_COMPLETED"
    except BaseException as error:
        result.update(
            status="FAILED", error_type=type(error).__name__, error=str(error)
        )
        raise
    finally:
        if adapter:
            adapter.close()
        if engine:
            engine.dispose()
        decisions_path = output / "review-decisions.jsonl"
        decisions = (
            [json.loads(line) for line in decisions_path.read_text().splitlines()]
            if decisions_path.exists()
            else []
        )
        result["summary"] = summarize(
            {**result, "processed_count": len(result["processed"])}, decisions
        )
        (output / "result.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False, default=str)
        )
        if not keep:
            drop_database(name)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("capture")
    c.add_argument("--checkpoint", type=Path, required=True)
    r = sub.add_parser("replay")
    r.add_argument("--checkpoint", type=Path, required=True)
    r.add_argument("--output", type=Path, required=True)
    r.add_argument("--review-protocol", type=Path, required=True)
    r.add_argument("--deferred-expiry", action="store_true")
    r.add_argument("--keep-database", action="store_true")
    args = parser.parse_args()
    if args.command == "capture":
        print(json.dumps(capture(args.checkpoint), indent=2)[:600])
    else:
        result = replay(
            args.checkpoint,
            args.output,
            args.review_protocol,
            deferred=args.deferred_expiry,
            keep=args.keep_database,
        )
        summary = result["summary"]
        for phase in ("canonical", "deferred"):
            for row in summary[phase]:
                print(
                    phase,
                    row["person_id"],
                    "db",
                    row["database_erased"],
                    "file",
                    row["file_erased"],
                    "residual",
                    row["residual"],
                    "rejected_but_erased",
                    row["rejected_but_erased"],
                )
        print("violations:", summary["violations"] or "none")
        raise SystemExit(1 if summary["violations"] else 0)


if __name__ == "__main__":
    main()
