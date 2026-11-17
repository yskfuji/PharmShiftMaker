"""L06: a verified HR/legal decision selects how overtime is attributed between the
sites of one employer, so the person can be planned and published again.

Without a decision, differing readings stay "unverified" (tests/test_combined_hours_readings.py).
Fixture day 0: site A 09-15 (4h scheduled, 2h extra), site B 15-21 (6h scheduled).
- Scheduled first: A 4h + B 6h = 10h -> B's last 2h, then A's extra 2h -> A 2h.
- Order worked: A 6h, then B 6h -> the 8h are reached at B 17:00 -> B 4h.
Expected values are computed by hand.
"""

import pytest
from fastapi.testclient import TestClient

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_combined_hours_readings import one_employer_payload, order_findings
from tests.test_outside_declaration_accounting import declared

HOUR = 3600
SPECS = [("A", 0, 9, 6, 4), ("B", 0, 15, 6, 6)]


def decision(payload, reading, **change):
    return {
        "decision_id": "site-order-1",
        "employer_id": "hospital",
        "reading": reading,
        "reason": "synthetic HR/legal decision",
        "start": payload["context"]["start"],
        "end": payload["context"]["end"],
        "evidence": payload["policy_evidence"],
        **change,
    }


def run(payload):
    data = parse_snapshot(payload)
    return account_work(data, list(data.candidates))


def by_site(result):
    totals = {}
    for r in result["trace"]:
        totals[r["establishment_id"]] = (
            totals.get(r["establishment_id"], 0) + r["daily_overtime_seconds"]
        )
    return totals


@pytest.mark.parametrize(
    ("reading", "expected"),
    [
        ("scheduled_first", {"site-A": 2 * HOUR, "site-B": 2 * HOUR}),
        ("time_order", {"site-A": 0, "site-B": 4 * HOUR}),
    ],
)
def test_a_verified_decision_selects_the_reading(reading, expected):
    payload = one_employer_payload(SPECS)
    payload["site_attribution_decisions"] = [decision(payload, reading)]
    result = run(payload)
    assert order_findings(result) == []
    assert by_site(result) == expected
    assert {r.get("site_attribution_decision") for r in result["trace"]} == {
        "site-order-1"
    }


def test_a_variable_hours_decision_selects_its_own_reading():
    # Variable hours (28-day periods): day limit is the 10h schedule; 12h worked.
    # Scheduled first puts the 2h on A's extra hours; order worked on B's last 2h.
    payload = one_employer_payload(SPECS, variable=True)
    payload["site_attribution_decisions"] = [decision(payload, "scheduled_first")]
    result = run(payload)
    assert order_findings(result) == []
    assert by_site(result) == {"site-A": 2 * HOUR, "site-B": 0}


@pytest.mark.parametrize(
    "change",
    [
        {"evidence": {"reference": "draft", "status": "unverified"}},  # not verified
        {"end": "2026-01-05T12:00:00+09:00"},  # ends during the work
        {
            "evidence": {
                "reference": "r",
                "status": "verified",
                "verified_by": "HR",
                "valid_until": "2026-01-06T00:00:00+09:00",
            }
        },  # expired before the horizon
    ],
)
def test_a_decision_that_is_unverified_or_does_not_cover_the_work_changes_nothing(
    change,
):
    payload = one_employer_payload(SPECS)
    payload["site_attribution_decisions"] = [decision(payload, "time_order", **change)]
    result = run(payload)
    assert [f.status for f in order_findings(result)] == ["unverified"]
    assert "site_attribution_decision" not in result["trace"][0]


def test_with_another_employer_only_scheduled_first_can_be_decided():
    def with_other(reading):
        payload = declared(
            one_employer_payload([("A", 0, 9, 6, 4), ("B", 1, 9, 4, 4)]),
            scheduled=((0, 20, 2),),
        )
        for e in payload["employments"]:
            e["contract_order"] = 2
        payload["site_attribution_decisions"] = [decision(payload, reading)]
        return run(payload)

    assert order_findings(with_other("scheduled_first")) == []
    unsupported = [
        f for f in with_other("time_order")["findings"] if "not supported" in f.message
    ]
    assert [f.status for f in unsupported] == ["unsupported"]


@pytest.mark.parametrize(
    "change",
    [
        {"employer_id": "unknown-employer"},
        {"reading": "latest_first"},
    ],
)
def test_invalid_decisions_are_refused(change):
    payload = one_employer_payload(SPECS)
    payload["site_attribution_decisions"] = [
        {**decision(payload, "time_order"), **change}
    ]
    with pytest.raises(ValueError):
        parse_snapshot(payload)


def test_overlapping_decisions_of_one_employer_are_refused():
    payload = one_employer_payload(SPECS)
    payload["site_attribution_decisions"] = [
        decision(payload, "time_order"),
        decision(payload, "scheduled_first", decision_id="site-order-2"),
    ]
    with pytest.raises(ValueError, match="must not overlap"):
        parse_snapshot(payload)


def test_the_stored_form_without_decisions_is_unchanged():
    payload = one_employer_payload(SPECS)
    assert "site_attribution_decisions" not in parse_snapshot(payload).model_dump(
        mode="json"
    )


def test_the_decision_is_saved_through_the_records_api(sqlite_session_factory):
    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        context = client.get(BASE + "/workflow-context" + QUERY, headers=admin).json()
        employer = context["establishments"][0]["employer_id"]
        evidence = {
            "reference": "synthetic HR/legal decision",
            "status": "verified",
            "verified_by": "HR",
        }
        body = {
            "decision_id": "d1",
            "employer_id": employer,
            "reading": "time_order",
            "reason": "synthetic",
            "start": "2026-01-01T00:00:00+09:00",
            "end": "2027-01-01T00:00:00+09:00",
            "evidence": evidence,
        }
        saved = client.post(
            BASE + "/records/site_attribution_decision" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "site-decision-1",
                "payload": body,
            },
        )
        assert saved.status_code == 200, saved.text
        staff = token(client, "pharmacist")
        refused = client.post(
            BASE + "/records/site_attribution_decision" + QUERY,
            headers=staff,
            json={
                "expected_revision": 1,
                "idempotency_key": "site-decision-2",
                "payload": body,
            },
        )
        assert refused.status_code == 403
        context = client.get(BASE + "/workflow-context" + QUERY, headers=admin).json()
        assert [d["decision_id"] for d in context["site_attribution_decisions"]] == [
            "d1"
        ]


def test_an_order_worked_decision_does_not_block_scheduled_only_work_next_to_another_employer():
    payload = declared(
        one_employer_payload([("A", 0, 9, 4, 4), ("B", 1, 9, 4, 4)]),
        scheduled=((0, 20, 2),),
    )
    for e in payload["employments"]:
        e["contract_order"] = 2
    payload["site_attribution_decisions"] = [decision(payload, "time_order")]
    assert [
        f.message for f in run(payload)["findings"] if "not supported" in f.message
    ] == []
