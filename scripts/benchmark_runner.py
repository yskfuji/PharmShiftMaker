"""Shared full HTTP-path measurement. Failures are durable evidence, never timings of success."""

import argparse
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def measure_case(
    call,
    data,
    *,
    revision,
    budget,
    request_key,
    require_commit_telemetry=False,
    journal=None,
    case_key=None,
):
    """Recover immutable operations before registering potentially stale input.

    A recovered job has no client monotonic receipt origin. Its result can be
    verified functionally but is never presented as a fresh performance sample.
    """
    import hashlib
    from urllib.parse import urlencode

    row = {
        "input_hash": data.input_hash,
        "status": "ERROR",
        "success": False,
        "receipt_seconds": None,
        "observed_end_to_end_seconds": None,
        "phase": "job_lookup",
        "timing_complete": False,
    }
    phases = ("GENERATED", "REGISTERED", "ACCEPTED", "COMMITTED", "OBSERVED")

    def checkpoint(phase, payload):
        if journal is None:
            return
        state = journal.case_state(case_key)
        if state and phases.index(state["phase"]) > phases.index(phase):
            return
        journal.checkpoint(case_key, phase, payload)

    try:
        checkpoint(
            "GENERATED",
            {
                "input_hash": data.input_hash,
                "snapshot": data.model_dump(mode="json"),
                "request_key": request_key,
                "budget_seconds": budget,
            },
        )
        scope = "?scope_id=hospital%2Fpharmacy"
        found = call(
            "/planning/jobs/by-key?"
            + urlencode(
                {"scope_id": "hospital/pharmacy", "idempotency_key": request_key}
            )
        )["job"]
        recovered = found is not None
        row["recovered_existing_job"] = recovered
        if recovered:
            if (
                found["input_hash"] != data.input_hash
                or found["budget_seconds"] != budget
            ):
                raise ValueError(
                    "Operation key resolves to a different input or budget"
                )
            saved = journal.case_state(case_key) if journal else {}
            if saved.get("job_id") not in (None, found["job_id"]):
                raise ValueError("Operation key resolves to a different job")
            checkpoint("REGISTERED", {"registered_input_hash": data.input_hash})
            job = found
            started = None
        else:
            if journal and journal.case_state(case_key).get("job_id"):
                raise ValueError("Previously accepted job disappeared; do not recreate")
            row["phase"] = "input_registration"
            registration_started = time.perf_counter()
            registered = call(
                "/planning/inputs",
                {
                    "snapshot": data.model_dump(mode="json"),
                    "expected_revision": revision,
                },
            )
            row["registration_seconds"] = time.perf_counter() - registration_started
            revision = registered["input_revision"]
            checkpoint("REGISTERED", {"registered_input_hash": data.input_hash})
            row["phase"] = "job_acceptance"
            started = time.perf_counter()
            job = call(
                "/planning/jobs" + scope,
                {
                    "input_hash": data.input_hash,
                    "idempotency_key": request_key,
                    "budget_seconds": budget,
                },
            )
            row["receipt_seconds"] = time.perf_counter() - started
        checkpoint("ACCEPTED", {"job_id": job["job_id"]})
        row.update(job_id=job["job_id"], phase="job_polling")
        polling_started = time.perf_counter()
        while True:
            status = call("/planning/jobs/" + job["job_id"] + scope)
            if status["status"] not in ("QUEUED", "RUNNING"):
                if (
                    not require_commit_telemetry
                    or status.get("persisted_observed_at") is not None
                ):
                    break
                row["phase"] = "commit_telemetry"
                if time.perf_counter() - polling_started > budget + 60:
                    raise TimeoutError(
                        "Terminal result persisted but commit telemetry is missing"
                    )
            if time.perf_counter() - polling_started > budget + 60:
                raise TimeoutError("Job exceeded diagnostic deadline")
            time.sleep(0.1)
        elapsed = time.perf_counter() - started if started is not None else None
        result = status.get("result") or {}
        validation = result.get("validation")
        functional_success = (
            status["status"] in ("OPTIMAL", "FEASIBLE")
            and bool(result.get("draft_id"))
            and isinstance(validation, dict)
            and validation.get("findings") == []
            and bool(validation.get("checked_rules"))
            and validation.get("input_hash") == data.input_hash
        )
        row.update(
            status=status["status"],
            success=functional_success and not recovered,
            functional_success=functional_success,
            phase="completed",
            observed_end_to_end_seconds=elapsed,
            timing_complete=not recovered,
            stages=status.get("stage_seconds"),
            prepared_at=status.get("prepared_at"),
            persisted_observed_at=status.get("persisted_observed_at"),
            commit_telemetry_complete=status.get("persisted_observed_at") is not None,
            timing_basis=(
                "unavailable: original client receipt clock lost; recovery observation is not acceptance timing"
                if recovered
                else "client observes a committed terminal row; includes polling and transport"
            ),
            result=result,
        )
        if status.get("persisted_observed_at"):
            checkpoint(
                "COMMITTED",
                {
                    "persisted_observed_at": status["persisted_observed_at"],
                    "terminal_status": status["status"],
                },
            )
            if not journal or journal.case_state(case_key).get("phase") != "OBSERVED":
                checkpoint(
                    "OBSERVED",
                    {
                        "observation_hash": hashlib.sha256(
                            json.dumps(row, sort_keys=True).encode()
                        ).hexdigest(),
                        "timing_complete": not recovered,
                    },
                )
    except Exception as exc:
        row.update(success=False, error_type=type(exc).__name__, error=str(exc))
    return row, revision


def run(workload_factory, argv=None, *, workload_configuration=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:18502")
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--seed-base", type=int)
    parser.add_argument("--budget", type=int, default=20)
    parser.add_argument("--split", choices=["tuning", "held-out"], required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--people", type=int, nargs="+", default=[30, 40, 50])
    parser.add_argument("--days", type=int, nargs="+", default=[28, 29, 30, 31])
    parser.add_argument("--journal")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--search-threads", type=int, choices=[1, 2])
    parser.add_argument("--image-evidence")
    parser.add_argument("--resource-evidence")
    args = parser.parse_args(argv)
    if args.samples < 1 or args.budget < 1 or min(args.people + args.days) < 1:
        parser.error("Positive sample count, budget and dimensions required")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(str(output))
    if args.resume and not args.journal:
        parser.error("--resume requires an explicit durable journal")
    journal = None
    if args.journal:
        if workload_configuration is None:
            parser.error("The input factory must declare its complete configuration")
        import hashlib

        from scripts.benchmark_journal import Journal

        root = Path(__file__).resolve().parents[1]
        configuration = {
            k: v
            for k, v in vars(args).items()
            if k not in {"output", "journal", "resume"}
        }
        from scripts.benchmark_manifest import build_manifest

        manifest = build_manifest(
            root,
            configuration=configuration,
            workload=workload_configuration,
            search_threads=args.search_threads,
            image_evidence=args.image_evidence,
            resource_evidence=args.resource_evidence,
        )
        journal = Journal(
            args.journal,
            {
                **configuration,
                "workload": workload_configuration,
                "run_manifest": manifest,
            },
            resume=args.resume,
        )
    token = None

    def call(path, body=None):
        request = Request(
            args.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": "Bearer " + token} if token else {}),
            },
        )
        try:
            with urlopen(request, timeout=120) as response:
                return json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"{exc.code}: {exc.read().decode()}") from exc

    def current_revision():
        matches = [
            s for s in call("/planning/scopes") if s["scope_id"] == "hospital/pharmacy"
        ]
        if len(matches) != 1:
            raise ValueError("Exactly one authorized audit scope is required")
        return matches[0]["input_revision"]

    failed = False
    try:
        # Exclusive open prevents two runners from appending to the same evidence.
        with output.open("x") as stream:

            def record(row):
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
                print(
                    json.dumps(
                        {k: v for k, v in row.items() if k != "result"},
                        ensure_ascii=False,
                    ),
                    flush=True,
                )

            try:
                token = call(
                    "/auth/login", {"username": "admin", "password": "pass-admin"}
                )["access_token"]
                revision = current_revision()
            except Exception as exc:
                record(
                    {
                        "status": "ERROR",
                        "success": False,
                        "phase": "setup",
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    }
                )
                return 1
            for n in args.people:
                for days in args.days:
                    for case in range(args.samples):
                        seed = (
                            args.seed_base
                            if args.seed_base is not None
                            else (100000 if args.split == "held-out" else 1000)
                        ) + case
                        descriptor = {
                            "people": n,
                            "days": days,
                            "case": case,
                            "split": args.split,
                            "seed": seed,
                            "budget": args.budget,
                        }
                        case_key = json.dumps(descriptor, sort_keys=True)
                        if journal and (
                            journal.succeeded(case_key)
                            or journal.case_state(case_key).get("phase") == "OBSERVED"
                        ):
                            failed = failed or not journal.first_attempt_succeeded(
                                case_key
                            )
                            continue
                        attempt = (
                            journal.start(case_key, descriptor) if journal else None
                        )
                        try:
                            saved = journal.case_state(case_key) if journal else {}
                            if saved.get("snapshot"):
                                from shift_scheduler.domain.compliance import (
                                    parse_snapshot,
                                )

                                data = parse_snapshot(saved["snapshot"])
                            else:
                                data = workload_factory(n, days, seed)
                            result, revision = measure_case(
                                call,
                                data,
                                revision=revision,
                                budget=args.budget,
                                request_key=saved.get("request_key")
                                or (
                                    hashlib.sha256(
                                        (
                                            str(Path(args.journal).resolve()) + case_key
                                        ).encode()
                                    ).hexdigest()
                                    if journal
                                    else f"{output.stem}-{n}-{days}-{seed}-{args.budget}"
                                ),
                                require_commit_telemetry=True,
                                journal=journal,
                                case_key=case_key,
                            )
                        except Exception as exc:
                            result = {
                                "status": "ERROR",
                                "success": False,
                                "phase": "input_generation",
                                "error_type": type(exc).__name__,
                                "error": str(exc),
                            }
                        if journal:
                            journal.finish(attempt, case_key, result)
                            failed = failed or not journal.first_attempt_succeeded(
                                case_key
                            )
                        record({**descriptor, "attempt_id": attempt, **result})
                        if not result["success"]:
                            failed = True
                            # An interrupted request may have committed. Re-read the
                            # authoritative revision; never retry with guessed state.
                            try:
                                revision = current_revision()
                            except Exception as exc:
                                record(
                                    {
                                        "status": "ERROR",
                                        "success": False,
                                        "phase": "recovery",
                                        "error": str(exc),
                                    }
                                )
                                return 1
    finally:
        if journal:
            journal.close()
    return int(failed)
