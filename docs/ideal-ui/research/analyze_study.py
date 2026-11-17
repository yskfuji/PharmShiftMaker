"""Descriptive, uncertainty-first analysis for the pre-registered study."""

from __future__ import annotations

import csv
import math
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def wilson(successes: int, total: int, z: float = 1.95996398454) -> tuple[float, float]:
    if total == 0:
        return (math.nan, math.nan)
    p = successes / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    radius = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return centre - radius, centre + radius


def paired_bootstrap(pairs: list[tuple[float, float]], draws: int = 20_000) -> tuple[float, float, float]:
    differences = [ideal - current for current, ideal in pairs]
    if not differences:
        return (math.nan, math.nan, math.nan)
    rng = random.Random(20260930)
    samples = sorted(statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(draws))
    return statistics.mean(differences), samples[int(.025 * draws)], samples[int(.975 * draws)]


def main(path: str) -> None:
    with Path(path).open(encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if not rows or any(not row["independent_success"] for row in rows):
        raise SystemExit("Study data are blank/incomplete; no pass conclusion generated")
    groups: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        groups[(row["role"], row["task_id"], row["condition"])].append(row)
    for (role, task, condition), values in sorted(groups.items()):
        successes = sum(int(row["independent_success"]) for row in values)
        lo, hi = wilson(successes, len(values))
        errors = sum(int(row["critical_error"]) for row in values)
        print(f"{role} {task} {condition}: {successes}/{len(values)} success "
              f"(Wilson95 {lo:.3f}–{hi:.3f}), critical errors={errors}")
    for measure in ("time_seconds", "seq", "nasa_tlx", "visawi_s"):
        indexed: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
        for row in rows:
            if row[measure]:
                indexed[(row["role"], row["task_id"], row["participant_id"])][row["condition"]] = float(row[measure])
        pairs = [(values["current"], values["ideal"]) for values in indexed.values()
                 if {"current", "ideal"} <= values.keys()]
        effect, lo, hi = paired_bootstrap(pairs)
        print(f"{measure}: paired ideal-current mean={effect:.3f} bootstrap95 {lo:.3f}–{hi:.3f} n={len(pairs)}")
    for order in ("AB", "BA"):
        subset = [float(row["time_seconds"]) for row in rows if row["order"] == order and row["time_seconds"]]
        print(f"order {order}: median time={statistics.median(subset) if subset else math.nan}")


if __name__ == "__main__":
    main(sys.argv[1])
