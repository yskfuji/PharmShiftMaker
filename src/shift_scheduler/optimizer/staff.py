"""ソルバ・分析で共通利用する職員ユーティリティ."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date

from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    EmploymentType,
    Person,
    Profile,
    TimelineEntry,
    TimelineStatus,
)


@dataclass(frozen=True)
class ActiveStaff:
    """対象期間でシフトに登場する職員とプロファイル."""

    person: Person
    profile: Profile
    active_from: date
    active_to: date

    def is_active_on(self, day: date) -> bool:
        return self.active_from <= day <= self.active_to


def extract_active_staff(
    config: LoadedConfig,
    profiles_by_id: Mapping[str, Profile],
    horizon_start: date,
    horizon_end: date,
) -> dict[str, ActiveStaff]:
    persons_by_id = {person.person_id: person for person in config.people}
    timeline_by_person: defaultdict[str, list[TimelineEntry]] = defaultdict(list)
    for timeline_entry in config.timeline_entries:
        timeline_by_person[timeline_entry.person_id].append(timeline_entry)

    active_staff: dict[str, ActiveStaff] = {}
    for person_id, person in persons_by_id.items():
        overlap = _find_overlapping_entry(
            timeline_by_person.get(person_id, []),
            horizon_start,
            horizon_end,
        )
        if overlap is None:
            continue
        entry, active_from, active_to = overlap
        profile = profiles_by_id.get(entry.profile_id)
        if profile is None or profile.employment_type == EmploymentType.LEAVE:
            continue
        active_staff[person_id] = ActiveStaff(
            person=person,
            profile=profile,
            active_from=active_from,
            active_to=active_to,
        )
    return active_staff


def _find_overlapping_entry(
    entries: Iterable[TimelineEntry] | None,
    horizon_start: date,
    horizon_end: date,
) -> tuple[TimelineEntry, date, date] | None:
    if not entries:
        return None
    best: tuple[TimelineEntry, date, date] | None = None
    best_span = -1
    for entry in entries:
        if entry.status != TimelineStatus.ACTIVE:
            continue
        entry_end = entry.to_date or date.max
        if entry.from_date > horizon_end or entry_end < horizon_start:
            continue
        overlap_start = max(entry.from_date, horizon_start)
        overlap_end = min(entry_end, horizon_end)
        span = (overlap_end - overlap_start).days + 1
        if span <= 0:
            continue
        if span > best_span:
            best = (entry, overlap_start, overlap_end)
            best_span = span
    return best


__all__ = ["ActiveStaff", "extract_active_staff"]
