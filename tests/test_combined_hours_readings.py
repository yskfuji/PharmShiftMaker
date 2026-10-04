"""L06: readings of Art. 38(1) without an official statement, and declarations.

- One employer, two sites: no official statement fixes which site's 36 agreement
  bears the overtime. Counting scheduled hours first (the rule for different
  employers, 基発0901第3号) and counting in the order worked can disagree; then
  the result is unverified for HR/legal review.
- Work on the other employer's statutory holiday is not holiday work here but is
  counted as that employer's work beyond the schedule (Q&A 問1-4-2・1-4-3).
- A person can neither change nor withdraw a reviewed declaration: the confirmed
  hours stay in the combined count (Art. 38 is mandatory) until an administrator
  corrects them.
Expected values are computed by hand in each test.
"""

from fastapi.testclient import TestClient

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade
from tests.test_outside_declaration_accounting import declared, overtime

HOUR = 3600


def one_employer_payload(specs, variable=False):
    payload = upgrade(work_fixture(specs))
    for row in [
        *payload["establishments"],
        *payload["employments"],
        *payload["agreements"],
    ]:
        row["employer_id"] = "hospital"
    if variable:
        # 28-day periods from 2025-12-15 cover the fixture week (Jan 5 - 12, 2026).
        for e in payload["employments"]:
            e.update(
                working_time_system="monthly_variable",
                variable_anchor="2025-12-15",
                variable_evidence=e["declaration"],
                variable_period_days=28,
            )
    return payload


def one_employer(specs, variable=False):
    data = parse_snapshot(one_employer_payload(specs, variable))
    return account_work(data, list(data.candidates))


def order_findings(result):
    return [f for f in result["findings"] if "sites of one employer" in f.message]


def test_readings_that_disagree_between_sites_are_referred():
    # Site A 09-15 (4h scheduled, 2h extra), site B 15-21 (6h scheduled).
    # Scheduled first: A 4h + B 6h = 10h -> B 2h, then A's extra 2h -> A 2h.
    # Order worked: A 6h, then B 6h -> B has the 4h beyond 8h.
    result = one_employer([("A", 0, 9, 6, 4), ("B", 0, 15, 6, 6)])
    assert [f.status for f in order_findings(result)] == ["unverified"]


def test_readings_that_agree_are_not_referred():
    # Day 0: A 09-19 (8h scheduled, 2h extra); day 1: B 09-13 scheduled. Both readings
    # put day 0's 2h beyond 8h on site A, so the check runs and finds no difference.
    result = one_employer([("A", 0, 9, 10, 8), ("B", 1, 9, 4, 4)])
    assert sum(r["daily_overtime_seconds"] for r in result["trace"]) == 2 * HOUR
    assert order_findings(result) == []


def test_differences_that_cancel_over_days_are_still_referred():
    # Day 0 as above (B 2h vs. 4h); day 1 mirrored (A 2h vs. 4h). The totals per site
    # over both days agree, but the daily agreement limit is per day.
    result = one_employer(
        [("A", 0, 9, 6, 4), ("B", 0, 15, 6, 6), ("B", 1, 9, 6, 4), ("A", 1, 15, 6, 6)]
    )
    assert [f.status for f in order_findings(result)] == ["unverified"]


def test_variable_hours_compare_their_own_two_readings():
    # Scheduled only (A 10h on day 0, B 4h on day 1): the variable day limit is the
    # 10h schedule, so there is no overtime and nothing to refer.
    assert (
        order_findings(
            one_employer([("A", 0, 8, 10, 10), ("B", 1, 8, 4, 4)], variable=True)
        )
        == []
    )
    # A 09-15 (4h scheduled), B 15-21 (6h scheduled): day limit 10h, 12h worked.
    # Order worked: A 6h, then B -> B's last 2h. Scheduled first: A 4h + B 6h, then
    # A's extra 2h -> A. The readings differ.
    result = one_employer([("A", 0, 9, 6, 4), ("B", 0, 15, 6, 6)], variable=True)
    assert [f.status for f in order_findings(result)] == ["unverified"]


def test_several_own_sites_with_another_employer_are_referred_when_extras_exist():
    from tests.test_outside_declaration_accounting import declared

    # Own sites A (09-15, 4h scheduled) and B, plus a reviewed other employer (20-22).
    payload = declared(
        one_employer_payload([("A", 0, 9, 6, 4), ("B", 1, 9, 4, 4)]),
        scheduled=((0, 20, 2),),
    )
    for e in payload["employments"]:
        e["contract_order"] = 2
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert [f.status for f in order_findings(result)] == ["unverified"]
    # Without extra hours at the own sites, scheduled first and order worked coincide.
    payload = declared(
        one_employer_payload([("A", 0, 9, 6, 6), ("B", 1, 9, 4, 4)]),
        scheduled=((0, 20, 2),),
    )
    for e in payload["employments"]:
        e["contract_order"] = 2
    data = parse_snapshot(payload)
    assert order_findings(account_work(data, list(data.candidates))) == []


def test_other_employers_holiday_work_is_counted_as_its_extra_hours():
    from datetime import datetime, timedelta

    from tests.test_outside_declaration_accounting import own_payload

    # Own A (contract order 2) 09-15 scheduled; the clinic (order 1) declares 20-23 on
    # its statutory holiday. As extra hours it comes after A's schedule: 6h + 3h ->
    # 1h beyond 8h at the clinic. Had it been counted as scheduled (order 1 first),
    # A's last hour would be the overtime.
    payload = declared(own_payload(hours=6), scheduled=())
    start = datetime.fromisoformat(payload["period"]["start"])
    holiday = {
        "start": (start + timedelta(hours=20)).isoformat(),
        "end": (start + timedelta(hours=23)).isoformat(),
    }
    payload["outside_declarations"][0]["other_holiday_work"] = [holiday]
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert (overtime(result, "A"), overtime(result, "other-clinic")) == (0, HOUR)
    assert not any(
        r["holiday_seconds"]
        for r in result["trace"]
        if r["employer_id"] == "other-clinic"
    )


def test_a_person_cannot_withdraw_a_reviewed_declaration(sqlite_session_factory):
    from scripts.remediation_fixture import snapshot

    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)
    evidence = snapshot().policy_evidence.model_dump(mode="json")
    reviewed = {
        "declaration_id": "outside-r",
        "person_id": "p1",
        "employer_id": "outside",
        "establishment_id": "outside-site",
        "contract_order": 1,
        "reference": "synthetic statement",
        "start": "2026-01-01T00:00:00+09:00",
        "end": "2027-01-01T00:00:00+09:00",
        "status": "REVIEWED",
        "work_report_complete": True,
        "review_evidence": evidence,
    }
    withdrawn = dict(reviewed, status="WITHDRAWN", review_evidence=None)
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        assert (
            client.post(
                BASE + "/outside-declarations" + QUERY,
                headers=admin,
                json={
                    "expected_revision": 0,
                    "idempotency_key": "review-outside-r",
                    "payload": reviewed,
                },
            ).status_code
            == 200
        )
        staff = token(client, "pharmacist")
        refused = client.post(
            BASE + "/outside-declarations" + QUERY,
            headers=staff,
            json={
                "expected_revision": 1,
                "idempotency_key": "self-withdraw-r",
                "payload": withdrawn,
            },
        )
        assert (
            refused.status_code == 422
            and "本人では変更・取り下げできません" in refused.text
        )
        # Nor in two steps: resubmitting as SUBMITTED (then withdrawing) is refused too.
        resubmitted = dict(reviewed, status="SUBMITTED", review_evidence=None)
        refused = client.post(
            BASE + "/outside-declarations" + QUERY,
            headers=staff,
            json={
                "expected_revision": 1,
                "idempotency_key": "self-resubmit-r",
                "payload": resubmitted,
            },
        )
        assert (
            refused.status_code == 422
            and "本人では変更・取り下げできません" in refused.text
        )
        admin = token(client)
        assert (
            client.post(
                BASE + "/outside-declarations" + QUERY,
                headers=admin,
                json={
                    "expected_revision": 1,
                    "idempotency_key": "admin-withdraw-r",
                    "payload": withdrawn,
                },
            ).status_code
            == 200
        )


def test_two_employers_with_several_sites_each_are_referred_when_extras_exist():
    # h1 has sites A, B (contract order 1); h2 has sites C, D (order 2). A has 2h of
    # extra work. Ordering across both employers by time would ignore the order
    # between employers (基発0901第3号), so the alternative reading is not computed.
    payload = upgrade(
        work_fixture(
            [
                ("A", 0, 9, 6, 4),
                ("B", 1, 9, 4, 4),
                ("C", 0, 16, 3, 3),
                ("D", 2, 9, 4, 4),
            ],
            orders=(1, 1, 2, 2),
        )
    )
    owner = {"A": "h1", "B": "h1", "C": "h2", "D": "h2"}
    for row in [
        *payload["establishments"],
        *payload["employments"],
        *payload["agreements"],
    ]:
        letter = row["employer_id"]
        row["employer_id"] = owner[letter]
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert [f.message.split(" alongside")[0] for f in order_findings(result)] == [
        "Overtime attribution between the sites of one employer"
    ]
