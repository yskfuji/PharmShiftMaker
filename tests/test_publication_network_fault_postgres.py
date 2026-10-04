"""Actual HTTP reply loss after publication commits; isolated real PostgreSQL.

The proxy discards a complete successful upstream response. The API is then
restarted before retry. This is a bounded commit/response fault, not a complete
25-month or host power-loss acceptance.
"""

import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from threading import Thread

import httpx
import pytest
from sqlalchemy import func, select

from shift_scheduler.application.planning import register_input
from shift_scheduler.db.planning_models import (
    AccountMembership,
    LeaveBalance,
    LeaveEvent,
    PlanningOutbox,
    PlanningPublication,
)
from shift_scheduler.domain.planning import LeaveAllocation, LeaveGrant, Proposal
from tests.test_control_network_postgres import AckLossProxy, free_port
from tests.test_reviewed_planning import snapshot


def test_publication_committed_reply_lost_api_restart_identical_retry(pg, tmp_path):
    if os.getenv("PHARMSHIFT_TEST_NETWORK_FAULTS") != "1":
        pytest.skip("Explicit local network fault opt-in required")
    data = snapshot(2, 1)
    grant = LeaveGrant(
        grant_id="network-grant",
        person_id="p1",
        employer_id="hospital",
        granted_on=date(2025, 1, 1),
        expires_on=date(2027, 1, 1),
        amount=2,
        evidence=data.policy_evidence,
    )
    leave = LeaveAllocation(
        allocation_id="network-leave",
        grant_id=grant.grant_id,
        person_id="p1",
        start=data.period.start,
        end=data.period.end,
        amount=1,
        decision=data.policy_evidence,
    )
    data = data.model_copy(update={"grants": (grant,), "leaves": (leave,)})
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p0",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
        register_input(session, data, "isolated-network-fixture", 0)
    url = pg.kw["bind"].url.render_as_string(hide_password=False)
    api_port = free_port()
    proxy = AckLossProxy(("127.0.0.1", api_port))
    thread = Thread(target=proxy.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{proxy.server_address[1]}"
    env = {
        **os.environ,
        "DATABASE_URL": url,
        "SHIFT_SCHEDULER_DB_URL": url,
        "AUTH_MODE": "mock",
        "PHARMSHIFT_ENV": "development",
        "AUTH_JWT_SECRET": "synthetic-publication-network-restart-only",
        "SHIFT_SCHEDULER_DATA_BACKEND": "db",
        "API_CORS_ALLOW_ORIGINS": base,
        "PHARMSHIFT_MANAGED_STORAGE": str(tmp_path),
    }
    # This test has no control-service outage; separate tests cover that gate.
    env.pop("PHARMSHIFT_CONTROL_URL", None)
    processes, streams = [], []
    result = {
        "completed": False,
        "scope": "Real HTTP publication ACK loss + API restart, not complete combined fault acceptance",
    }

    def start():
        stream = (tmp_path / f"api-{len(processes)}.log").open("x")
        streams.append(stream)
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "shift_scheduler.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(api_port),
            ],
            env=env,
            stdout=stream,
            stderr=stream,
        )
        processes.append(process)
        for _ in range(150):
            if process.poll() is not None:
                raise AssertionError("Owned API startup failed: " + stream.name)
            try:
                if httpx.get(base + "/openapi.json", timeout=0.5).status_code == 200:
                    return process
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        raise TimeoutError("Owned API readiness")

    try:
        process = start()
        with httpx.Client(base_url=base, timeout=10) as client:
            login = client.post(
                "/auth/login", json={"username": "admin", "password": "pass-admin"}
            )
            assert login.status_code == 200, login.text
            client.cookies.clear()
            client.headers.update(
                {"Authorization": "Bearer " + login.json()["access_token"]}
            )
            query = "?scope_id=hospital%2Fpharmacy"
            proposal = Proposal(
                duty_ids=("p0d0",), leave_ids=("network-leave",)
            ).model_dump(mode="json")
            draft = client.post(
                "/planning/drafts" + query,
                json={
                    "input_hash": data.input_hash,
                    "proposal": proposal,
                    "idempotency_key": "network-create-draft",
                },
            )
            assert draft.status_code == 201, draft.text
            path = "/planning/drafts/" + draft.json()["draft_id"]
            review = client.post(
                path + "/review" + query,
                json={"version": 1, "idempotency_key": "network-review"},
            )
            assert (
                review.status_code == 200 and review.json()["publishable"]
            ), review.text
            body = {
                "version": 1,
                "expected_publication_version": 0,
                "input_hash": data.input_hash,
                "review_hash": review.json()["review_hash"],
                "idempotency_key": "network-publication-ack-loss",
            }
            proxy.arm("POST " + path + "/publish?")
            with pytest.raises(httpx.RemoteProtocolError):
                client.post(path + "/publish" + query, json=body)
            assert (
                len(proxy.events) == 1 and "200" in proxy.events[0]["upstream_status"]
            )
            assert proxy.events[0]["downstream_bytes"] == 0
            # Stop this owned API after a verified database commit; no hidden
            # process-local receipt may make the retry succeed.
            process.terminate()
            process.wait(timeout=10)
            start()
            retried = client.post(path + "/publish" + query, json=body)
            assert retried.status_code == 200, retried.text
            assert (
                client.post(path + "/publish" + query, json=body).json()
                == retried.json()
            )
            changed = client.post(
                path + "/publish" + query, json={**body, "version": 2}
            )
            assert changed.status_code == 409, changed.text
            with pg() as session:
                assert (
                    session.scalar(
                        select(func.count()).select_from(PlanningPublication)
                    )
                    == 1
                )
                assert session.scalar(select(func.count()).select_from(LeaveEvent)) == 1
                assert (
                    session.scalar(
                        select(func.count())
                        .select_from(PlanningOutbox)
                        .where(PlanningOutbox.kind == "schedule.published")
                    )
                    == 1
                )
                balance = session.get(LeaveBalance, grant.grant_id)
                assert balance.amount - balance.consumed - balance.reserved == 1
            result.update(
                completed=True,
                publication_id=retried.json()["publication_id"],
                publication_rows=1,
                leave_events=1,
                publication_notifications=1,
                remaining_days=1,
                proxy_events=proxy.events,
                api_restarts=1,
            )
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
        proxy.shutdown()
        proxy.server_close()
        thread.join(timeout=5)
        for stream in streams:
            stream.close()
        output = os.getenv("PHARMSHIFT_PUBLICATION_NETWORK_EVIDENCE")
        if output:
            with Path(output).open("x") as stream:
                json.dump(result, stream, indent=2)
