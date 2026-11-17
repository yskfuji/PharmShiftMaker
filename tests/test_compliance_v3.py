"""Independent expected values for new evidence/version boundaries."""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.validation.leave_accounting import account_leave
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import leave_event, leave_fixture, work_fixture


def upgrade(data):
    payload = data.model_dump(mode="json")
    payload["schema_version"] = 3
    sites = {}
    for row in payload["employments"]:
        row["establishment_id"] = "site-" + row["employer_id"]
        sites[row["establishment_id"]] = {
            "establishment_id": row["establishment_id"],
            "employer_id": row["employer_id"],
            "start": row["start"],
            "end": row["end"],
            "evidence": row["declaration"],
        }
    for row in payload["agreements"]:
        row["establishment_id"] = "site-" + row["employer_id"]
    payload["establishments"] = list(sites.values())
    payload["ledger_recordings"] = [
        {
            "recording_id": kind + ":" + row[key],
            "object_kind": kind,
            "object_id": row[key],
            "external_event_id": "hr:" + row[key],
            "external_revision": 1,
            "recorded_at": (
                "2026-01-01T00:00:00+09:00"
                if kind == "leave_account"
                else "2026-01-07T00:00:00+09:00"
            ),
            "evidence": row["evidence"],
        }
        for kind, collection, key in [
            ("leave_account", "leave_accounts", "account_id"),
            ("leave_record", "leave_records", "event_id"),
        ]
        for row in payload[collection]
    ]
    return payload


def corrected():
    payload = upgrade(leave_fixture([leave_event("taken")]))
    payload["grant_amendments"] = [
        {
            "amendment_id": "fix",
            "person_id": "p0",
            "account_id": "g",
            "external_event_id": "hr:g",
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": "2026-01-01",
            "recorded_at": "2026-02-01T00:00:00+09:00",
            "granted_days": 0,
            "statutory_days": 0,
            "reason": "外部人事による付与誤りの訂正",
            "evidence": payload["policy_evidence"],
        }
    ]
    return SolverSnapshotV3.model_validate(payload)


def test_versions_preserve_original_hashes():
    old = leave_fixture()
    assert parse_snapshot(old.model_dump(mode="json")).input_hash == old.input_hash
    new = corrected()
    assert isinstance(parse_snapshot(new.model_dump(mode="json")), SolverSnapshotV3)
    assert new.input_hash == parse_snapshot(new.model_dump(mode="json")).input_hash


def test_effective_and_known_time_do_not_erase_taken_leave():
    data = corrected()
    old = account_leave(
        data,
        date(2026, 1, 31),
        effective_at=date(2026, 1, 31),
        known_at=datetime.fromisoformat("2026-01-31T23:59:59+09:00"),
    )
    revised = account_leave(
        data,
        date(2026, 1, 31),
        effective_at=date(2026, 1, 31),
        known_at=datetime.fromisoformat("2026-02-02T00:00:00+09:00"),
    )
    assert old["balances"][0]["remaining_days"] == {"numerator": 9, "denominator": 1}
    assert revised["balances"][0]["remaining_days"] == {
        "numerator": -1,
        "denominator": 1,
    }
    assert revised["requires_hr_reconciliation"]
    assert len(revised["live_intervals"]) == 1
    assert data.leave_accounts[0].granted_days == 10
    assert len(data.leave_records) == 1


def test_effective_cutoff_excludes_later_actual_but_not_original_grant():
    report = account_leave(
        corrected(),
        date(2026, 1, 5),
        effective_at=date(2026, 1, 5),
        known_at=datetime.fromisoformat("2026-01-31T00:00:00+09:00"),
    )
    assert report["balances"][0]["remaining_days"]["numerator"] == 10
    assert not report["live_intervals"]


def test_missing_recording_is_unverified_not_guessed():
    data = corrected().model_copy(update={"ledger_recordings": ()})
    report = account_leave(
        data,
        date(2026, 1, 31),
        known_at=datetime.fromisoformat("2026-02-02T00:00:00+09:00"),
    )
    assert not report["balances"]
    assert any(f.status == "unverified" for f in report["findings"])


def test_amendment_chain_cannot_skip_or_change_external_identity():
    payload = corrected().model_dump(mode="json")
    payload["grant_amendments"][0]["external_event_id"] = "someone-else"
    report = account_leave(parse_snapshot(payload), date(2026, 2, 2))
    assert report["balances"][0]["remaining_days"]["numerator"] == 9
    assert any(f.rule_id == "leave.v3.history" for f in report["findings"])
    payload["grant_amendments"][0]["external_revision"] = 3
    with pytest.raises(ValidationError):
        parse_snapshot(payload)


def test_same_employer_separate_establishment_agreements():
    payload = upgrade(work_fixture([("A", 0, 7, 9, 9), ("B", 1, 7, 10, 10)]))
    for row in [
        *payload["establishments"],
        *payload["employments"],
        *payload["agreements"],
    ]:
        row["employer_id"] = "hospital"
    payload["agreements"][0]["daily_limit_seconds"] = 3600
    payload["agreements"][1]["daily_limit_seconds"] = 7200
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert {r["establishment_id"] for r in result["trace"]} == {"site-A", "site-B"}
    assert not any("Daily agreement limit" in f.message for f in result["findings"])
    payload["agreements"][1]["daily_limit_seconds"] = 3600
    result = account_work(parse_snapshot(payload), list(data.candidates))
    violations = [
        f.subjects for f in result["findings"] if "Daily agreement limit" in f.message
    ]
    assert violations == [("36-B",)]
