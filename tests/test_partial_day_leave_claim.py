"""The person's own half-day and hourly leave claim (use case U28; SQLite).

The claim screen offers the units the person's registered leave rule allows; it
reads them from `GET /planning/compliance/records`, which gives a pharmacist
their own rules. These tests pin what that screen and its browser journey rely
on: the fixture flag that registers such rules, and what the claim route
answers for the requests the journey sends.
"""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def claim(key: str, **over) -> dict:
    payload = {
        "account_id": "g1",
        "policy_id": "lp1",
        "unit": "hour",
        "quantity": 2,
        "interval": {
            "start": "2026-01-06T13:00:00+09:00",
            "end": "2026-01-06T15:00:00+09:00",
        },
        "reference": "synthetic claim",
    }
    return {
        "expected_revision": 0,
        "idempotency_key": key,
        "payload": payload | over,
    }


def own_rule(client) -> dict:
    rows = client.get(
        BASE + "/records" + QUERY, headers=token(client, "pharmacist")
    ).json()
    rules = [row for row in rows if row["kind"] == "leave_policy"]
    # A pharmacist is given their own rule only.
    assert [row["entity_id"] for row in rules] == ["lp1"]
    return rules[0]["payload"]


def test_default_fixture_rules_allow_whole_days_only(sqlite_session_factory):
    assert snapshot() == snapshot(with_partial_day_leave=False)
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        rule = own_rule(client)
    assert (rule["hourly_enabled"], rule["half_day_enabled"]) == (False, False)


def test_flagged_fixture_rules_allow_half_days_and_hours(sqlite_session_factory):
    flagged = snapshot(with_partial_day_leave=True)
    assert flagged.input_hash != snapshot().input_hash
    assert all(p.hourly_enabled and p.half_day_enabled for p in flagged.leave_policies)
    prepare(sqlite_session_factory, flagged)
    with TestClient(app, base_url="https://localhost:8000") as client:
        rule = own_rule(client)
        assert (rule["hourly_enabled"], rule["half_day_enabled"]) == (True, True)


def test_claim_route_answers_the_requests_of_the_journey(sqlite_session_factory):
    prepare(sqlite_session_factory, snapshot(with_partial_day_leave=True))
    with TestClient(app, base_url="https://localhost:8000") as client:
        staff = token(client, "pharmacist")
        url = BASE + "/leave-requests" + QUERY
        # A span that runs backwards is refused with the model's message.
        backwards = client.post(
            url,
            headers=staff,
            json=claim(
                "claim-backwards",
                interval={
                    "start": "2026-01-06T15:00:00+09:00",
                    "end": "2026-01-06T13:00:00+09:00",
                },
            ),
        )
        assert backwards.status_code == 422
        assert (
            "Use a positive half-open interval with whole-second precision"
            in backwards.json()["detail"]
        )
        # Another person's grant is refused.
        other = client.post(
            url, headers=staff, json=claim("claim-other", account_id="g0")
        )
        assert other.status_code == 403
        assert other.json()["detail"] == "本人の年休付与だけを請求できます。"
        # An hourly and a half-day claim are recorded as awaiting confirmation; the
        # same request sent again is answered from its receipt.
        hourly = client.post(url, headers=staff, json=claim("claim-hourly"))
        assert hourly.status_code == 200, hourly.text
        again = client.post(url, headers=staff, json=claim("claim-hourly"))
        assert again.json() == hourly.json()
        assert hourly.json()["status"] == "PENDING" and hourly.json()["version"] == 1
        half = client.post(
            url,
            headers=staff,
            json=claim("claim-half", unit="half_day", quantity=1),
        )
        assert half.status_code == 200, half.text
        rows = client.get("/planning/requests" + QUERY, headers=staff).json()
        assert sorted(
            (row["kind"], row["payload"]["unit"], row["payload"]["quantity"])
            for row in rows
        ) == [("PAID_LEAVE_V2", "half_day", 1), ("PAID_LEAVE_V2", "hour", 2)]
        # A planner is given the claims with their units.
        seen = client.get("/planning/requests" + QUERY, headers=token(client)).json()
        assert {row["payload"]["unit"] for row in seen} == {"half_day", "hour"}
