"""Period and ordering counterexamples, independently counted in whole hours."""

from copy import deepcopy

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade


def revised_week():
    # Monday-Saturday: 48h => Monday-origin 8h excess; Wednesday-origin 0h.
    payload = upgrade(work_fixture([("A", d, 7, 8, 8) for d in range(6)]))
    old = payload["employments"][0]
    new = deepcopy(old)
    old["end"] = "2026-01-05T00:00:00+09:00"
    new.update(
        revision_id="emp-A-new", start=old["end"], week_start=2, agreement_id="36-A-new"
    )
    payload["employments"].append(new)
    a = payload["agreements"][0]
    anew = deepcopy(a)
    a["end"] = old["end"]
    anew.update(agreement_id="36-A-new", start=old["end"])
    payload["agreements"].append(anew)
    # Include one old duty: previous implementation took its week origin.
    duty = deepcopy(payload["candidates"][0])
    duty.update(
        duty_id="old",
        start="2026-01-02T07:00:00+09:00",
        end="2026-01-02T08:00:00+09:00",
    )
    duty["work"] = [{"start": duty["start"], "end": duty["end"]}]
    for term in payload["work_terms"]:
        term["employment_revision_id"] = "emp-A-new"
    payload["history"] = [duty]
    payload["work_terms"].append(
        {
            "duty_id": "old",
            "employment_revision_id": "emp-A",
            "scheduled_work": duty["work"],
        }
    )
    return payload


def test_agreement_observer_uses_effective_revision_not_first_old_duty():
    payload = revised_week()
    for reverse in (False, True):
        candidate = deepcopy(payload)
        if reverse:
            candidate["candidates"].reverse()
            candidate["employments"].reverse()
        data = parse_snapshot(candidate)
        report = account_work(data, list(data.history) + list(data.candidates))
        current = next(
            a for a in report["agreement_totals"] if a["agreement_id"] == "36-A-new"
        )
        assert current["observer_week_start"] == 2
        assert current["employment_revisions"] == ["emp-A-new"]
        assert current["months"][0]["combined_overtime_holiday_seconds"] == 0


def test_agreement_revision_does_not_reset_annual_or_monthly_hours():
    payload = upgrade(work_fixture([("A", 0, 7, 9, 9), ("A", 1, 7, 10, 10)]))
    original = payload["employments"][0]
    latest = deepcopy(original)
    original["end"] = "2026-01-06T00:00:00+09:00"
    latest.update(
        revision_id="new", start=original["end"], agreement_id="new-agreement"
    )
    payload["employments"].append(latest)
    previous = payload["agreements"][0]
    current = deepcopy(previous)
    previous["end"] = original["end"]
    current.update(
        agreement_id="new-agreement",
        start=original["end"],
        monthly_limit_seconds=2 * 3600,
    )
    payload["agreements"].append(current)
    payload["work_terms"][1]["employment_revision_id"] = "new"
    data = parse_snapshot(payload)
    report = account_work(data, list(data.history) + list(data.candidates))
    totals = next(
        a for a in report["agreement_totals"] if a["agreement_id"] == "new-agreement"
    )
    assert totals["annual_overtime_seconds"] == 3 * 3600
    assert totals["months"][0]["site_overtime_seconds"] == 3 * 3600
    assert any(
        f.subjects == ("new-agreement",) and "Monthly agreement limit" in f.message
        for f in report["findings"]
    )


def transition_week():
    payload = upgrade(work_fixture([("A", d, 7, 8, 8) for d in range(6)]))
    first = payload["employments"][0]
    second = deepcopy(first)
    first["end"] = "2026-01-07T00:00:00+09:00"
    second.update(revision_id="changed", start=first["end"], week_start=2)
    payload["employments"].append(second)
    for term in payload["work_terms"][2:]:
        term["employment_revision_id"] = "changed"
    payload["accounting_transitions"] = [
        {
            "transition_id": "review-1",
            "before_revision_id": first["revision_id"],
            "after_revision_id": "changed",
            "calculation_basis": "preserve_overlapping_full_weeks",
            "evidence": payload["policy_evidence"],
        }
    ]
    return payload


def test_same_agreement_week_transition_has_disjoint_trace_and_full_windows():
    payload = transition_week()
    for reverse in (False, True):
        if reverse:
            payload["employments"].reverse()
            payload["candidates"].reverse()
        data = parse_snapshot(payload)
        result = account_work(data, list(data.candidates))
        assert not any("transition" in f.message.lower() for f in result["findings"])
        total = result["agreement_totals"][0]
        assert total["observer_week_start"] is None
        assert total["observer_method"] == "effective_transitions"
        assert total["months"][0]["combined_overtime_holiday_seconds"] == 8 * 3600
        assert sum(r["work_seconds"] for r in result["trace"]) == 48 * 3600
        assert len(total["observer_windows"]) == 6


def test_unreviewed_transition_is_not_silently_accepted():
    payload = transition_week()
    payload.pop("accounting_transitions")
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert any(
        f.status == "unverified" and "transition" in f.message
        for f in result["findings"]
    )


def test_old_v3_hash_unchanged_without_new_optional_transition():
    from scripts.remediation_fixture import snapshot

    data = snapshot()
    assert "accounting_transitions" not in data.model_dump(mode="json")
    assert parse_snapshot(data.model_dump(mode="json")).input_hash == data.input_hash


def test_overnight_employment_revision_is_segmented_without_candidate_loss():
    import pytest
    from scripts.acceptance_workload import workload

    from shift_scheduler.validation.v3_inputs import input_findings

    data = workload(30, 28, 930011)
    crossing = [t for t in data.work_terms if t.employment_revision_ids]
    assert len(crossing) == 30
    assert all(len(t.employment_revision_ids) == 2 for t in crossing)
    assert not input_findings(data)
    duties = {d.duty_id: d for d in data.candidates}
    term = next(t for t in crossing if duties[t.duty_id].person_id == "p10")
    result = account_work(data, [duties[term.duty_id]])
    assert [r["work_seconds"] for r in result["trace"]] == [7200, 7200]
    assert [r["method"] for r in result["trace"]] == ["standard", "management"]
    assert (
        sum(r["work_seconds"] for r in result["trace"])
        == duties[term.duty_id].work_seconds
    )
    payload = data.model_dump(mode="json")
    wrong = next(t for t in payload["work_terms"] if t["duty_id"] == term.duty_id)
    wrong["employment_revision_ids"].reverse()
    with pytest.raises(ValueError, match="ordered V3"):
        parse_snapshot(payload)
