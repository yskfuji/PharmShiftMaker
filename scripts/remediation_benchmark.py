"""V3 approved-catalogue workload, preserving the held-out split of the baseline harness."""

import argparse
from datetime import timedelta

from scripts.benchmark_runner import run
from scripts.completion_benchmark import workload as original_workload

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot


def workload(people, days, seed, lookahead=14):
    # Generate the entire horizon once, then restore the displayed/contract month.
    raw = original_workload(people, days + lookahead, seed)
    payload = raw.model_dump(mode="json")
    period_end = raw.period.start + timedelta(days=days)
    payload.update(
        schema_version=3,
        rule_revision="remediation-general-v3",
        lookahead_days=lookahead,
        lookahead_demand_confirmed=True,
        period={"start": raw.period.start.isoformat(), "end": period_end.isoformat()},
        catalogue_evidence=payload["policy_evidence"],
        fairness_history_evidence=payload["policy_evidence"],
        rule_reviews=[
            {
                "review_id": "synthetic-rule-review",
                "rule_id": "remediation-general-v3",
                "source_url": "synthetic:benchmark-spec",
                "provision": "General regime; explicitly confirmed empty prior burden for this independent case",
                "transitional_provision": "No regime transition in performance group",
                "reviewed_on": "2026-01-01",
                "next_review_on": "2026-04-01",
                "start": raw.context.start.isoformat(),
                "end": raw.context.end.isoformat(),
                "evidence": payload["policy_evidence"],
            }
        ],
    )
    sites = {}
    for employment in payload["employments"]:
        identity = "site-" + employment["employer_id"]
        employment["establishment_id"] = identity
        sites[identity] = {
            "establishment_id": identity,
            "employer_id": employment["employer_id"],
            "start": raw.context.start.isoformat(),
            "end": raw.context.end.isoformat(),
            "evidence": payload["policy_evidence"],
        }
    payload["establishments"] = list(sites.values())
    for index, contract in enumerate(payload["contracts"]):
        contract["period_max_seconds"] = days * (3 if index % 3 == 0 else 4) * 3600
        if index % 3 == 0:
            contract["allowed_kinds"] = ["DAY"]
    patterns = []
    for kind, hour, count in [
        ("DAY", 9, days + lookahead),
        ("NIGHT", 22, days + lookahead - 1),
    ]:
        patterns.append(
            {
                "template_id": kind.lower(),
                "kind": kind,
                "task": "dispensing",
                "location": "main",
                "dates": [
                    (raw.period.start + timedelta(days=i)).date() for i in range(count)
                ],
                "start_second": hour * 3600,
                "duration_seconds": 4 * 3600,
                "work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
                "scheduled_work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
            }
        )
    payload["duty_templates"] = patterns
    external = {d["duty_id"] for d in payload["history"]}
    terms = [t for t in payload["work_terms"] if t["duty_id"] in external]
    payload.update(candidates=[], work_terms=terms)
    generated = generate_catalogue(parse_snapshot(payload))
    payload.update(
        candidates=generated["candidates"],
        work_terms=[*terms, *generated["work_terms"]],
    )
    return parse_snapshot(payload)


def main(argv=None):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--lookahead", type=int, choices=[7, 14, 28], default=14)
    extra, remaining = parser.parse_known_args(argv)
    return run(
        lambda n, d, seed: workload(n, d, seed, extra.lookahead),
        remaining,
        workload_configuration={
            "generator": "remediation_benchmark",
            "schema_version": 3,
            "lookahead": extra.lookahead,
        },
    )


if __name__ == "__main__":
    raise SystemExit(main())
