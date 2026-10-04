"""Independent day/half-day cancellation and recorded-time correction examples."""

from datetime import date, datetime

from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.validation.leave_accounting import account_leave
from tests.test_compliance_v2 import leave_event, leave_fixture
from tests.test_compliance_v3 import upgrade


def data_with_correction():
    payload = upgrade(leave_fixture([leave_event("actual")]))
    replacement = {**payload["leave_records"][0], "unit": "half_day"}
    payload["leave_amendments"] = [
        {
            "amendment_id": "correct-actual",
            "person_id": "p0",
            "event_id": "actual",
            "external_event_id": "hr:actual",
            "external_revision": 2,
            "supersedes_revision": 1,
            "recorded_at": "2026-02-01T00:00:00+09:00",
            "replacement": replacement,
            "reason": "HR confirms half-day rather than full-day",
            "evidence": payload["policy_evidence"],
        }
    ]
    return SolverSnapshotV3.model_validate(payload)


def test_prior_v3_hash_remains_identical_without_new_optional_field():
    payload = upgrade(leave_fixture())
    data = SolverSnapshotV3.model_validate(payload)
    canonical = data.model_dump(mode="json")
    assert "leave_amendments" not in canonical
    assert data.input_hash == content_hash(canonical)


def test_corrected_and_contemporaneous_ledgers_keep_original_evidence():
    data = data_with_correction()
    for known, numerator, denominator in [
        ("2026-01-31T00:00:00Z", 9, 1),
        ("2026-02-02T00:00:00Z", 19, 2),
    ]:
        result = account_leave(
            data,
            date(2026, 1, 31),
            effective_at=date(2026, 1, 31),
            known_at=datetime.fromisoformat(known),
        )
        assert result["balances"][0]["remaining_days"] == {
            "numerator": numerator,
            "denominator": denominator,
        }
        assert not result["findings"]
    assert data.leave_records[0].unit == "day"
    assert result["amendment_trace"][0]["previous_event"]["unit"] == "day"
    assert result["amendment_trace"][0]["corrected_event"]["unit"] == "half_day"


def test_cancellation_is_a_new_revision_not_deletion_of_source():
    data = data_with_correction()
    payload = data.model_dump(mode="json")
    payload["leave_amendments"].append(
        {
            **payload["leave_amendments"][0],
            "amendment_id": "cancel-actual",
            "external_revision": 3,
            "supersedes_revision": 2,
            "recorded_at": "2026-03-01T00:00:00+09:00",
            "replacement": None,
            "reason": "HR confirms no actual leave",
        }
    )
    amended = SolverSnapshotV3.model_validate(payload)
    result = account_leave(amended, date(2026, 3, 2))
    assert result["balances"][0]["remaining_days"] == {
        "numerator": 10,
        "denominator": 1,
    }
    assert not result["live_intervals"] and not result["findings"]
    assert len(amended.leave_records) == 1 and len(result["amendment_trace"]) == 2


def test_gap_and_dependent_reversal_require_reconciliation():
    payload = data_with_correction().model_dump(mode="json")
    payload["leave_amendments"][0].update(external_revision=3, supersedes_revision=2)
    result = account_leave(SolverSnapshotV3.model_validate(payload), date(2026, 3, 2))
    assert any(f.rule_id == "leave.v3.history" for f in result["findings"])
    payload = data_with_correction().model_dump(mode="json")
    payload["leave_records"].append(
        leave_event("reverse", kind="reverse", related_event_id="actual")
    )
    result = account_leave(SolverSnapshotV3.model_validate(payload), date(2026, 3, 2))
    assert any("matching" in f.message for f in result["findings"])
    assert result["requires_hr_reconciliation"]
