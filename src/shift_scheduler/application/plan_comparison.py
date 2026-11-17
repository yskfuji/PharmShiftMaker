"""Compare candidate plans (drafts) of one input with figures the data already defines.

There is no composite score. Each figure is recomputed from the input and the draft's
duty identities with the solver's own definitions (optimizer/planning.py), so a plan
the solver produced can be checked against its recorded objective values. The order
is lexicographic and stated in words; it helps a reviewer, it does not decide.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from shift_scheduler.domain.planning import Proposal, SolverSnapshot, content_hash
from shift_scheduler.validation.planning import validate

ORDER_RULE = (
    "違反の数 → 未確認の数 → 未対応の数 → 前回からの変更数 → 希望のコスト → "
    "勤務時間の差（最大と最小）の小さい順。同じ値なら作成順。"
)
MEANING = "合成の点数はありません。並びは確認の補助で、公開には確認（review）と検証が必要です。"


def changes(snapshot: SolverSnapshot, duty_ids: set[str]) -> int | None:
    """The solver's first objective: symmetric difference with the previous duties,
    and nothing when there is no previous schedule (optimizer/planning.py)."""
    previous = set(snapshot.previous_duty_ids)
    if not previous:
        return None
    return len(previous - duty_ids) + len(duty_ids - previous)


def preference_cost(snapshot: SolverSnapshot, duty_ids: set[str]) -> tuple[int, int]:
    """The solver's second objective, evaluated for fixed duties, and the number of
    preferences met by at least one assigned duty overlapping them."""
    duties = [d for d in snapshot.candidates if d.duty_id in duty_ids]
    max_rank = max((p.rank for p in snapshot.preferences), default=1)
    cost = 0
    met = 0
    for p in snapshot.preferences:
        hits = [
            d
            for d in duties
            if p.person_id == d.person_id and any(w.overlaps(p) for w in d.work)
        ]
        cost += (max_rank - p.rank + 1) * len(hits)
        met += bool(hits)
    return cost, met


def work_seconds(snapshot: SolverSnapshot, duty_ids: set[str]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for d in snapshot.candidates:
        if d.duty_id in duty_ids:
            totals[d.person_id] += d.work_seconds
    return dict(totals)


def plan_figures(
    snapshot: SolverSnapshot,
    duty_ids: tuple[str, ...],
    published: set[str] | None,
) -> dict[str, Any]:
    selected = set(duty_ids)
    report = validate(snapshot, Proposal(duty_ids=duty_ids))
    counts = {"violation": 0, "unverified": 0, "unsupported": 0}
    for finding in report.findings:
        counts[finding.status] += 1
    cost, met = preference_cost(snapshot, selected)
    seconds = work_seconds(snapshot, selected)
    return {
        "findings": counts,
        "publishable": report.publishable,
        "changes_from_previous": changes(snapshot, selected),
        "changes_from_publication": (
            None if published is None else len(published ^ selected)
        ),
        "preference_cost": cost,
        "preferences_met": met,
        "preferences_total": len(snapshot.preferences),
        "work_seconds_total": sum(seconds.values()),
        "work_seconds_spread": (
            max(seconds.values()) - min(seconds.values()) if seconds else 0
        ),
        "assignment_count": len(selected),
        "proposal_hash": content_hash(sorted(selected)),
    }


def compare(
    snapshot: SolverSnapshot,
    drafts: list[dict[str, Any]],
    published: set[str] | None,
) -> dict[str, Any]:
    """`drafts`: dicts with draft_id, duty_ids and the solver record (or None) of the
    job that produced the draft."""
    plans = []
    first_of: dict[str, str] = {}
    for draft in drafts:
        figures = plan_figures(snapshot, tuple(draft["duty_ids"]), published)
        duplicate = first_of.setdefault(figures["proposal_hash"], draft["draft_id"])
        solver = draft.get("solver")
        plans.append(
            {
                "draft_id": draft["draft_id"],
                **figures,
                "duplicate_of": None if duplicate == draft["draft_id"] else duplicate,
                "solver": solver,
            }
        )

    def key(plan: dict[str, Any]) -> tuple[int, ...]:
        f = plan["findings"]
        return (
            f["violation"],
            f["unverified"],
            f["unsupported"],
            plan["changes_from_previous"] or 0,
            plan["preference_cost"],
            plan["work_seconds_spread"],
        )

    order = [p["draft_id"] for p in sorted(plans, key=key)]
    by_id = {d["draft_id"]: set(d["duty_ids"]) for d in drafts}
    person = {d.duty_id: d.person_id for d in snapshot.candidates}
    pairs = []
    ids = [d["draft_id"] for d in drafts]
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            differing = by_id[a] ^ by_id[b]
            pairs.append(
                {
                    "a": a,
                    "b": b,
                    "differing_duties": len(differing),
                    "affected_people": len({person[d] for d in differing}),
                }
            )
    return {
        "input_hash": snapshot.input_hash,
        "plans": plans,
        "pairs": pairs,
        "order": order,
        "order_rule": ORDER_RULE,
        "meaning": MEANING,
    }
