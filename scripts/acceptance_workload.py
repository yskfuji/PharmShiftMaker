"""Representative V3 inputs for PRE-acceptance calibration; no accepted timing claims.

Every case combines effective revisions, an A/B management transition, actual
night history, statutory-holiday opportunity, and externally recorded leave
corrections. Seeds used for development must never enter held-out acceptance.
"""

from copy import deepcopy
from datetime import datetime, timedelta

from scripts.remediation_benchmark import workload as base_workload

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.validation.work_accounting import month_boundary


def workload(people, days, seed, lookahead=14):
    baseline = base_workload(people, days, seed, lookahead)
    p = baseline.model_dump(mode="json")
    ev = p["policy_evidence"]
    suffix = f"{people}-{days}-{seed}-{lookahead}"
    # Distinct synthetic histories must not redefine an authoritative site/review
    # from an earlier case in the same audit database.
    for item in (*p["establishments"], *p["employments"]):
        item["establishment_id"] += "-" + suffix
    boundary = (baseline.period.start + timedelta(days=15)).isoformat()
    p["rule_revision"] = "acceptance-general-v3-r1"
    p["rule_reviews"][0].update(
        review_id="review-" + suffix,
        rule_id=p["rule_revision"],
        provision="Synthetic reviewed general-regime calibration input",
        transitional_provision="Explicit adjacent agreement/employment revisions with complete historical windows",
    )
    p["agreements"] = []
    for site in p["establishments"]:
        original = {
            "agreement_id": "agreement-" + site["establishment_id"] + "-" + suffix,
            "employer_id": site["employer_id"],
            "establishment_id": site["establishment_id"],
            "start": p["context"]["start"],
            "end": boundary,
            "year_start": "2026-01-01",
            "month_anchor": "2026-01-01",
            "daily_limit_seconds": 8 * 3600,
            "monthly_limit_seconds": 45 * 3600,
            "annual_limit_seconds": 360 * 3600,
            "evidence": ev,
            "holiday_work_permitted": True,
        }
        p["agreements"].extend(
            [
                original,
                {
                    **original,
                    "agreement_id": original["agreement_id"] + "-revised",
                    "start": boundary,
                    "end": p["context"]["end"],
                },
            ]
        )
    p["accounting_transitions"] = []
    originals = list(p["employments"])
    for e in originals:
        revised = deepcopy(e)
        e["end"] = boundary
        e["agreement_id"] = "agreement-" + e["establishment_id"] + "-" + suffix
        revised.update(
            revision_id=e["revision_id"] + "-revised",
            start=boundary,
            agreement_id=e["agreement_id"] + "-revised",
        )
        if e["person_id"] == "p10":
            revised["method"] = "management"
        if e["person_id"] == "p1":
            revised["week_start"] = 2
        p["employments"].append(revised)
        if (e["method"], e["week_start"]) != (revised["method"], revised["week_start"]):
            p["accounting_transitions"].append(
                {
                    "transition_id": "transition-" + e["revision_id"],
                    "before_revision_id": e["revision_id"],
                    "after_revision_id": revised["revision_id"],
                    "calculation_basis": (
                        "preserve_overlapping_full_weeks"
                        if e["week_start"] != revised["week_start"]
                        else "effective_calendar_windows"
                    ),
                    "evidence": ev,
                }
            )
    p["management_models"] = [
        {
            "model_id": "model-AB-" + suffix,
            "person_id": "p10",
            "start": boundary,
            "end": p["context"]["end"],
            "first_employer": "hospital",
            "second_employer": "outside",
            "month_anchor": "2026-01-01",
            "first_month_limit_seconds": 40 * 3600,
            "second_month_limit_seconds": 40 * 3600,
            "first_consent": ev,
            "second_consent": ev,
            "notification": ev,
        }
    ]
    # External reported hours in the new management period, rather than an empty model.
    external = next(
        e
        for e in p["employments"]
        if e["person_id"] == "p10"
        and e["employer_id"] == "outside"
        and e["start"] == boundary
    )
    start = datetime.fromisoformat(boundary) + timedelta(days=1, hours=6)
    duty = {
        "duty_id": "external-management-" + suffix,
        "person_id": "p10",
        "relationship_id": external["relationship_id"],
        "kind": "DAY",
        "location": "outside",
        "task": "dispensing",
        "source": "external",
        "external_employer_id": "outside",
        "start": start.isoformat(),
        "end": (start + timedelta(hours=1)).isoformat(),
        "work": [
            {
                "start": start.isoformat(),
                "end": (start + timedelta(hours=1)).isoformat(),
            }
        ],
    }
    p["history"].append(duty)
    p["work_terms"].append(
        {
            "duty_id": duty["duty_id"],
            "employment_revision_id": external["revision_id"],
            "scheduled_work": duty["work"],
        }
    )
    p["ledger_recordings"] = [
        {
            "recording_id": "record-" + item[key],
            "object_kind": kind,
            "object_id": item[key],
            "external_event_id": "hr:" + item[key],
            "external_revision": 1,
            "recorded_at": "2026-01-01T00:00:00+09:00",
            "evidence": ev,
        }
        for kind, items, key in [
            ("leave_account", p["leave_accounts"], "account_id"),
            ("leave_record", p["leave_records"], "event_id"),
        ]
        for item in items
    ]
    account = p["leave_accounts"][0]
    p["grant_amendments"] = [
        {
            "amendment_id": "correction-" + suffix,
            "person_id": account["person_id"],
            "account_id": account["account_id"],
            "external_event_id": "hr:" + account["account_id"],
            "external_revision": 2,
            "supersedes_revision": 1,
            "effective_on": account["granted_on"],
            "recorded_at": "2026-01-02T00:00:00+09:00",
            "granted_days": 4,
            "statutory_days": 4,
            "reason": "Synthetic externally confirmed correction",
            "evidence": ev,
        }
    ]
    p["burden_history"] = []
    for person in p["people"]:
        own = next(
            e
            for e in originals
            if e["person_id"] == person["person_id"] and e["employer_id"] == "hospital"
        )
        for offset in range(-12, 0):
            begin = month_boundary(baseline.period.start.date(), offset)
            end = month_boundary(baseline.period.start.date(), offset + 1)
            holidays = {
                datetime.fromisoformat(d).date() for d in own["statutory_holidays"]
            }
            day = next(
                begin + timedelta(days=i)
                for i in range((end - begin).days)
                if begin + timedelta(days=i) in holidays
            )
            start = datetime.fromisoformat(day.isoformat() + "T22:00:00+09:00")
            finish = start + timedelta(hours=1)
            identity = f"burden-{person['person_id']}-{offset}-{suffix}"
            history = {
                "duty_id": identity,
                "person_id": person["person_id"],
                "relationship_id": own["relationship_id"],
                "kind": "NIGHT",
                "location": "main",
                "task": "dispensing",
                "source": "actual",
                "start": start.isoformat(),
                "end": finish.isoformat(),
                "work": [{"start": start.isoformat(), "end": finish.isoformat()}],
            }
            p["history"].append(history)
            p["work_terms"].append(
                {
                    "duty_id": identity,
                    "employment_revision_id": own["revision_id"],
                    "scheduled_work": history["work"],
                }
            )
            for kind in ("night", "holiday"):
                p["burden_history"].append(
                    {
                        "person_id": person["person_id"],
                        "kind": kind,
                        "seconds": 3600,
                        "eligible_seconds": 8 * 3600,
                        "period_start": begin.isoformat(),
                        "period_end": end.isoformat(),
                        "eligibility_evidence": ev,
                    }
                )
    if seed % 2 == 0:
        # Half the predeclared profiles require coverage after the four-hour
        # template ends. The eight-hour template has a real one-hour break.
        p["duty_templates"].append(
            {
                "template_id": "long-day",
                "kind": "DAY",
                "task": "dispensing",
                "location": "main",
                "dates": p["duty_templates"][0]["dates"],
                "start_second": 9 * 3600,
                "duration_seconds": 9 * 3600,
                "work": [
                    {"start_seconds": 0, "end_seconds": 4 * 3600},
                    {"start_seconds": 5 * 3600, "end_seconds": 9 * 3600},
                ],
                "scheduled_work": [
                    {"start_seconds": 0, "end_seconds": 4 * 3600},
                    {"start_seconds": 5 * 3600, "end_seconds": 9 * 3600},
                ],
            }
        )
        for day in p["duty_templates"][0]["dates"]:
            p["demands"].append(
                {
                    "demand_id": "afternoon-" + day,
                    "task": "dispensing",
                    "location": "main",
                    "minimum": 2,
                    "target": 2,
                    "start": day + "T14:00:00+09:00",
                    "end": day + "T18:00:00+09:00",
                    "evidence": ev,
                }
            )
    history_ids = {r["duty_id"] for r in p["history"]}
    terms = [t for t in p["work_terms"] if t["duty_id"] in history_ids]
    p.update(candidates=[], work_terms=terms)
    generated = generate_catalogue(parse_snapshot(p))
    p.update(
        candidates=generated["candidates"],
        work_terms=[*terms, *generated["work_terms"]],
    )
    return parse_snapshot(p)


def main(argv=None):
    import argparse

    from scripts.benchmark_runner import run

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--lookahead", type=int, choices=[7, 14, 28], default=14)
    extra, remaining = parser.parse_known_args(argv)
    return run(
        lambda n, d, seed: workload(n, d, seed, extra.lookahead),
        remaining,
        workload_configuration={
            "generator": "acceptance_workload",
            "lookahead": extra.lookahead,
        },
    )


if __name__ == "__main__":
    raise SystemExit(main())
