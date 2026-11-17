"""Run with python -m shift_scheduler.application.worker; one bounded child/job."""

from __future__ import annotations

import multiprocessing as mp
import os
import time
from contextlib import suppress
from datetime import UTC, datetime
from multiprocessing.connection import Connection
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.application.planning import claim_job, finish_job, requested_seed
from shift_scheduler.db.planning_models import PlanningJob
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import SolveResult


def _compute(
    connection: Connection, payload: dict[str, Any], budget: int, seed: int = 0
) -> None:
    from shift_scheduler.optimizer.planning import solve

    try:
        result = solve(
            parse_snapshot(payload),
            budget,
            seed=seed,
            search_workers=int(os.environ.get("PHARMSHIFT_SEARCH_WORKERS", "1")),
        )
        connection.send(result.model_dump(mode="json"))
    finally:
        connection.close()


def run_once(factory: sessionmaker[Session] | None = None) -> bool:
    factory = factory or get_session_factory()
    with factory.begin() as session:
        claimed = claim_job(session)
    if claimed is None:
        return False
    job_id, token, snapshot, budget = claimed
    with factory() as session:
        job = session.get(PlanningJob, job_id)
        seed = requested_seed(job) if job else 0
    started = time.monotonic()
    context = mp.get_context("spawn")
    receiving, sending = context.Pipe(duplex=False)
    process = context.Process(
        target=_compute,
        args=(sending, snapshot.model_dump(mode="json"), budget, seed),
    )
    process.start()
    sending.close()
    deadline = time.monotonic() + budget + 5
    result = None
    try:
        while process.is_alive() and time.monotonic() < deadline:
            if receiving.poll(0.2):
                with suppress(EOFError):
                    result = SolveResult.model_validate(receiving.recv())
                break
            with factory() as session:
                job = session.get(PlanningJob, job_id)
                if not job or job.status != "RUNNING" or job.lease_token != token:
                    break
        # A short child can exit before the liveness check while its result is already buffered.
        if result is None and receiving.poll():
            with suppress(EOFError):
                result = SolveResult.model_validate(receiving.recv())
        if result is None:
            result = SolveResult(
                status="UNKNOWN",
                input_hash=snapshot.input_hash,
                rule_revision=snapshot.rule_revision,
                random_seed=seed,
                solver_version="worker",
                diagnostics=(
                    "Worker stopped, cancelled, crashed, or exceeded its wall-clock budget",
                ),
            )
    finally:
        if process.is_alive():
            process.terminate()
        process.join(timeout=5)
        receiving.close()
    result = result.model_copy(
        update={
            "stage_seconds": {
                **result.stage_seconds,
                "worker_wall": time.monotonic() - started,
            }
        }
    )
    finish_and_measure(factory, job_id, token, result)
    return True


def finish_and_measure(
    factory: sessionmaker[Session], job_id: str, token: str, result: SolveResult
) -> bool:
    """Commit business data first. Missing ACK telemetry is never guessed after a crash."""
    started = time.monotonic()
    with factory.begin() as session:
        job = session.get(PlanningJob, job_id, with_for_update=True)
        if not job or job.status != "RUNNING" or job.lease_token != token:
            return False
        attempt = job.attempts
        finish_job(session, job_id, token, result)
    acknowledged_at = datetime.now(UTC)
    elapsed = time.monotonic() - started
    # This transaction records an upper observation of the preceding commit, not
    # the physical WAL-flush instant. A failure here leaves durable data and NULL telemetry.
    with factory.begin() as session:
        job = session.get(PlanningJob, job_id, with_for_update=True)
        if job and job.attempts == attempt and job.status not in {"QUEUED", "RUNNING"}:
            job.persisted_observed_at = acknowledged_at
            job.stage_seconds = {
                **(job.stage_seconds or {}),
                "finalization_to_commit_ack": elapsed,
            }
    return True


def main() -> None:
    from shift_scheduler.config.production import check_production

    check_production()
    import logging

    from sqlalchemy.exc import OperationalError

    from shift_scheduler.db.restore_lock import RestoreUnavailable

    while True:
        try:
            from shift_scheduler.application.copies import process_one

            copied = process_one(get_session_factory())
            if not run_once() and not copied:
                time.sleep(0.2)
        except (OperationalError, RestoreUnavailable):
            # The lease survives a transient DB outage; do not print SQL or credentials.
            logging.getLogger(__name__).warning(
                "Database unavailable; persisted job lease will be recovered"
            )
            time.sleep(1)


if __name__ == "__main__":
    main()
