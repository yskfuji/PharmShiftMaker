"""Print a regression fingerprint of the synthetic fixtures (no files are written).

Covers the approved-catalogue fixture, the remediation fixture and a 30-person,
28-day workload: input hash, generated candidates and exclusions, input
findings, solver status, objective by level, proposal and publishability.
Compare the output of two code versions to see whether a rule change moves
any planning result:

  PYTHONPATH=. python scripts/regression_fingerprint.py > before.json
"""

import json
from typing import Any


def fingerprint(snapshot: Any, solve_it: bool = True) -> dict[str, Any]:
    from shift_scheduler.domain.candidate_generation import generate_catalogue
    from shift_scheduler.optimizer.planning import solve
    from shift_scheduler.validation.planning import validate
    from shift_scheduler.validation.v3_inputs import input_findings

    out: dict[str, Any] = {"input_hash": snapshot.input_hash}
    if getattr(snapshot, "duty_templates", None):
        catalogue = generate_catalogue(snapshot)
        out["candidates"] = sorted(c["duty_id"] for c in catalogue["candidates"])
        out["excluded"] = sorted(
            (e["candidate_id"], e["reason"]) for e in catalogue["excluded"]
        )
        out["input_findings"] = sorted(f.message for f in input_findings(snapshot))
    if solve_it:
        result = solve(snapshot, budget_seconds=30)
        out["status"] = result.status
        out["objective"] = getattr(result, "objective_by_level", None)
        proposal = getattr(result, "proposal", None)
        out["proposal"] = sorted(proposal.duty_ids) if proposal else None
        if proposal:
            out["publishable"] = validate(snapshot, proposal).publishable
    return out


def main() -> int:
    from scripts.acceptance_workload import workload
    from scripts.remediation_fixture import snapshot
    from tests.test_catalogue_v3 import data

    loaded = workload(30, 28, 930011)
    result = {
        "catalogue_v3": fingerprint(data()),
        "remediation": fingerprint(snapshot()),
        "workload_30_28": fingerprint(
            loaded if not isinstance(loaded, dict) else loaded.get("snapshot", loaded),
            solve_it=False,
        ),
    }
    print(json.dumps(result, default=str, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
