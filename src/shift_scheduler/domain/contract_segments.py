"""Which contract revision governs a duty (single place for the attribution rule).

Rule: a duty belongs as a whole to the revision in effect at its start time for
the contractual terms checked here (kinds, weekdays, volume, rest, consecutive
days). This follows the treatment of continuous work spanning two calendar days
as work of the day on which it started (昭63.1.1基発1号). That notice concerns
counting the "day" of the daily limit; applying it to contractual terms is an
analogy recorded as needing HR/legal review.

Aspects decided by the clock are NOT attributed to the start: statutory holidays
are calendar days, night work is decided by the hour (Art. 37(4)), and a 36協定
covers work during its own validity. The V2/V3 accounting
(validation/work_accounting.py) therefore splits a duty at revision boundaries
and at midnight, counts the daily limit on the start day, and requires each part
to be covered by the agreement in force at that time (tests/test_duty_attribution.py).
The legacy V1 accounting has no holiday calendar and stops cross-midnight
overtime/holiday attribution as unsupported. Wage rates are left to the payroll
system (L08), which receives the split parts.

A duty that runs past the end of its governing revision is only accepted when
the following revisions continue without a gap and keep the same employer,
place, engagement and working-time regime. Otherwise a specific reason is
returned so the caller never drops the duty silently. Dispatch scope is not
attributed: an agency duty must be within the dispatch tasks of every revision
it runs into (dispatch_tasks_for).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from shift_scheduler.domain.planning import ContractRevision, Interval

Reason = Literal[
    "no_effective_contract",
    "contract_coverage_partial",
    "contract_revision_gap",
    "contract_revision_incompatible",
]
# Reasons that indicate inconsistent contract data rather than a normal edge.
DATA_INCONSISTENT = frozenset(
    {"contract_revision_gap", "contract_revision_incompatible"}
)
_SAME = (
    "person_id",
    "employer_id",
    "facility_id",
    "department_id",
    "engagement",
    "regime",
)


@dataclass(frozen=True)
class ContractResolution:
    governing: ContractRevision | None
    reason: Reason | None
    revision_ids: tuple[str, ...]
    chain: tuple[
        ContractRevision, ...
    ] = ()  # governing and following revisions the duty runs into


def resolve_contract(
    contracts: Iterable[ContractRevision],
    relationship_id: str,
    interval: Interval,
    person_id: str | None = None,
) -> ContractResolution:
    chain = sorted(
        (
            c
            for c in contracts
            if c.relationship_id == relationship_id
            and (person_id is None or c.person_id == person_id)
            and c.overlaps(interval)
        ),
        key=lambda c: c.start,
    )
    ids = tuple(c.revision_id for c in chain)
    starting = [c for c in chain if c.start <= interval.start < c.end]
    if len(starting) != 1:
        return ContractResolution(None, "no_effective_contract", ids)
    governing = starting[0]
    if interval.end <= governing.end:
        return ContractResolution(
            governing, None, (governing.revision_id,), (governing,)
        )
    cursor, used = governing, [governing]
    for following in (c for c in chain if c.start >= governing.end):
        if following.start != cursor.end:
            return ContractResolution(None, "contract_revision_gap", ids)
        if any(getattr(following, f) != getattr(governing, f) for f in _SAME):
            return ContractResolution(None, "contract_revision_incompatible", ids)
        cursor = following
        used.append(following)
        if interval.end <= cursor.end:
            return ContractResolution(governing, None, ids, tuple(used))
    return ContractResolution(None, "contract_coverage_partial", ids)


def dispatch_tasks_for(resolution: ContractResolution) -> set[str]:
    """Tasks allowed across every revision a duty runs into (dispatch is not attributed)."""
    tasks: set[str] | None = None
    for revision in resolution.chain:
        allowed = set(revision.dispatch_tasks)
        tasks = allowed if tasks is None else tasks & allowed
    return tasks or set()
