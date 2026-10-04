"""Generate demo configuration YAML files for PharmShift Scheduler."""

from __future__ import annotations

import argparse
import calendar
import random
from datetime import date
from pathlib import Path
from typing import Any

import yaml

PEOPLE = [
    {"person_id": "alice", "name": "アリス", "role": "PHARMACIST"},
    {"person_id": "bob", "name": "ボブ", "role": "PHARMACIST"},
    {"person_id": "dave", "name": "デイブ", "role": "PHARMACIST"},
    {"person_id": "emma", "name": "エマ", "role": "PHARMACIST"},
]

PROFILES = [
    {
        "profile_id": "night_full",
        "name": "夜勤可能正社員",
        "employment_type": "FULL_TIME",
        "can_night_duty": True,
        "can_on_call": False,
        "can_evening": True,
        "can_ward_alone": True,
        "weekend_allowed": True,
        "holiday_allowed": True,
        "max_consecutive_working_days": 6,
        "night_duty_min": 1,
        "night_duty_max": 3,
        "on_call_min": 0,
        "on_call_max": 0,
        "evening_min": 0,
        "evening_max": 4,
    },
    {
        "profile_id": "day_full",
        "name": "日勤のみ正社員",
        "employment_type": "FULL_TIME",
        "can_night_duty": False,
        "can_on_call": False,
        "can_evening": True,
        "can_ward_alone": True,
        "weekend_allowed": True,
        "holiday_allowed": True,
        "max_consecutive_working_days": 6,
    },
]

TIMELINES = [
    {
        "person_id": "alice",
        "from": "2024-01-01",
        "to": None,
        "profile_id": "night_full",
        "status": "ACTIVE",
    },
    {
        "person_id": "dave",
        "from": "2024-01-01",
        "to": None,
        "profile_id": "night_full",
        "status": "ACTIVE",
    },
    {
        "person_id": "emma",
        "from": "2024-01-01",
        "to": None,
        "profile_id": "night_full",
        "status": "ACTIVE",
    },
    {
        "person_id": "bob",
        "from": "2024-01-01",
        "to": None,
        "profile_id": "day_full",
        "status": "ACTIVE",
    },
]

SHIFT_TYPES = [
    {
        "shift_id": "DAY",
        "name": "日勤",
        "category": "DAY_SHIFT",
        "required_count": 1,
        "applicable_day_types": ["WEEKDAY", "HOLIDAY", "SATURDAY", "SUNDAY"],
    },
    {
        "shift_id": "NIGHT",
        "name": "夜勤",
        "category": "NIGHT_DUTY",
        "required_count": 1,
        "applicable_day_types": ["WEEKDAY"],
    },
]

DAY_TYPE_MAP = {
    0: "WEEKDAY",
    1: "WEEKDAY",
    2: "WEEKDAY",
    3: "WEEKDAY",
    4: "WEEKDAY",
    5: "SATURDAY",
    6: "SUNDAY",
}


def write_yaml(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        print(f"[skip] {path} already exists. Use --force to overwrite.")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fp:
        yaml.safe_dump(payload, fp, allow_unicode=True, sort_keys=False)
    print(f"[write] {path}")


def build_calendar(year: int, month: int) -> list[dict[str, Any]]:
    days = calendar.monthrange(year, month)[1]
    entries: list[dict[str, Any]] = []
    for day in range(1, days + 1):
        dt = date(year, month, day)
        weekday = dt.weekday()
        day_type = DAY_TYPE_MAP.get(weekday, "WEEKDAY")
        entries.append(
            {
                "date": dt.isoformat(),
                "day_type": day_type,
                "is_business_day": day_type == "WEEKDAY",
            }
        )
    return entries


def build_holiday_requests(year: int, month: int) -> list[dict[str, Any]]:
    rng = random.Random(year * 100 + month)
    days_in_month = calendar.monthrange(year, month)[1]
    requests: list[dict[str, Any]] = []
    for person in PEOPLE:
        wish_days = sorted(rng.sample(range(1, days_in_month + 1), k=2))
        for order, day in enumerate(wish_days, start=1):
            requests.append(
                {
                    "person_id": person["person_id"],
                    "date": date(year, month, day).isoformat(),
                    "kind": (
                        "PUBLIC_HOLIDAY_REQUEST" if order == 1 else "PAID_LEAVE_REQUEST"
                    ),
                    "order": order,
                    "is_approved": False,
                }
            )
    return requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate demo YAML config set")
    parser.add_argument(
        "--output", type=Path, default=Path("ops/demo_config"), help="Output directory"
    )
    parser.add_argument(
        "--year", type=int, default=date.today().year, help="Target year (e.g. 2025)"
    )
    parser.add_argument(
        "--month", type=int, default=date.today().month, help="Target month (1-12)"
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.month <= 12:
        raise SystemExit("month must be between 1 and 12")

    output_dir: Path = args.output
    calendar_file = output_dir / f"calendar_{args.year:04d}_{args.month:02d}.yaml"
    holiday_file = (
        output_dir / f"holiday_requests_{args.year:04d}_{args.month:02d}.yaml"
    )

    write_yaml(output_dir / "staff_people.yaml", {"people": PEOPLE}, force=args.force)
    write_yaml(
        output_dir / "staff_profiles.yaml", {"profiles": PROFILES}, force=args.force
    )
    write_yaml(
        output_dir / "staff_timeline.yaml", {"timeline": TIMELINES}, force=args.force
    )
    write_yaml(
        output_dir / "shift_types.yaml", {"shift_types": SHIFT_TYPES}, force=args.force
    )
    write_yaml(
        calendar_file, {"days": build_calendar(args.year, args.month)}, force=args.force
    )
    write_yaml(
        holiday_file,
        {"requests": build_holiday_requests(args.year, args.month)},
        force=args.force,
    )
    print(
        "Demo configuration ready. Point SHIFT_SCHEDULER_CONFIG_DIR to",
        output_dir.resolve(),
    )


if __name__ == "__main__":
    main()
