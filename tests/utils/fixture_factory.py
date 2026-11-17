"""Utility helpers for composing `LoadedConfig` objects from YAML snippets.

New regression/property-based tests can stitch together multiple template files
under ``tests/fixtures/templates`` instead of rewriting boilerplate.  Templates
are intentionally small and declarative so that AI アシスタントでも容易に再利用でき
ます。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    DayInfo,
    HolidayRequest,
    HolidayRequestKind,
    LeaveQuota,
    Person,
    Profile,
    Role,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "templates"
_TEMPLATE_KEYS = (
    "people",
    "profiles",
    "timeline_entries",
    "shift_types",
    "holiday_requests",
    "leave_quotas",
)


def list_available_templates() -> list[str]:
    """Return the list of template basenames (without extension)."""

    if not _TEMPLATE_DIR.exists():
        return []
    return sorted(path.stem for path in _TEMPLATE_DIR.glob("*.yaml"))


def build_config_from_templates(
    template_names: Sequence[str],
    *,
    day_infos: Sequence[DayInfo],
    shift_types: Sequence[ShiftType] | None = None,
    holiday_requests: Sequence[HolidayRequest] | None = None,
    leave_quotas: Sequence[LeaveQuota] | None = None,
    profile_overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> LoadedConfig:
    """Compose a `LoadedConfig` by merging multiple template snippets.

    Parameters
    ----------
    template_names:
        YAML template basenames to load from ``tests/fixtures/templates``.
    day_infos:
        Explicit list of `DayInfo` instances for the planning horizon.
    shift_types / holiday_requests / leave_quotas:
        Optional, programmatically assembled collections that will be *prepended*
        to anything defined inside the templates.  Useful for property-based
        tests where the calendar is generated on-the-fly.
    profile_overrides:
        Mapping of ``profile_id -> dict`` to override specific fields after
        loading from YAML (e.g., max_consecutive_working_days variations).
    """

    if not template_names:
        raise ValueError("template_names must contain at least one entry")

    merged: dict[str, list[dict[str, Any]]] = {key: [] for key in _TEMPLATE_KEYS}
    for name in template_names:
        snippet = _load_template(name)
        for key in _TEMPLATE_KEYS:
            if key in snippet:
                merged[key].extend(_ensure_list(snippet[key], key))

    raw_profiles = merged["profiles"]
    if profile_overrides:
        raw_profiles = [
            _merge_with_override(item, profile_overrides) for item in raw_profiles
        ]

    people = _build_people(merged["people"])
    profiles = _build_profiles(raw_profiles)
    timeline_entries = _build_timelines(merged["timeline_entries"])

    # Allow both template-defined and programmatically constructed collections.
    effective_shift_types = list(shift_types or [])
    if merged["shift_types"]:
        effective_shift_types.extend(_build_shift_types(merged["shift_types"]))

    effective_holiday_requests = list(holiday_requests or [])
    if merged["holiday_requests"]:
        effective_holiday_requests.extend(
            _build_holiday_requests(merged["holiday_requests"])
        )

    effective_leave_quotas = list(leave_quotas or [])
    if merged["leave_quotas"]:
        effective_leave_quotas.extend(_build_leave_quotas(merged["leave_quotas"]))

    return LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=list(day_infos),
        shift_types=effective_shift_types,
        holiday_requests=effective_holiday_requests,
        leave_quotas=effective_leave_quotas,
    )


def _load_template(name: str) -> dict[str, Any]:
    path = _TEMPLATE_DIR / f"{name}.yaml"
    if not path.exists():
        available = ", ".join(list_available_templates()) or "<none>"
        raise FileNotFoundError(f"Template '{name}' not found. Available: {available}")
    with path.open("r", encoding="utf-8") as handle:
        loaded: Any = yaml.safe_load(handle) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Template '{name}' must contain a mapping at the root")
    return loaded


def _ensure_list(value: Any, key: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        items: list[dict[str, Any]] = []
        for entry in value:
            if not isinstance(entry, dict):
                raise ValueError(f"Entries under '{key}' must be mappings")
            items.append(entry)
        return items
    raise ValueError(f"'{key}' must be a list of mappings in template files")


def _parse_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise ValueError(f"Unsupported date literal: {value!r}")


def _merge_with_override(
    item: dict[str, Any], overrides: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    override = overrides.get(item.get("profile_id"))
    if not override:
        return item
    merged = dict(item)
    merged.update(override)
    return merged


def _build_people(raw_people: Sequence[dict[str, Any]]) -> list[Person]:
    return [
        Person(person_id=item["person_id"], name=item["name"], role=Role(item["role"]))
        for item in raw_people
    ]


def _build_profiles(raw_profiles: Sequence[dict[str, Any]]) -> list[Profile]:
    return [Profile(**item) for item in raw_profiles]


def _build_timelines(raw_timelines: Sequence[dict[str, Any]]) -> list[TimelineEntry]:
    entries: list[TimelineEntry] = []
    for item in raw_timelines:
        from_date = _parse_date(item["from"])
        if from_date is None:
            raise ValueError("timeline_entries require 'from' date")
        entries.append(
            TimelineEntry(
                person_id=item["person_id"],
                from_date=from_date,
                to_date=_parse_date(item.get("to")),
                profile_id=item["profile_id"],
                status=TimelineStatus(item.get("status", TimelineStatus.ACTIVE.value)),
            )
        )
    return entries


def _build_shift_types(raw_shift_types: Sequence[dict[str, Any]]) -> list[ShiftType]:
    return [ShiftType(**item) for item in raw_shift_types]


def _build_holiday_requests(
    raw_requests: Sequence[dict[str, Any]],
) -> list[HolidayRequest]:
    requests: list[HolidayRequest] = []
    for item in raw_requests:
        request_date = _parse_date(item["request_date"])
        if request_date is None:
            raise ValueError("holiday_requests require 'request_date'")
        requests.append(
            HolidayRequest(
                person_id=item["person_id"],
                request_date=request_date,
                kind=HolidayRequestKind(item["kind"]),
                order=int(item["order"]),
                is_approved=bool(item.get("is_approved", False)),
            )
        )
    return requests


def _build_leave_quotas(raw_quotas: Sequence[dict[str, Any]]) -> list[LeaveQuota]:
    quotas: list[LeaveQuota] = []
    for item in raw_quotas:
        quotas.append(
            LeaveQuota(
                person_id=item["person_id"],
                year=int(item["year"]),
                kind=HolidayRequestKind(item["kind"]),
                total_days=int(item.get("total_days", 0)),
                used_days=int(item.get("used_days", 0)),
                used_before_month=int(item.get("used_before_month", 0)),
            )
        )
    return quotas
