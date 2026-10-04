"""True concurrency on PostgreSQL: leave requests racing through the public API.

Two clients start together (a barrier) and post leave events that only one of
them may win. Each repetition uses a fresh schema. The earlier SQLite test ran
the same requests one after the other; this one lets the database decide.
"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import ComplianceEntity
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare
from tests.test_planning_postgres import pg as _pg

pg = _pg
EVIDENCE = {
    "reference": "hr",
    "status": "verified",
    "verified_by": "hr",
    "valid_until": None,
}
REPETITIONS = range(5)


def event(event_id, account, day, policy="lp0"):
    return {
        "event_id": event_id,
        "account_id": account,
        "kind": "reserve",
        "unit": "day",
        "quantity": 1,
        "effective_on": day,
        "policy_id": policy,
        "evidence": EVIDENCE,
        "interval": {"start": f"{day}T09:00:00+09:00", "end": f"{day}T17:00:00+09:00"},
    }


def post(client, headers, payload, revision, key):
    return client.post(
        BASE + "/leave-events" + QUERY,
        headers=headers,
        json={
            "expected_revision": revision,
            "idempotency_key": key,
            "payload": payload,
        },
    )


def race(requests):
    """Send each (payload, revision, key) from its own client at the same moment."""
    barrier = Barrier(len(requests))

    def send(request):
        with TestClient(app, base_url="https://localhost:8000") as client:
            headers = token(client)
            barrier.wait()
            response = post(client, headers, *request)
            return response.status_code, response.text

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        return list(pool.map(send, requests))


@pytest.fixture
def api(pg, monkeypatch):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    prepare(pg, snapshot(with_grant_series=True))
    return pg


def reserves(factory, account):
    with factory() as session:
        return [
            r.payload
            for r in session.scalars(
                select(ComplianceEntity).where(ComplianceEntity.kind == "leave_record")
            )
            if r.payload["account_id"] == account
        ]


@pytest.mark.parametrize("repetition", REPETITIONS)
def test_two_requests_for_the_last_day_have_one_winner(api, repetition):
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        for i in range(4):  # g0 grants 5 days; leave one
            day = f"2026-03-0{i + 2}"
            assert (
                post(
                    client, admin, event(f"r{i}", "g0", day), i + 1, f"reserve-{i}"
                ).status_code
                == 200
            )
    results = race(
        [
            (event("first", "g0", "2026-03-09"), 5, "race-first"),
            (event("second", "g0", "2026-03-10"), 5, "race-second"),
        ]
    )
    codes = sorted(code for code, _ in results)
    assert codes[0] == 200 and codes[1] in (409, 422), results
    assert len(reserves(api, "g0")) == 5  # exactly the granted days, never six


@pytest.mark.parametrize("repetition", REPETITIONS)
def test_same_person_same_day_on_two_accounts_has_one_winner(api, repetition):
    # Two accounts of one person (a split grant series): the per-account row lock
    # alone would let both commit; the facility lock of the API serialises them.
    results = race(
        [
            (event("split-a", "split-first", "2026-03-02"), 1, "race-split-a"),
            (event("split-b", "split-second", "2026-03-02"), 1, "race-split-b"),
        ]
    )
    codes = sorted(code for code, _ in results)
    assert codes[0] == 200 and codes[1] in (409, 422), results
    assert len(reserves(api, "split-first")) + len(reserves(api, "split-second")) == 1


@pytest.mark.parametrize("repetition", REPETITIONS)
def test_same_request_sent_twice_at_once_is_recorded_once(api, repetition):
    # A retried request (same idempotency key and contents) racing its original.
    request = (event("retry", "g1", "2026-03-02", policy="lp1"), 1, "same-key")
    results = race([request, request])
    assert [code for code, _ in results] == [200, 200], results
    assert results[0][1] == results[1][1]
    assert len(reserves(api, "g1")) == 1
