"""L06: other employers' declared work in the combined accounting (no database).

Rules (基発0901第3号, Labour Standards Act Art. 38): scheduled hours are counted in
contract order across employers, then extra hours in the order they occur; each
employer's own 36 agreement covers the overtime at its own establishment. Only a
REVIEWED declaration counts; one still SUBMITTED or RETURNED makes the result
unverified. Within one employer the sites have no contract order, so scheduled
hours follow the time worked (an interpretation recorded for HR/legal review).
Expected values are computed by hand in each test.
"""

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade

HOUR = 3600


def declared(
    payload,
    *,
    status="REVIEWED",
    order=1,
    scheduled=((0, 20, 4),),
    additional=(),
    activity="employment",
):
    """scheduled/additional: (day offset, start hour, hours) in the fixture period."""
    from datetime import datetime, timedelta

    start = datetime.fromisoformat(payload["period"]["start"])

    def interval(day, hour, hours):
        begin = start + timedelta(days=day, hours=hour)
        return {
            "start": begin.isoformat(),
            "end": (begin + timedelta(hours=hours)).isoformat(),
        }

    evidence = payload["policy_evidence"]
    declaration = {
        "declaration_id": f"outside-{status.lower()}",
        "person_id": "p0",
        "employer_id": "other-clinic",
        "establishment_id": "other-site",
        "contract_order": order,
        "activity": activity,
        "start": payload["context"]["start"],
        "end": payload["context"]["end"],
        "scheduled_work": [interval(*s) for s in scheduled],
        "additional_work": [interval(*a) for a in additional],
        "work_report_complete": status == "REVIEWED" or activity != "employment",
        "reference": "declared by the person",
        "status": status,
        "review_evidence": evidence if status == "REVIEWED" else None,
    }
    payload.setdefault("outside_declarations", []).append(declaration)
    return payload


def account(payload):
    data = parse_snapshot(payload)
    return account_work(data, list(data.candidates))


def own_payload(hour=9, hours=6, order=2):
    """p0 works for employer A only (contract order `order`), day 0, `hours` scheduled."""
    return upgrade(work_fixture([("A", 0, hour, hours, hours)], orders=(order,)))


def overtime(result, employer):
    return sum(
        r["daily_overtime_seconds"]
        for r in result["trace"]
        if r["employer_id"] == employer
    )


def test_reviewed_earlier_contract_pushes_own_hours_into_overtime():
    # Other clinic (contract order 1) 4h + own A (order 2) 6h = 10h: A's last 2h are overtime.
    assert overtime(account(own_payload()), "A") == 0
    result = account(declared(own_payload()))
    assert overtime(result, "A") == 2 * HOUR
    assert overtime(result, "other-clinic") == 0
    assert not [
        f
        for f in result["findings"]
        if f.status != "violation" and "outside" in f.message.lower()
    ]


def test_other_employers_overtime_is_theirs_and_needs_no_own_agreement():
    # Own A is first (order 1) with 8h; the clinic (order 2) adds 2h: those 2h are the clinic's.
    payload = declared(own_payload(hours=8, order=1), order=2, scheduled=((0, 18, 2),))
    result = account(payload)
    assert overtime(result, "A") == 0 and overtime(result, "other-clinic") == 2 * HOUR
    assert not [
        f
        for f in result["findings"]
        if "lacks an effective employer agreement" in f.message
    ]
    # The combined monthly total (100h/80h check) includes the clinic's overtime,
    # while the site total of A's own agreement does not.
    month = next(t for t in result["agreement_totals"] if t["agreement_id"] == "36-A")[
        "months"
    ][0]
    assert (
        month["site_overtime_seconds"],
        month["combined_overtime_holiday_seconds"],
    ) == (0, 2 * HOUR)


def test_unreviewed_declaration_makes_the_result_unverified_and_is_not_counted():
    for status in ("SUBMITTED", "RETURNED"):
        result = account(declared(own_payload(), status=status))
        assert overtime(result, "A") == 0
        assert [
            f
            for f in result["findings"]
            if f.status == "unverified" and "not reviewed" in f.message
        ] != []


def test_withdrawn_declaration_is_ignored():
    result = account(declared(own_payload(), status="WITHDRAWN"))
    assert overtime(result, "A") == 0
    assert not [f for f in result["findings"] if "declaration" in f.message.lower()]


def test_reviewed_employment_without_contract_order_is_unverified():
    result = account(declared(own_payload(), order=None))
    assert overtime(result, "A") == 0
    assert [f for f in result["findings"] if "lacks the contract order" in f.message]


def test_declared_nonemployment_is_not_working_time():
    result = account(declared(own_payload(), activity="nonemployment"))
    assert overtime(result, "A") == 0


def test_same_employer_sites_count_scheduled_hours_in_time_order():
    # One employer, two sites: site-B (order 2) 07-11 then site-A (order 1) 13-19.
    # In time order the 8h are reached at 17:00 on site-A, so site-A has the 2h overtime.
    payload = upgrade(work_fixture([("A", 0, 13, 6, 6), ("B", 0, 7, 4, 4)]))
    for row in [
        *payload["establishments"],
        *payload["employments"],
        *payload["agreements"],
    ]:
        row["employer_id"] = "hospital"
    result = account(payload)
    by_site = {}
    for r in result["trace"]:
        by_site[r["establishment_id"]] = (
            by_site.get(r["establishment_id"], 0) + r["daily_overtime_seconds"]
        )
    assert by_site == {"site-A": 2 * HOUR, "site-B": 0}


def test_generic_record_route_refuses_declarations_and_work_terms(
    sqlite_session_factory,
):
    from fastapi.testclient import TestClient

    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        for kind in ("outside_declaration", "work_terms"):
            response = client.post(
                BASE + "/records/" + kind + QUERY,
                headers=admin,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "generic-" + kind,
                    "payload": {},
                },
            )
            assert response.status_code == 422 and "専用操作" in response.text


def test_an_input_cannot_create_an_outside_declaration(sqlite_session_factory):
    import pytest
    from scripts.remediation_fixture import snapshot

    from shift_scheduler.application.planning import Conflict
    from tests.test_compliance_v3_api import prepare

    payload = snapshot().model_dump(mode="json")
    declared(payload)
    payload["outside_declarations"][0]["contract_order"] = 2
    with pytest.raises(Conflict, match="declaration workflow"):
        prepare(sqlite_session_factory, parse_snapshot(payload))


# --- review follow-ups ----------------------------------------------------------------


def test_equal_or_interleaving_contract_orders_are_unverified():
    # Own A has order 1 and the clinic declares order 1 too: nobody is "first".
    result = account(declared(own_payload(order=1), order=1))
    assert [
        f
        for f in result["findings"]
        if "equal or interleave" in f.message and f.status == "unverified"
    ]
    # A's two contracts (orders 1 and 3) around the clinic's order 2 interleave.
    payload = upgrade(
        work_fixture([("A", 0, 8, 4, 4), ("B", 0, 13, 4, 4)], orders=(1, 3))
    )
    for row in [
        *payload["establishments"],
        *payload["employments"],
        *payload["agreements"],
    ]:
        row["employer_id"] = "X"
    result = account(declared(payload, order=2, scheduled=((0, 18, 3),)))
    assert [f for f in result["findings"] if "equal or interleave" in f.message]


def test_declaration_outside_the_checked_period_is_ignored():
    payload = declared(own_payload(), status="SUBMITTED")
    payload["outside_declarations"][0].update(
        start="2020-01-01T00:00:00+09:00",
        end="2020-02-01T00:00:00+09:00",
        scheduled_work=[],
        additional_work=[],
    )
    assert not [f for f in account(payload)["findings"] if "not reviewed" in f.message]


def test_expired_review_is_not_counted_and_is_referred():
    payload = declared(own_payload())
    payload["outside_declarations"][0]["review_evidence"] = dict(
        payload["policy_evidence"], valid_until="2020-01-01T00:00:00+09:00"
    )
    result = account(payload)
    assert overtime(result, "A") == 0
    assert [f for f in result["findings"] if "expired or is unverified" in f.message]


def test_declaring_the_own_employer_is_referred():
    payload = declared(own_payload())
    payload["outside_declarations"][0]["employer_id"] = "A"
    assert [f for f in account(payload)["findings"] if "own employer" in f.message]


def test_a_declaration_stored_in_another_department_does_not_block_registration(
    sqlite_session_factory,
):
    from scripts.remediation_fixture import snapshot

    from shift_scheduler.application.compliance import save_entity
    from shift_scheduler.domain.compliance_v3 import OutsideDeclaration
    from tests.test_compliance_v3_api import prepare

    payload = snapshot().model_dump(mode="json")
    declared(payload)
    stored = OutsideDeclaration.model_validate(
        dict(payload["outside_declarations"][0], contract_order=2)
    )
    payload["outside_declarations"] = [stored.model_dump(mode="json")]
    with sqlite_session_factory.begin() as session:
        save_entity(
            session,
            "hospital/other-department",
            "outside_declaration",
            stored.model_dump(mode="json"),
            0,
            "admin",
        )
    prepare(sqlite_session_factory, parse_snapshot(payload))  # no Conflict
