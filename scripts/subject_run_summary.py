"""Standard summary and invariant checks for a person-erasure diagnostic run.

Replaces ad-hoc result.json inspection. Invariants are reported, never waived:
a violated invariant makes the command exit non-zero.
"""

import argparse
import json
from collections import Counter
from pathlib import Path


def _person(event, decisions):
    remaining = {t["copy_id"] for t in event["remaining"]["targets"]}
    rejected = {
        d["copy_id"]
        for d in decisions
        if d["person_id"] == event["person_id"]
        and d["decision"] == "REJECTED"
        and d["section"] == "database_subject"
    }
    profile = event.get("erased_profile") or {}
    return {
        "person_id": event["person_id"],
        "database_erased": event["actual_database_erased_count"],
        "file_erased": event.get("actual_file_erased_count"),
        "archives": event.get("preserved_archive_count"),
        "residual": event.get("residual_count", len(event["remaining"]["targets"])),
        "residual_reasons": event.get("residual_reasons_overlapping", {}),
        "erased_by_table": profile.get("erased_by_table"),
        "wall_clock_anchor_erased": profile.get("wall_clock_anchor_erased"),
        "rejected": len(rejected),
        "rejected_but_erased": len(rejected - remaining),
        "review": {
            k: v
            for k, v in (event.get("review") or {}).items()
            if k in ("database_subject", "preservation", "joint_database", "joint_file")
        },
    }


def summarize(result, decisions, *, kept_tables=("planning_input_heads",)):
    people = [_person(e, decisions) for e in result.get("subject_events", [])]
    deferred = [
        _person(e, decisions)
        for e in (result.get("deferred_expiry") or {}).get("events", [])
    ]
    violations = []
    for phase, rows in (("canonical", people), ("deferred", deferred)):
        for row in rows:
            if row["rejected_but_erased"]:
                violations.append(
                    f"{phase}:{row['person_id']}: {row['rejected_but_erased']} rejected rows erased"
                )
            if row["wall_clock_anchor_erased"]:
                violations.append(
                    f"{phase}:{row['person_id']}: {row['wall_clock_anchor_erased']} wall-clock-anchored rows erased"
                )
            for table in kept_tables:
                if (row["erased_by_table"] or {}).get(table):
                    violations.append(
                        f"{phase}:{row['person_id']}: kept table {table} erased"
                    )
    if result.get("frozen_code_evidence") is False:
        violations.append("code changed during run")
    return {
        "status": result.get("status"),
        "error": result.get("error"),
        "processed": result.get("processed_count"),
        "frozen": result.get("frozen_code_evidence"),
        "release": (result.get("authorised_release_attempt") or {}).get("reason"),
        "protocol": (result.get("review_protocol") or {}).get("sha256"),
        "deferred_at": (result.get("deferred_expiry") or {}).get("synthetic_at"),
        "canonical": people,
        "deferred": deferred,
        "violations": violations,
    }


def load(directory):
    directory = Path(directory)
    result = json.loads((directory / "result.json").read_text())
    path = directory / "review-decisions.jsonl"
    decisions = (
        [json.loads(line) for line in path.read_text().splitlines()]
        if path.exists()
        else []
    )
    return result, decisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    summary = summarize(*load(args.directory))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(
            f"status={summary['status']} processed={summary['processed']} frozen={summary['frozen']} "
            f"deferred_at={summary['deferred_at']} release={summary['release']}"
        )
        for phase in ("canonical", "deferred"):
            for row in summary[phase]:
                print(
                    f"{phase} {row['person_id']}: db={row['database_erased']} file={row['file_erased']} "
                    f"archives={row['archives']} residual={row['residual']} rejected={row['rejected']} "
                    f"rejected_but_erased={row['rejected_but_erased']} tables={row['erased_by_table']}"
                )
                print(
                    "   reasons", dict(Counter(row["residual_reasons"]).most_common())
                )
        print("violations:", summary["violations"] or "none")
    raise SystemExit(1 if summary["violations"] else 0)


if __name__ == "__main__":
    main()
