"""Split advance + conversion + expiry + retrospective grant/actual correction.
Expected fractions below are independently calculated, never solver-derived.
"""

from copy import deepcopy
from datetime import date, datetime
from itertools import permutations

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.leave_accounting import account_leave
from tests.test_compliance_v2 import leave_event
from tests.test_leave_chronology import fixture, hourly


def combined():
    p = fixture([hourly()])
    ev = p["policy_evidence"]
    base = p["leave_accounts"][0]
    base.update(granted_days=7, statutory_days=7, grant_cycle_id="cycle")
    p["leave_accounts"].append(
        {
            **base,
            "account_id": "advance",
            "granted_on": "2025-12-01",
            "expires_on": "2027-12-01",
            "granted_days": 3,
            "statutory_days": 3,
        }
    )
    p["ledger_recordings"].append(
        {
            "recording_id": "advance-record",
            "object_kind": "leave_account",
            "object_id": "advance",
            "external_event_id": "hr:advance",
            "external_revision": 1,
            "recorded_at": "2025-12-01T00:00:00+09:00",
            "evidence": ev,
        }
    )
    p["leave_accounts"].append(
        {
            **base,
            "account_id": "carryover",
            "granted_on": "2024-02-07",
            "expires_on": "2026-02-07",
            "granted_days": 3,
            "statutory_days": 3,
            "grant_cycle_id": "old-cycle",
        }
    )
    p["ledger_recordings"].append(
        {
            "recording_id": "carryover-record",
            "object_kind": "leave_account",
            "object_id": "carryover",
            "external_event_id": "hr:carryover",
            "external_revision": 1,
            "recorded_at": "2024-02-07T00:00:00+09:00",
            "evidence": ev,
        }
    )
    p["leave_obligations"][0].update(
        method="split_advance", qualifying_grant_ids=["advance", "g"]
    )
    half = {
        **leave_event("half", unit="half_day"),
        "effective_on": "2026-02-05",
        "policy_id": "new",
        "interval": {
            "start": "2026-02-05T09:00:00+09:00",
            "end": "2026-02-05T11:00:00+09:00",
        },
    }
    p["leave_records"].append(half)
    p["ledger_recordings"].append(
        {
            "recording_id": "half-record",
            "object_kind": "leave_record",
            "object_id": "half",
            "external_event_id": "hr:half",
            "external_revision": 1,
            "recorded_at": "2026-02-06T00:00:00+09:00",
            "evidence": ev,
        }
    )
    p["grant_amendments"] = [
        {
            "amendment_id": "late-reduction",
            "person_id": "p0",
            "account_id": "g",
            "external_event_id": "hr:g",
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": "2026-01-01",
            "recorded_at": "2026-03-01T00:00:00+09:00",
            "granted_days": 0,
            "statutory_days": 0,
            "reason": "HR corrects original grant; no automatic account transfer",
            "evidence": ev,
        }
    ]
    p["leave_amendments"] = [
        {
            "amendment_id": "late-cancel",
            "person_id": "p0",
            "event_id": "half",
            "external_event_id": "hr:half",
            "external_revision": 2,
            "supersedes_revision": 1,
            "recorded_at": "2026-04-01T00:00:00+09:00",
            "replacement": None,
            "reason": "HR confirms actual half day was erroneous",
            "evidence": ev,
        }
    ]
    return p


def test_combined_corrections_keep_both_time_axes_and_do_not_spend_another_lot():
    payload = combined()
    # 7 - 5/8 = 6+3/8 -> 6+ceil(3/8*4)/4 = 6.5 -> half day = 6.
    # Grant corrected to zero: -5/8. Negative balances cannot undergo the
    # ordinary remainder conversion; preserve that unresolved deficit: -5/8-1/2=-9/8.
    # Cancelling the half day later restores -5/8, not a fabricated zero.
    for order in permutations(payload["leave_records"]):
        p = deepcopy(payload)
        p["leave_records"] = list(order)
        data = parse_snapshot(p)
        for known, expected in [
            ("2026-02-09", {"numerator": 6, "denominator": 1}),
            ("2026-03-02", {"numerator": -9, "denominator": 8}),
            ("2026-04-02", {"numerator": -5, "denominator": 8}),
        ]:
            result = account_leave(
                data,
                date(2026, 2, 8),
                effective_at=date(2026, 2, 8),
                known_at=datetime.fromisoformat(known + "T00:00:00+09:00"),
            )
            balances = {b["account_id"]: b for b in result["balances"]}
            assert balances["g"]["remaining_days"] == expected
            assert balances["carryover"]["expired"]
            assert not balances["advance"]["expired"]
            assert balances["carryover"]["available_days"] == {
                "numerator": 0,
                "denominator": 1,
            }
            assert balances["advance"]["remaining_days"] == {
                "numerator": 3,
                "denominator": 1,
            }
            if known == "2026-02-09":
                assert result["obligations"][0]["taken_half_days"] == 1
            else:
                assert result["requires_hr_reconciliation"]
                assert any(
                    "Negative balance requires HR reconciliation before conversion"
                    in f.message
                    for f in result["findings"]
                )
        assert data.leave_accounts[0].granted_days == 7
        assert len(data.leave_records) == 3
