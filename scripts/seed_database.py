#!/usr/bin/env python3
"""Seed the PharmShift PostgreSQL database from YAML configs."""

from __future__ import annotations

import argparse
import os
from collections.abc import Iterable
from pathlib import Path

# Force YAML backend so loaders read from files even if env defaults to DB.
os.environ["SHIFT_SCHEDULER_DATA_BACKEND"] = "yaml"

import yaml
from sqlalchemy import delete

from shift_scheduler.data import loaders
from shift_scheduler.db.models import (
    HolidayRequestModel,
    LeaveQuotaModel,
    PersonModel,
    ProfileModel,
    TimelineEntryModel,
)
from shift_scheduler.db.repositories import HolidayRequestRepository
from shift_scheduler.db.session import configure_session_factory, get_session_factory

DEFAULT_CONFIG_DIR = Path("src/shift_scheduler/config")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed database from YAML configs")
    parser.add_argument("--config-dir", type=Path, default=DEFAULT_CONFIG_DIR)
    parser.add_argument("--db-url", help="Override SHIFT_SCHEDULER_DB_URL for seeding")
    parser.add_argument(
        "--echo", action="store_true", help="Enable SQL echo for troubleshooting"
    )
    parser.add_argument(
        "--holiday-month",
        action="append",
        default=[],
        metavar="YYYY-MM",
        help="Holiday request months to import (can repeat)",
    )
    parser.add_argument(
        "--holiday-all",
        action="store_true",
        help="Import every holiday_requests_YYYY_MM.yaml found under config-dir",
    )
    parser.add_argument(
        "--preserve",
        action="store_true",
        help="Keep existing rows instead of truncating tables before insert",
    )
    return parser.parse_args()


def _parse_month_token(token: str) -> tuple[int, int]:
    try:
        year_str, month_str = token.split("-", 1)
        year = int(year_str)
        month = int(month_str)
    except (ValueError, AttributeError) as exc:  # pragma: no cover - CLI validation
        raise argparse.ArgumentTypeError(f"Invalid month token: {token}") from exc
    if not (1 <= month <= 12):  # pragma: no cover - CLI validation
        raise argparse.ArgumentTypeError(f"Month must be 1-12: {token}")
    return year, month


def _discover_holiday_months(config_dir: Path) -> set[tuple[int, int]]:
    months: set[tuple[int, int]] = set()
    for path in config_dir.glob("holiday_requests_????_??.yaml"):
        name = path.stem
        # filenames are holiday_requests_<year>_<month>
        parts = name.split("_")
        if len(parts) != 4 or parts[0] != "holiday" or parts[1] != "requests":
            raise ValueError(f"Unexpected holiday request filename: {path.name}")
        _, _, year_str, month_str = parts
        months.add((int(year_str), int(month_str)))
    return months


def _purge_tables() -> None:
    session_factory = get_session_factory()
    with session_factory() as session:
        session.execute(delete(HolidayRequestModel))
        session.execute(delete(LeaveQuotaModel))
        session.execute(delete(TimelineEntryModel))
        session.execute(delete(ProfileModel))
        session.execute(delete(PersonModel))
        session.commit()


def _seed_core(config_dir: Path) -> None:
    session_factory = get_session_factory()
    people = loaders.load_people(config_dir)
    profiles = loaders.load_profiles(config_dir)
    timeline_entries = loaders.load_timeline_entries(config_dir)

    with session_factory() as session:
        for person in people:
            session.merge(
                PersonModel(
                    person_id=person.person_id, name=person.name, role=person.role.value
                )
            )
        for profile in profiles:
            session.merge(
                ProfileModel(
                    profile_id=profile.profile_id,
                    name=profile.name,
                    employment_type=profile.employment_type.value,
                    can_night_duty=profile.can_night_duty,
                    can_on_call=profile.can_on_call,
                    can_evening=profile.can_evening,
                    can_ward_alone=profile.can_ward_alone,
                    weekend_allowed=profile.weekend_allowed,
                    holiday_allowed=profile.holiday_allowed,
                    allowed_weekdays=profile.allowed_weekdays,
                    max_consecutive_working_days=profile.max_consecutive_working_days,
                    night_duty_min=profile.night_duty_min,
                    night_duty_max=profile.night_duty_max,
                    on_call_min=profile.on_call_min,
                    on_call_max=profile.on_call_max,
                    evening_min=profile.evening_min,
                    evening_max=profile.evening_max,
                )
            )
        for entry in timeline_entries:
            session.merge(
                TimelineEntryModel(
                    person_id=entry.person_id,
                    profile_id=entry.profile_id,
                    from_date=entry.from_date,
                    to_date=entry.to_date,
                    status=entry.status.value,
                )
            )
        session.commit()


def _seed_leave_quotas(config_dir: Path) -> None:
    file_path = config_dir / "staff_leave_quotas.yaml"
    if not file_path.exists():
        return
    with file_path.open("r", encoding="utf-8") as fp:
        payload = yaml.safe_load(fp) or {}
    entries = payload.get("leave_quotas", [])
    if not isinstance(entries, list):  # pragma: no cover - file validation
        raise ValueError("leave_quotas must be a list")

    session_factory = get_session_factory()
    with session_factory() as session:
        for raw in entries:
            if not isinstance(raw, dict):
                continue
            person_id = str(raw.get("person_id", ""))
            year = int(raw.get("year", 0))
            leave_type = str(raw.get("kind", ""))
            total_days = int(raw.get("total_days", 0))
            session.execute(
                delete(LeaveQuotaModel).where(
                    LeaveQuotaModel.person_id == person_id,
                    LeaveQuotaModel.year == year,
                    LeaveQuotaModel.leave_type == leave_type,
                )
            )
            session.add(
                LeaveQuotaModel(
                    person_id=person_id,
                    year=year,
                    leave_type=leave_type,
                    total_days=total_days,
                )
            )
        session.commit()


def _seed_holiday_requests(config_dir: Path, months: Iterable[tuple[int, int]]) -> None:
    session_factory = get_session_factory()
    with session_factory() as session:
        repo = HolidayRequestRepository(session)
        for year, month in months:
            requests = loaders.load_holiday_requests(year, month, config_dir)
            repo.replace_month(year, month, requests)
        session.commit()


def main() -> int:
    args = parse_args()
    config_dir = args.config_dir.resolve()
    if not config_dir.exists():  # pragma: no cover - CLI validation
        raise SystemExit(f"config-dir not found: {config_dir}")

    db_url = args.db_url
    if db_url:
        configure_session_factory(db_url, echo=args.echo)
    else:
        configure_session_factory(echo=args.echo)

    if not args.preserve:
        _purge_tables()

    _seed_core(config_dir)
    _seed_leave_quotas(config_dir)

    months: set[tuple[int, int]] = {
        _parse_month_token(token) for token in args.holiday_month
    }
    if args.holiday_all:
        months.update(_discover_holiday_months(config_dir))
    if months:
        _seed_holiday_requests(config_dir, sorted(months))

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
