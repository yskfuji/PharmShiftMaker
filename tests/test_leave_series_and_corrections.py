"""L04: grant series, duplicate base dates and grant-correction chains (no database).

Expected outcomes are stated by hand from the rules, not derived from the code:
- one person/employer has one statutory base date per grant cycle; two
  independent statutory grants on one date would count entitlement twice;
- consolidation merges two *different* base dates less than a year apart;
- grant corrections are replayed from their own effective dates, so a later
  revision that takes effect earlier cannot be applied without HR consolidating it.
"""

from datetime import date, datetime, timedelta

import pytest

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import LeaveObligationV3
from shift_scheduler.validation.leave_accounting import account_leave
from shift_scheduler.validation.leave_obligations import obligation_window
from tests.test_compliance_v2 import leave_event
from tests.test_leave_chronology import fixture
from tests.test_leave_obligations_v3 import EV, grant


def payload(takes=9):
    """Account g: 10 statutory days granted 2026-01-01; `takes` whole days in January."""
    p = fixture([])
    p["leave_records"] = [
        r for r in p["leave_records"] if r["event_id"] != "conversion"
    ]
    p["ledger_recordings"] = [
        r for r in p["ledger_recordings"] if r["object_id"] != "conversion"
    ]
    p["leave_policies"] = p["leave_policies"][:1]
    p["leave_policies"][0]["end"] = "2027-01-01T00:00:00+09:00"
    for i in range(takes):
        day = date(2026, 1, 6) + timedelta(days=i)
        add_event(
            p,
            dict(
                leave_event(f"t{i}"),
                effective_on=day.isoformat(),
                interval={
                    "start": f"{day}T09:00:00+09:00",
                    "end": f"{day}T17:00:00+09:00",
                },
            ),
            f"{day}T18:00:00+09:00",
        )
    return p


def add_event(p, event, recorded_at):
    p["leave_records"].append(event)
    p["ledger_recordings"].append(
        {
            "recording_id": "rec-" + event["event_id"],
            "object_kind": "leave_record",
            "object_id": event["event_id"],
            "external_event_id": "hr:" + event["event_id"],
            "external_revision": 1,
            "recorded_at": recorded_at,
            "evidence": p["policy_evidence"],
        }
    )


def corrections(p, *chain):
    """chain: (revision, effective_on, recorded_at date, days)."""
    p["grant_amendments"] = [
        {
            "amendment_id": f"R{revision}",
            "person_id": "p0",
            "account_id": "g",
            "external_event_id": "hr:g",
            "external_revision": revision,
            "supersedes_revision": revision - 1,
            "effective_on": effective,
            "recorded_at": f"{recorded}T12:00:00+09:00",
            "granted_days": days,
            "statutory_days": days,
            "reason": "HR correction",
            "evidence": p["policy_evidence"],
        }
        for revision, effective, recorded, days in chain
    ]
    return p


def messages(p, as_of=date(2026, 12, 31), **kwargs):
    return [
        (f.message, f.subjects)
        for f in account_leave(parse_snapshot(p), as_of, **kwargs)["findings"]
    ]


def remaining(p, as_of, **kwargs):
    report = account_leave(parse_snapshot(p), as_of, **kwargs)
    balance = next(b for b in report["balances"] if b["account_id"] == "g")[
        "remaining_days"
    ]
    return balance["numerator"] / balance["denominator"]


# --- duplicate base dates -------------------------------------------------------


def add_account(p, identity, granted_on="2026-01-01", cycle=None, days=10):
    account = dict(
        p["leave_accounts"][0],
        account_id=identity,
        granted_on=granted_on,
        expires_on="2028-06-01",
        statutory_days=days,
        granted_days=days,
        grant_cycle_id=cycle,
    )
    p["leave_accounts"].append(account)
    p["ledger_recordings"].append(
        {
            "recording_id": "rec-" + identity,
            "object_kind": "leave_account",
            "object_id": identity,
            "external_event_id": "hr:" + identity,
            "external_revision": 1,
            "recorded_at": f"{granted_on}T00:00:00+09:00",
            "evidence": p["policy_evidence"],
        }
    )
    p["leave_obligations"][0]["qualifying_grant_ids"].append(identity)
    return p


def duplicates(p):
    return {
        s
        for m, subjects in messages(p)
        if "Duplicate statutory grant base date" in m
        for s in subjects
    }


def test_two_independent_statutory_grants_on_one_date_are_flagged():
    assert duplicates(add_account(payload(0), "g2")) == {"g", "g2"}


def test_one_documented_grant_cycle_on_one_date_is_not_a_duplicate():
    p = payload(0)
    p["leave_accounts"][0]["grant_cycle_id"] = "cycle"
    assert duplicates(add_account(p, "g2", cycle="cycle", days=3)) == set()


def test_grants_on_different_dates_are_not_duplicates():
    assert duplicates(add_account(payload(0), "g2", granted_on="2026-07-01")) == set()


def test_consolidation_needs_two_different_basis_dates():
    obligation = LeaveObligationV3(
        obligation_id="w",
        person_id="p0",
        employer_id="hospital",
        start="2026-04-01",
        end="2027-04-01",
        qualifying_grant_ids=("a", "b"),
        evidence=EV,
        method="consolidated",
    )
    until = datetime.fromisoformat("2027-04-01T00:00:00+09:00")
    with pytest.raises(ValueError, match="two different qualifying basis dates"):
        obligation_window(
            obligation, [grant("a", "2026-04-01"), grant("b", "2026-04-01")], until
        )


def test_consolidation_boundary_twelve_months_apart_is_not_overlapping():
    # The second base date exactly 12 months later starts the next year: no overlap.
    obligation = LeaveObligationV3(
        obligation_id="w",
        person_id="p0",
        employer_id="hospital",
        start="2026-04-01",
        end="2028-04-01",
        qualifying_grant_ids=("a", "b"),
        evidence=EV,
        method="consolidated",
    )
    with pytest.raises(ValueError, match="overlapping obligation years"):
        obligation_window(
            obligation,
            [grant("a", "2026-04-01"), grant("b", "2027-04-01")],
            datetime.fromisoformat("2028-04-01T00:00:00+09:00"),
        )


def test_three_basis_dates_cannot_be_consolidated():
    obligation = LeaveObligationV3(
        obligation_id="w",
        person_id="p0",
        employer_id="hospital",
        start="2026-04-01",
        end="2027-10-01",
        qualifying_grant_ids=("a", "b", "c"),
        evidence=EV,
        method="consolidated",
    )
    grants = [
        grant("a", "2026-04-01"),
        grant("b", "2026-07-01"),
        grant("c", "2026-10-01"),
    ]
    with pytest.raises(ValueError, match="two verified qualifying basis dates"):
        obligation_window(
            obligation, grants, datetime.fromisoformat("2027-10-01T00:00:00+09:00")
        )


def test_split_advance_needs_one_documented_cycle():
    obligation = LeaveObligationV3(
        obligation_id="w",
        person_id="p0",
        employer_id="hospital",
        start="2026-10-01",
        end="2027-10-01",
        qualifying_grant_ids=("a",),
        evidence=EV,
        method="split_advance",
    )
    with pytest.raises(ValueError, match="Split-advance credit requires"):
        obligation_window(
            obligation,
            [grant("a", "2026-10-01")],
            datetime.fromisoformat("2027-10-01T00:00:00+09:00"),
        )


# --- findings that had no test ---------------------------------------------------


def test_split_cycle_without_a_window_and_overlapping_windows_are_reported():
    p = payload(0)
    p["leave_accounts"][0]["grant_cycle_id"] = "cycle"
    p["leave_obligations"] = []
    found = [m for m, _ in messages(p)]
    assert (
        "Split qualifying grant cycle lacks a consolidated obligation window" in found
    )
    p = payload(0)
    second = dict(p["leave_obligations"][0], obligation_id="again")
    p["leave_obligations"].append(second)
    assert any("Overlapping obligation windows" in m for m, _ in messages(p))


def test_correction_before_the_original_grant_is_reported():
    p = corrections(payload(0), (2, "2025-12-31", "2026-02-01", 8))
    assert any("precedes the original grant" in m for m, _ in messages(p))


# --- correction chains ------------------------------------------------------------


def test_forward_chain_to_revision_three_is_replayed_at_each_effective_date():
    # 10 -> 12 from March, -> 11 from June; nine days taken in January.
    p = corrections(
        payload(),
        (2, "2026-03-01", "2026-03-02", 12),
        (3, "2026-06-01", "2026-06-02", 11),
    )
    assert not [m for m, _ in messages(p) if "correction" in m.lower()]
    assert remaining(p, date(2026, 12, 31)) == 2  # 11 - 9


def test_retroactive_later_revision_supersedes_from_its_date_without_a_false_violation():
    # R2 raises to 12 from March; R3 (recorded later) restores 10 from January.
    # The latest HR statement wins from its own date, so the account is 10 all year;
    # replaying each correction from its own date alone would show 8 in January and
    # flag t8 falsely.
    p = corrections(
        payload(),
        (2, "2026-03-01", "2026-03-02", 12),
        (3, "2026-01-01", "2026-03-03", 10),
    )
    assert not messages(p)
    assert remaining(p, date(2026, 2, 1), effective_at=date(2026, 2, 1)) == 1
    assert remaining(p, date(2026, 12, 31)) == 1


def test_retroactive_reduction_is_detected_as_a_real_shortfall():
    # R2 reduces to 4 from November; R3 (recorded later) sets 8 from January.
    # From January the account holds 8 against nine days taken: the ninth take and
    # an October reservation are not fundable.
    p = payload()
    add_event(
        p,
        dict(
            leave_event("late", "reserve"),
            effective_on="2026-10-15",
            interval={
                "start": "2026-10-15T09:00:00+09:00",
                "end": "2026-10-15T17:00:00+09:00",
            },
        ),
        "2026-10-15T18:00:00+09:00",
    )
    corrections(
        p, (2, "2026-11-01", "2026-03-02", 4), (3, "2026-01-01", "2026-03-03", 8)
    )
    violated = {
        s for m, subjects in messages(p) if "invariant violated" in m for s in subjects
    }
    assert {"t8", "late"} <= violated
    assert remaining(p, date(2026, 12, 31)) == -1


def test_a_further_forward_revision_still_applies_after_a_retroactive_one():
    # R2 12 from March, R3 10 from January (retroactive), R4 11 from June.
    p = corrections(
        payload(),
        (2, "2026-03-01", "2026-03-02", 12),
        (3, "2026-01-01", "2026-03-03", 10),
        (4, "2026-06-01", "2026-06-02", 11),
    )
    assert not messages(p)
    assert remaining(p, date(2026, 5, 1), effective_at=date(2026, 5, 1)) == 1
    assert remaining(p, date(2026, 12, 31)) == 2


def test_statutory_correction_is_rechecked_against_the_two_year_rule():
    p = payload(0)
    p["leave_accounts"][0].update(statutory_days=0, expires_on="2027-01-01")
    p["leave_obligations"] = []
    assert not [m for m, _ in messages(p) if "two years" in m]
    corrections(p, (2, "2026-03-01", "2026-03-02", 10))
    assert any("two years" in m for m, _ in messages(p))


# --- the last remaining day (sequential; true concurrency needs PostgreSQL) -----------


def test_two_requests_for_the_last_day_cannot_both_succeed(sqlite_session_factory):
    from fastapi.testclient import TestClient

    from shift_scheduler.api.main import app
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_compliance_v3_api import prepare

    prepare(sqlite_session_factory)  # g0: 5 days, no half days
    evidence = {
        "reference": "hr",
        "status": "verified",
        "verified_by": "hr",
        "valid_until": None,
    }
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)

        def reserve(event_id, day, revision):
            return client.post(
                BASE + "/leave-events" + QUERY,
                headers=admin,
                json={
                    "expected_revision": revision,
                    "idempotency_key": "reserve-" + event_id,
                    "payload": {
                        "event_id": event_id,
                        "account_id": "g0",
                        "kind": "reserve",
                        "unit": "day",
                        "quantity": 1,
                        "effective_on": day,
                        "policy_id": "lp0",
                        "evidence": evidence,
                        "interval": {
                            "start": f"{day}T09:00:00+09:00",
                            "end": f"{day}T17:00:00+09:00",
                        },
                    },
                },
            )

        for i in range(4):
            assert reserve(f"r{i}", f"2026-03-0{i + 2}", i + 1).status_code == 200
        # Two staff members read revision 5 and both ask for the last day.
        assert reserve("first", "2026-03-09", 5).status_code == 200
        assert reserve("second", "2026-03-10", 5).status_code == 409  # stale revision
        refreshed = reserve("second", "2026-03-10", 6)  # retried after refresh
        assert refreshed.status_code == 422 and "invariant" in refreshed.text


def test_legacy_leave_grants_are_not_judged_against_the_two_year_rule():
    # Legacy (V1) grants have no statutory portion or kind, so special leave with a
    # short validity cannot be told apart; they are not flagged (recorded limitation).
    from shift_scheduler.domain.planning import SolverSnapshot
    from shift_scheduler.validation.planning import input_findings
    from tests.test_reviewed_planning import snapshot

    base = snapshot().model_dump(mode="json")
    legacy = {
        "grant_id": "lot",
        "person_id": "p0",
        "employer_id": base["contracts"][0]["employer_id"],
        "granted_on": "2026-01-01",
        "expires_on": "2027-01-01",
        "amount": 10,
        "evidence": base["contracts"][0]["evidence"],
    }
    data = SolverSnapshot.model_validate(dict(base, grants=[legacy]))
    assert not [f for f in input_findings(data) if f.rule_id == "leave.grant"]
