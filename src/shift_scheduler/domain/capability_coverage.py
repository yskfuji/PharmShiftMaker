"""Whether verified capability records cover a whole interval, allowing renewals.

A qualification renewed as consecutive records (one ends exactly when the next
starts) is continuous. Any gap means the person is not qualified for that part:
lapsed or deferred certifications may not be used (e.g. the renewal rules of
the Japanese Society of Hospital Pharmacists). Supervision is checked per time
slice elsewhere and is unaffected.
"""

from collections.abc import Callable, Iterable
from datetime import datetime

from shift_scheduler.domain.planning import Capability, Evidence, Interval


def capability_covers(
    capabilities: Iterable[Capability],
    person_id: str,
    task: str,
    location: str,
    interval: Interval,
    verified: Callable[[Evidence, datetime], bool],
) -> bool:
    records = sorted(
        (
            c
            for c in capabilities
            if c.person_id == person_id
            and c.task == task
            and c.location == location
            and c.overlaps(interval)
            and verified(c.evidence, min(c.end, interval.end))
        ),
        key=lambda c: c.start,
    )
    covered = interval.start
    for record in records:
        if record.start > covered:
            return False
        covered = max(covered, record.end)
        if covered >= interval.end:
            return True
    return False
