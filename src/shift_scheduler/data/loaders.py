"""YAMLベースの設定ファイルを読み込み、ドメインモデルへ変換するローダー群."""

from __future__ import annotations

import os
import re
from collections import defaultdict
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, fields
from datetime import date
from pathlib import Path
from typing import Any, cast

import yaml

from shift_scheduler.domain import (
    DayInfo,
    DayType,
    EmploymentType,
    HolidayRequest,
    HolidayRequestKind,
    LeaveQuota,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)
from shift_scheduler.settings import PenaltyWeights

ScalarInt = int | str

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_DIR = BASE_DIR / "config"
ENV_CONFIG_DIR_VAR = "SHIFT_SCHEDULER_CONFIG_DIR"
YamlMapping = dict[str, Any]
DATA_BACKEND = os.getenv("SHIFT_SCHEDULER_DATA_BACKEND", "yaml").strip().lower()
USE_DB_BACKEND = DATA_BACKEND == "db"
_FIXED_CONFIG_FILENAMES = frozenset(
    {
        "rules.yaml",
        "shift_types.yaml",
        "staff_leave_quotas.yaml",
        "staff_people.yaml",
        "staff_profiles.yaml",
        "staff_timeline.yaml",
    }
)
_MONTH_CONFIG_FILENAME = re.compile(
    r"(?:calendar|holiday_requests)_[0-9]{4}_(?:0[1-9]|1[0-2])\.yaml\Z"
)


def is_db_backend() -> bool:
    """Return True when the DB backend is enabled via env overrides."""

    override = os.getenv("SHIFT_SCHEDULER_DATA_BACKEND")
    if override is None:
        return USE_DB_BACKEND
    return override.strip().lower() == "db"


_QUOTA_TRACKED_KINDS = {
    HolidayRequestKind.PAID_LEAVE_REQUEST,
    HolidayRequestKind.SUMMER_LEAVE_REQUEST,
    HolidayRequestKind.REFRESH_LEAVE_REQUEST,
}

if USE_DB_BACKEND:
    from contextlib import contextmanager

    from shift_scheduler.db.repositories import (
        ConfigRepository,
        HolidayRequestRepository,
    )
    from shift_scheduler.db.session import get_session_factory

    @contextmanager
    def _config_repo() -> Iterator[ConfigRepository]:
        """Yield a ConfigRepository bound to a new session."""

        session_factory = get_session_factory()
        session = session_factory()
        try:
            yield ConfigRepository(session)
        finally:
            session.close()

    @contextmanager
    def _holiday_request_repo() -> Iterator[HolidayRequestRepository]:
        session_factory = get_session_factory()
        session = session_factory()
        try:
            yield HolidayRequestRepository(session)
        finally:
            session.close()


@dataclass(frozen=True, slots=True)
class LoadedConfig:
    """設定ファイル一式をまとめて保持するデータ構造."""

    people: list[Person]
    profiles: list[Profile]
    timeline_entries: list[TimelineEntry]
    day_infos: list[DayInfo]
    shift_types: list[ShiftType]
    holiday_requests: list[HolidayRequest]
    leave_quotas: list[LeaveQuota]
    penalty_weights: PenaltyWeights = PenaltyWeights()


def _load_yaml(root: Path, filename: str) -> YamlMapping:
    if (
        filename not in _FIXED_CONFIG_FILENAMES
        and not _MONTH_CONFIG_FILENAME.fullmatch(filename)
    ):
        raise ValueError(f"Unsupported configuration filename: {filename!r}")
    path = root / filename
    # The root is an explicitly selected configuration capability, while the
    # appended basename is restricted to the allowlist above.
    # codeql[py/path-injection]
    if not path.exists():
        raise FileNotFoundError(path)
    # codeql[py/path-injection]
    with path.open("r", encoding="utf-8") as fh:
        loaded_raw: Any = yaml.safe_load(fh)
    if loaded_raw is None:
        loaded_raw = {}
    if not isinstance(loaded_raw, dict):
        raise ValueError(f"YAML root must be a mapping: {path}")
    return cast(YamlMapping, loaded_raw)


def _resolve_config_dir(config_dir: Path | None) -> Path:
    if config_dir is not None:
        return config_dir

    env_path = os.getenv(ENV_CONFIG_DIR_VAR)
    if env_path:
        return Path(env_path).expanduser()

    return DEFAULT_CONFIG_DIR


def _get_sequence(raw: YamlMapping, key: str) -> list[YamlMapping]:
    raw_value: object = raw.get(key, [])
    if raw_value is None:
        return []
    if isinstance(raw_value, list):
        items: list[YamlMapping] = []
        for entry in cast(Sequence[object], raw_value):
            if not isinstance(entry, dict):
                raise ValueError(f"Elements under '{key}' must be mappings")
            items.append(cast(YamlMapping, entry))
        return items
    raise ValueError(f"'{key}' must be a list")


def _parse_allowed_weekdays(value: object) -> list[int] | None:
    if value is None:
        return None
    if isinstance(value, list):
        weekdays: list[int] = []
        for day in cast(Sequence[ScalarInt], value):
            weekdays.append(int(day))
        return weekdays
    raise ValueError("allowed_weekdays must be a list of integers or null")


def _parse_date(value: Any, field_name: str) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise ValueError(f"'{field_name}' must be an ISO-format date string or date object")


def _parse_optional_date(value: Any, field_name: str) -> date | None:
    if value in (None, ""):
        return None
    return _parse_date(value, field_name)


def load_people(config_dir: Path | None = None) -> list[Person]:
    if USE_DB_BACKEND:
        with _config_repo() as repo:
            return repo.list_people()
    config_path = _resolve_config_dir(config_dir) / "staff_people.yaml"
    raw = _load_yaml(config_path.parent, config_path.name)
    return [
        Person(
            person_id=item["person_id"],
            name=item["name"],
            role=Role(item["role"]),
        )
        for item in _get_sequence(raw, "people")
    ]


def load_profiles(config_dir: Path | None = None) -> list[Profile]:
    if USE_DB_BACKEND:
        with _config_repo() as repo:
            return repo.list_profiles()
    config_path = _resolve_config_dir(config_dir) / "staff_profiles.yaml"
    raw = _load_yaml(config_path.parent, config_path.name)
    return [
        Profile(
            profile_id=item["profile_id"],
            name=item["name"],
            employment_type=EmploymentType(
                item.get("employment_type", EmploymentType.FULL_TIME.value)
            ),
            can_night_duty=bool(item.get("can_night_duty", False)),
            can_on_call=bool(item.get("can_on_call", False)),
            can_evening=bool(item.get("can_evening", True)),
            can_ward_alone=bool(item.get("can_ward_alone", True)),
            weekend_allowed=bool(item.get("weekend_allowed", True)),
            holiday_allowed=bool(item.get("holiday_allowed", True)),
            allowed_weekdays=_parse_allowed_weekdays(item.get("allowed_weekdays")),
            max_consecutive_working_days=int(
                item.get("max_consecutive_working_days", 6)
            ),
            night_duty_min=int(item.get("night_duty_min", 0)),
            night_duty_max=int(item.get("night_duty_max", 0)),
            on_call_min=int(item.get("on_call_min", 0)),
            on_call_max=int(item.get("on_call_max", 0)),
            evening_min=int(item.get("evening_min", 0)),
            evening_max=int(item.get("evening_max", 0)),
        )
        for item in _get_sequence(raw, "profiles")
    ]


def load_timeline_entries(config_dir: Path | None = None) -> list[TimelineEntry]:
    if USE_DB_BACKEND:
        with _config_repo() as repo:
            return repo.list_timeline_entries()
    config_path = _resolve_config_dir(config_dir) / "staff_timeline.yaml"
    raw = _load_yaml(config_path.parent, config_path.name)
    entries: list[TimelineEntry] = []
    for item in _get_sequence(raw, "timeline"):
        from_date = _parse_date(item["from"], "from")
        to_date = _parse_optional_date(item.get("to"), "to")
        entries.append(
            TimelineEntry(
                person_id=item["person_id"],
                from_date=from_date,
                to_date=to_date,
                profile_id=item["profile_id"],
                status=TimelineStatus(item.get("status", TimelineStatus.ACTIVE.value)),
            )
        )
    return entries


def load_shift_types(config_dir: Path | None = None) -> list[ShiftType]:
    config_path = _resolve_config_dir(config_dir) / "shift_types.yaml"
    raw = _load_yaml(config_path.parent, config_path.name)
    shift_types: list[ShiftType] = []
    for item in _get_sequence(raw, "shift_types"):
        applicable_day_types = [
            DayType(day_type) for day_type in item.get("applicable_day_types", [])
        ]
        shift_types.append(
            ShiftType(
                shift_id=item["shift_id"],
                name=item["name"],
                category=ShiftCategory(item["category"]),
                required_count=int(item.get("required_count", 1)),
                applicable_day_types=applicable_day_types,
            )
        )
    return shift_types


def load_day_infos(
    year: int, month: int, config_dir: Path | None = None
) -> list[DayInfo]:
    filename = f"calendar_{year:04d}_{month:02d}.yaml"
    config_path = _resolve_config_dir(config_dir) / filename
    raw = _load_yaml(config_path.parent, config_path.name)
    return [
        DayInfo(
            day_date=_parse_date(item["date"], "date"),
            day_type=DayType(item["day_type"]),
            is_business_day=bool(item.get("is_business_day", True)),
        )
        for item in _get_sequence(raw, "days")
    ]


def load_holiday_requests(
    year: int, month: int, config_dir: Path | None = None
) -> list[HolidayRequest]:
    if USE_DB_BACKEND:
        with _config_repo() as repo:
            return repo.list_holiday_requests(year, month)
    filename = f"holiday_requests_{year:04d}_{month:02d}.yaml"
    config_path = _resolve_config_dir(config_dir) / filename
    raw = _load_yaml(config_path.parent, config_path.name)
    requests: list[HolidayRequest] = []
    for item in _get_sequence(raw, "requests"):
        requests.append(
            HolidayRequest(
                person_id=item["person_id"],
                request_date=_parse_date(item["date"], "date"),
                kind=HolidayRequestKind(item["kind"]),
                order=int(item["order"]),
                is_approved=bool(item.get("is_approved", False)),
            )
        )
    return requests


def load_leave_quotas(
    year: int, month: int, config_dir: Path | None = None
) -> list[LeaveQuota]:
    if USE_DB_BACKEND:
        with _config_repo() as repo:
            base_entries = repo.list_leave_quotas(year)
    else:
        base_entries = _load_leave_quotas_from_yaml(_resolve_config_dir(config_dir))
    usage_before = _count_leave_usage(year, month - 1, config_dir)
    usage_including = _count_leave_usage(year, month, config_dir)
    quotas: list[LeaveQuota] = []
    for entry in base_entries:
        if entry.year != year:
            continue
        key = (entry.person_id, entry.kind)
        used_before = min(entry.total_days, usage_before.get(key, 0))
        used_total = min(entry.total_days, usage_including.get(key, used_before))
        quotas.append(
            entry.model_copy(
                update={
                    "used_days": used_total,
                    "used_before_month": used_before,
                }
            )
        )
    return quotas


def load_penalty_weights(config_dir: Path | None = None) -> PenaltyWeights:
    """Load penalty weight overrides from rules.yaml if present."""

    config_path = _resolve_config_dir(config_dir) / "rules.yaml"
    if not config_path.exists():
        return PenaltyWeights()
    raw = _load_yaml(config_path.parent, config_path.name)
    section = _extract_penalty_section(raw)
    if section is None:
        return PenaltyWeights()

    kwargs: dict[str, int] = {}
    for field in fields(PenaltyWeights):
        value = section.get(field.name)
        if value is None:
            continue
        kwargs[field.name] = int(value)
    return PenaltyWeights(**kwargs)


def _extract_penalty_section(raw: YamlMapping | None) -> YamlMapping | None:
    if not raw:
        return None
    if "penalty_weights" in raw:
        section = raw["penalty_weights"]
    else:
        rules_section = raw.get("rules")
        section = None
        if isinstance(rules_section, dict):
            section = rules_section.get("penalty_weights")
    if section is None:
        return None
    if not isinstance(section, dict):
        raise ValueError("penalty_weights must be a mapping")
    return cast(YamlMapping, section)


def _load_leave_quotas_from_yaml(config_path: Path) -> list[LeaveQuota]:
    file_path = config_path / "staff_leave_quotas.yaml"
    if not file_path.exists():
        return []
    raw = _load_yaml(file_path.parent, file_path.name)
    quotas: list[LeaveQuota] = []
    for item in _get_sequence(raw, "leave_quotas"):
        quotas.append(
            LeaveQuota(
                person_id=item["person_id"],
                year=int(item["year"]),
                kind=HolidayRequestKind(item["kind"]),
                total_days=int(item.get("total_days", 0)),
            )
        )
    return quotas


def _count_leave_usage(
    year: int, limit_month: int, config_dir: Path | None
) -> dict[tuple[str, HolidayRequestKind], int]:
    counts: dict[tuple[str, HolidayRequestKind], int] = defaultdict(int)
    if limit_month <= 0:
        return counts
    end_month = min(limit_month, 12)
    if USE_DB_BACKEND:
        with _holiday_request_repo() as repo:
            for month in range(1, end_month + 1):
                for request in repo.list_for_month(year, month):
                    if (
                        request.kind not in _QUOTA_TRACKED_KINDS
                        or not request.is_approved
                    ):
                        continue
                    counts[(request.person_id, request.kind)] += 1
    else:
        config_path = _resolve_config_dir(config_dir)
        for month in range(1, end_month + 1):
            for request in _read_yaml_holiday_requests(year, month, config_path):
                if request.kind not in _QUOTA_TRACKED_KINDS or not request.is_approved:
                    continue
                counts[(request.person_id, request.kind)] += 1
    return counts


def _read_yaml_holiday_requests(
    year: int, month: int, config_path: Path
) -> list[HolidayRequest]:
    filename = f"holiday_requests_{year:04d}_{month:02d}.yaml"
    file_path = config_path / filename
    # `year` and `month` are integers and cannot introduce path separators.
    # codeql[py/path-injection]
    if not file_path.exists():
        return []
    raw = _load_yaml(file_path.parent, file_path.name)
    requests: list[HolidayRequest] = []
    for item in _get_sequence(raw, "requests"):
        requests.append(
            HolidayRequest(
                person_id=item["person_id"],
                request_date=_parse_date(item["date"], "date"),
                kind=HolidayRequestKind(item["kind"]),
                order=int(item["order"]),
                is_approved=bool(item.get("is_approved", False)),
            )
        )
    return requests


def load_all(year: int, month: int, config_dir: Path | None = None) -> LoadedConfig:
    if USE_DB_BACKEND:
        return _load_all_from_db(year, month, config_dir)
    config_directory = _resolve_config_dir(config_dir)
    people = load_people(config_directory)
    profiles = load_profiles(config_directory)
    timeline_entries = load_timeline_entries(config_directory)
    day_infos = load_day_infos(year, month, config_directory)
    shift_types = load_shift_types(config_directory)
    holiday_requests = load_holiday_requests(year, month, config_directory)
    leave_quotas = load_leave_quotas(year, month, config_directory)
    penalty_weights = load_penalty_weights(config_directory)
    return LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=holiday_requests,
        leave_quotas=leave_quotas,
        penalty_weights=penalty_weights,
    )


def _load_all_from_db(year: int, month: int, config_dir: Path | None) -> LoadedConfig:
    with _config_repo() as repo:
        people = repo.list_people()
        profiles = repo.list_profiles()
        timeline_entries = repo.list_timeline_entries()
        holiday_requests = repo.list_holiday_requests(year, month)

    day_infos = load_day_infos(year, month, config_dir)
    shift_types = load_shift_types(config_dir)
    leave_quotas = load_leave_quotas(year, month, config_dir)
    penalty_weights = load_penalty_weights(config_dir)
    return LoadedConfig(
        people=people,
        profiles=profiles,
        timeline_entries=timeline_entries,
        day_infos=day_infos,
        shift_types=shift_types,
        holiday_requests=holiday_requests,
        leave_quotas=leave_quotas,
        penalty_weights=penalty_weights,
    )
