"""Accounting-only exact-second upper-limit oracles; not a scheduling feasibility proof."""

from copy import deepcopy
from datetime import datetime, timedelta

import pytest

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture
from tests.test_compliance_v3 import upgrade


def cap_fixture(month_seconds):
    payload = upgrade(work_fixture([]))
    # All entries are explicitly designated statutory-holiday actual work, so
    # combined work is the independently supplied integer amount (no OT oracle).
    payload["history"] = []
    for month, seconds in month_seconds:
        count = 10
        parts = [seconds // count] * count
        parts[-1] += seconds % count
        for day, amount in enumerate(parts, 1):
            if not amount:
                continue
            start = datetime.fromisoformat(f"{month}-{day:02d}T07:00:00+09:00")
            end = start + timedelta(seconds=amount)
            identity = f"actual-{month}-{day}"
            payload["history"].append(
                {
                    "duty_id": identity,
                    "person_id": "p0",
                    "relationship_id": "A",
                    "kind": "DAY",
                    "location": "main",
                    "task": "dispensing",
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "work": [{"start": start.isoformat(), "end": end.isoformat()}],
                    "source": "external",
                    "external_employer_id": "A",
                }
            )
            payload["work_terms"].append(
                {
                    "duty_id": identity,
                    "employment_revision_id": "emp-A",
                    "scheduled_work": [],
                }
            )
            payload["employments"][0]["statutory_holidays"].append(
                start.date().isoformat()
            )
    payload["employments"][0]["statutory_holidays"] = sorted(
        set(payload["employments"][0]["statutory_holidays"])
    )
    return payload


def report(payload):
    data = parse_snapshot(payload)
    return account_work(data, list(data.history))


@pytest.mark.parametrize("delta,violation", [(-1, False), (0, True), (1, True)])
def test_single_month_100_hours_is_strict(delta, violation):
    result = report(cap_fixture([("2026-01", 100 * 3600 + delta)]))
    assert sum(r["holiday_seconds"] for r in result["trace"]) == 100 * 3600 + delta
    failures = [
        f for f in result["findings"] if "Combined overtime/holiday" in f.message
    ]
    assert bool(failures) is violation


@pytest.mark.parametrize("months", range(2, 7))
@pytest.mark.parametrize("delta,violation", [(-1, False), (0, False), (1, True)])
def test_rolling_80_hours_integer_boundary(months, delta, violation):
    # Earlier n-1 months at 80h and current month 80h +/- 1s. All months <100h.
    labels = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"][
        -months:
    ]
    result = report(
        cap_fixture(
            [
                (label, 80 * 3600 + (delta if label == "2026-01" else 0))
                for label in labels
            ]
        )
    )
    total = next(r for r in result["agreement_totals"] if r["agreement_id"] == "36-A")
    january = next(m for m in total["months"] if m["start"] == "2026-01-01")
    assert january["rolling_sums_seconds"][str(months)] == months * 80 * 3600 + delta
    assert (
        january["rolling_sums_seconds"][str(months)] > months * 80 * 3600
    ) is violation
    assert (
        bool(
            [f for f in result["findings"] if "Combined overtime/holiday" in f.message]
        )
        is violation
    )


def test_method_change_retains_old_actual_and_reports_new_management_allocation():
    payload = upgrade(
        work_fixture(
            [
                ("A", 0, 6, 6, 6),
                ("B", 0, 13, 1, 1),
                ("A", 1, 6, 6, 6),
                ("B", 1, 13, 1, 1),
            ]
        )
    )
    evidence = payload["policy_evidence"]
    payload["accounting_transitions"] = []
    for original in list(payload["employments"]):
        following = deepcopy(original)
        original["end"] = "2026-01-06T00:00:00+09:00"
        following.update(
            revision_id=original["revision_id"] + "-management",
            start=original["end"],
            method="management",
        )
        payload["employments"].append(following)
        payload["accounting_transitions"].append(
            {
                "transition_id": "transition-" + original["revision_id"],
                "before_revision_id": original["revision_id"],
                "after_revision_id": following["revision_id"],
                "calculation_basis": "effective_calendar_windows",
                "evidence": evidence,
            }
        )
    for term in payload["work_terms"][2:]:
        term["employment_revision_id"] += "-management"
    payload["management_models"] = [
        {
            "model_id": "AB",
            "person_id": "p0",
            "start": "2026-01-06T00:00:00+09:00",
            "end": payload["context"]["end"],
            "first_employer": "A",
            "second_employer": "B",
            "month_anchor": "2026-01-01",
            "first_month_limit_seconds": 40 * 3600,
            "second_month_limit_seconds": 40 * 3600,
            "first_consent": evidence,
            "second_consent": evidence,
            "notification": evidence,
        }
    ]
    data = parse_snapshot(payload)
    result = account_work(data, list(data.candidates))
    assert [
        (r["date"], r["overtime_seconds"])
        for r in result["trace"]
        if r["employer_id"] == "B"
    ] == [("2026-01-05", 0), ("2026-01-06", 3600)]
    assert not [f for f in result["findings"] if f.status == "unverified"]
    assert all(
        a["months"][0]["combined_overtime_holiday_seconds"] == 3600
        for a in result["agreement_totals"]
    )
