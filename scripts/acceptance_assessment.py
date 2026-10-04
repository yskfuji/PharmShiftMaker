"""Read-only assessment of FIRST attempts, never best-of-retry performance.

This assesses timing/data integrity only. Resource limits, frozen build and
functional acceptance must be independently verified before overall acceptance.
"""

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path


def nearest_rank(values, quantile=0.95):
    if not values:
        return None
    return sorted(values)[math.ceil(len(values) * quantile) - 1]


def wilson_interval(exceeded, count):
    if not count:
        return None
    z = 1.959963984540054
    fraction = exceeded / count
    denominator = 1 + z * z / count
    center = (fraction + z * z / (2 * count)) / denominator
    margin = (
        z
        * math.sqrt(fraction * (1 - fraction) / count + z * z / (4 * count * count))
        / denominator
    )
    return [max(0, center - margin), min(1, center + margin)]


def assess(events, expected_cases, *, samples_per_stratum=100):
    expected = {json.dumps(c, sort_keys=True): c for c in expected_cases}
    if len(expected) != len(expected_cases):
        raise ValueError("Duplicate planned cases")
    attempts, ordered, anomalies = {}, defaultdict(list), []
    for event in events:
        key, identity, kind = event["case_key"], event["attempt"], event["kind"]
        if key not in expected:
            anomalies.append({"attempt": identity, "reason": "unplanned_case"})
        if kind == "START":
            if identity in attempts:
                anomalies.append({"attempt": identity, "reason": "duplicate_start"})
                continue
            if key in expected and event["payload"] != expected[key]:
                anomalies.append({"attempt": identity, "reason": "descriptor_mismatch"})
            attempts[identity] = {"key": key, "result": None}
            ordered[key].append(identity)
        elif kind == "RESULT":
            if (
                identity not in attempts
                or attempts[identity]["key"] != key
                or attempts[identity]["result"] is not None
            ):
                anomalies.append(
                    {"attempt": identity, "reason": "orphan_or_duplicate_result"}
                )
                continue
            attempts[identity]["result"] = event["payload"]
        else:
            anomalies.append({"attempt": identity, "reason": "unknown_event"})
    groups = defaultdict(list)
    for key, descriptor in expected.items():
        first = attempts[ordered[key][0]]["result"] if ordered[key] else None
        elapsed = (first or {}).get("observed_end_to_end_seconds")
        valid = bool(
            first
            and first.get("success") is True
            and first.get("status") in {"FEASIBLE", "OPTIMAL"}
            and first.get("commit_telemetry_complete") is True
            and first.get("persisted_observed_at")
            and isinstance(elapsed, (int, float))
            and not isinstance(elapsed, bool)
            and math.isfinite(elapsed)
            and elapsed >= 0
        )
        groups[(descriptor["people"], descriptor["days"])].append(
            {
                "case": descriptor["case"],
                "attempts": len(ordered[key]),
                "valid": valid,
                "elapsed": elapsed if valid else None,
                "status": (
                    first.get("status", "ERROR")
                    if first
                    else ("INTERRUPTED" if ordered[key] else "NOT_RUN")
                ),
            }
        )
    strata = []
    for (people, days), cases in sorted(groups.items()):
        timings = [c["elapsed"] for c in cases if c["valid"]]
        states = {
            state: sum(c["status"] == state for c in cases)
            for state in sorted({c["status"] for c in cases})
        }
        exceeded = sum(t > 30 for t in timings)
        p95 = nearest_rank(timings)
        strata.append(
            {
                "people": people,
                "days": days,
                "expected": len(cases),
                "valid_first_attempts": len(timings),
                "states": states,
                "retry_attempts": sum(max(0, c["attempts"] - 1) for c in cases),
                "p95_successful_first_attempts_seconds": p95,
                "maximum_seconds": max(timings) if timings else None,
                "over_30_seconds": exceeded,
                "exceedance_rate": exceeded / len(timings) if timings else None,
                "wilson_95_interval": wilson_interval(exceeded, len(timings)),
                "passed": len(cases) == samples_per_stratum == len(timings)
                and p95 <= 30,
                "cases": cases,
            }
        )
    return {
        "timing_groups_passed": bool(strata)
        and not anomalies
        and all(g["passed"] for g in strata),
        "protocol_dimensions_complete": set(groups)
        == {(n, d) for n in (30, 40, 50) for d in (28, 29, 30, 31)}
        and len(expected) == 1200
        and samples_per_stratum == 100,
        "anomalies": anomalies,
        "strata": strata,
        "overall_acceptance": "REQUIRES_INDEPENDENT_BUILD_RESOURCE_AND_FUNCTIONAL_EVIDENCE",
        "interval_method": "Wilson score, two-sided 95%; successful first attempts only; independence not established by this program",
    }


def read_journal(path):
    with sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True) as db:
        configuration = json.loads(
            db.execute("SELECT configuration FROM run").fetchone()[0]
        )
        events = [
            {"attempt": a, "case_key": c, "kind": k, "payload": json.loads(p)}
            for a, c, k, p in db.execute(
                "SELECT attempt,case_key,kind,payload FROM events ORDER BY sequence"
            )
        ]
    return configuration, events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    config, events = read_journal(args.journal)
    if config["split"] != "held-out":
        raise ValueError("Tuning data is not acceptance data")
    cases = [
        {
            "people": n,
            "days": d,
            "case": c,
            "split": "held-out",
            "seed": (
                config.get("seed_base")
                if config.get("seed_base") is not None
                else 100000
            )
            + c,
            "budget": config["budget"],
        }
        for n in config["people"]
        for d in config["days"]
        for c in range(config["samples"])
    ]
    report = assess(events, cases)
    with Path(args.output).open("x") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
    return (
        0
        if report["timing_groups_passed"] and report["protocol_dimensions_complete"]
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
