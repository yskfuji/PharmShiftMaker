"""The declaration listing says what the declaration route answers (SQLite).

`GET /planning/compliance/declaration-context` adds `actions.change` to every
declaration: whether this viewer may correct or withdraw the stored version, and
the route's own refusal when not. Each case sends the real correction and the
real withdrawal and compares their outcome with the listing.
"""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare

STATUSES = ("SUBMITTED", "REVIEWED", "RETURNED", "WITHDRAWN")
EVIDENCE = {
    "reference": "synthetic comparison",
    "status": "verified",
    "verified_by": None,
    "valid_until": None,
}


def declaration(identity: str) -> dict:
    return {
        "declaration_id": identity,
        "person_id": "p1",
        "employer_id": "outside",
        "establishment_id": "outside-site",
        "contract_order": 1,
        "activity": "employment",
        "reference": "synthetic statement",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2027-01-01T00:00:00+09:00",
        "status": "SUBMITTED",
        "work_report_complete": True,
        "scheduled_work": [],
        "additional_work": [],
        "review_evidence": None,
    }


def post(client, headers, payload, expected, key):
    return client.post(
        BASE + "/outside-declarations" + QUERY,
        headers=headers,
        json={
            "expected_revision": expected,
            "idempotency_key": key,
            "payload": payload,
        },
    )


def store(client, identity: str, status: str) -> None:
    """One declaration of p1, brought to `status` by the people who may do so."""
    base = declaration(identity)
    saved = post(client, token(client, "pharmacist"), base, 0, f"{identity}-submit")
    assert saved.status_code == 200, saved.text
    if status == "SUBMITTED":
        return
    if status == "WITHDRAWN":
        changed = post(
            client,
            token(client, "pharmacist"),
            base | {"status": "WITHDRAWN"},
            1,
            f"{identity}-withdraw",
        )
    else:
        changed = post(
            client,
            token(client),
            base | {"status": status, "review_evidence": EVIDENCE},
            1,
            f"{identity}-{status}",
        )
    assert changed.status_code == 200, changed.text


def listed(client, headers, identity: str) -> dict:
    context = client.get(BASE + "/declaration-context" + QUERY, headers=headers)
    assert context.status_code == 200, context.text
    return next(
        row for row in context.json()["declarations"] if row["entity_id"] == identity
    )


@pytest.mark.parametrize("who", ["pharmacist", "admin"])
@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("change", ["correct", "withdraw"])
def test_listed_change_is_what_the_route_answers(
    sqlite_session_factory, who, status, change
):
    prepare(sqlite_session_factory)
    identity = f"outside-{status.lower()}-{change}"
    with TestClient(app, base_url="https://localhost:8000") as client:
        store(client, identity, status)
        headers = token(client, who)
        row = listed(client, headers, identity)
        action = row["actions"]["change"]
        # The stored fields of the listing are unchanged by the addition.
        assert set(row) == {"entity_id", "revision", "payload", "actions"}
        assert row["payload"]["status"] == status
        if change == "correct":
            payload = row["payload"] | {
                "status": "SUBMITTED",
                "review_evidence": None,
                "reference": "corrected statement",
            }
        else:
            payload = row["payload"] | {"status": "WITHDRAWN", "review_evidence": None}
        answer = post(client, headers, payload, row["revision"], f"{identity}-{who}")
        assert action["allowed"] is (answer.status_code == 200), answer.text
        if action["allowed"]:
            assert action["refusal"] is None
        else:
            assert answer.status_code == 422
            assert answer.json()["detail"] == action["refusal"]
    # The only refusal by stored state: the person and a reviewed declaration.
    assert action["allowed"] is not (who == "pharmacist" and status == "REVIEWED")


def test_a_pharmacist_is_listed_only_their_own_declarations(sqlite_session_factory):
    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        other = declaration("outside-other") | {"person_id": "p0"}
        saved = post(client, token(client), other, 0, "outside-other-admin")
        assert saved.status_code == 200, saved.text
        store(client, "outside-own", "SUBMITTED")
        mine = client.get(
            BASE + "/declaration-context" + QUERY, headers=token(client, "pharmacist")
        ).json()["declarations"]
        assert [row["entity_id"] for row in mine] == ["outside-own"]
        everyone = client.get(
            BASE + "/declaration-context" + QUERY, headers=token(client)
        ).json()["declarations"]
        assert {row["entity_id"] for row in everyone} == {
            "outside-other",
            "outside-own",
        }
        assert all(row["actions"]["change"]["allowed"] for row in everyone)
