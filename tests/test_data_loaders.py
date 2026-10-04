"""YAML設定ローダーの結合テスト."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from shift_scheduler.data import loaders
from shift_scheduler.domain import (
    DayType,
    HolidayRequestKind,
    ShiftCategory,
    TimelineStatus,
)
from shift_scheduler.settings import PenaltyWeights

CONFIG_DIR = Path(__file__).resolve().parents[1] / "src" / "shift_scheduler" / "config"


def test_load_all_sample_configuration() -> None:
    """サンプル設定が正しくロードされることを確認する."""
    loaded = loaders.load_all(year=2025, month=2, config_dir=CONFIG_DIR)

    assert {person.person_id for person in loaded.people} == {
        "synthetic-pharmacist-01",
        "synthetic-pharmacist-02",
        "synthetic-pharmacist-03",
        "synthetic-pharmacist-04",
        "synthetic-pharmacist-05",
        "synthetic-pharmacist-06",
        "synthetic-pharmacist-07",
        "synthetic-pharmacist-08",
        "synthetic-pharmacist-09",
        "synthetic-pharmacist-10",
        "synthetic-pharmacist-11",
        "synthetic-pharmacist-12",
        "synthetic-pharmacist-13",
        "synthetic-pharmacist-14",
        "synthetic-pharmacist-15",
        "synthetic-pharmacist-16",
        "synthetic-pharmacist-17",
        "synthetic-pharmacist-18",
        "synthetic-pharmacist-19",
        "synthetic-pharmacist-20",
        "synthetic-assistant-01",
    }

    assert {profile.profile_id for profile in loaded.profiles} >= {
        "manager_pharmacist",
        "veteran_pharmacist",
        "weekday_pharmacist",
        "daytime_full_pharmacist",
        "weekday_newcomer",
        "newcomer_pharmacist",
        "part_time_mon_thu",
        "part_time_mon_wed_fri",
    }

    assert any(
        entry.person_id == "synthetic-pharmacist-17"
        and entry.status is TimelineStatus.LEAVE
        for entry in loaded.timeline_entries
    )

    assert len(loaded.day_infos) == 28
    assert loaded.day_infos[0].day_date.isoformat() == "2025-02-01"
    february_map = {info.day_date: info.day_type for info in loaded.day_infos}
    assert february_map[date(2025, 2, 11)] is DayType.HOLIDAY
    assert february_map[date(2025, 2, 24)] is DayType.HOLIDAY
    assert any(day.day_type is DayType.SATURDAY for day in loaded.day_infos)

    night_shift = next(
        shift for shift in loaded.shift_types if shift.shift_id == "NIGHT"
    )
    assert night_shift.category is ShiftCategory.NIGHT_DUTY
    assert night_shift.required_count == 1

    requests = {req.person_id: req for req in loaded.holiday_requests}
    assert set(requests) == {
        "synthetic-pharmacist-01",
        "synthetic-pharmacist-02",
        "synthetic-pharmacist-03",
        "synthetic-pharmacist-05",
        "synthetic-pharmacist-12",
        "synthetic-pharmacist-19",
    }
    assert (
        requests["synthetic-pharmacist-02"].kind
        is HolidayRequestKind.PAID_LEAVE_REQUEST
    )


def test_load_all_additional_month_configuration() -> None:
    """11月データでもローダーが問題なく動作することを確認する."""

    loaded = loaders.load_all(year=2025, month=11, config_dir=CONFIG_DIR)

    assert len(loaded.day_infos) == 30
    assert loaded.day_infos[0].day_date == date(2025, 11, 1)
    assert loaded.day_infos[-1].day_date == date(2025, 11, 30)

    november_map = {info.day_date: info.day_type for info in loaded.day_infos}
    assert november_map[date(2025, 11, 3)] is DayType.HOLIDAY
    assert november_map[date(2025, 11, 24)] is DayType.HOLIDAY

    request_people = {req.person_id for req in loaded.holiday_requests}
    assert request_people == {
        "synthetic-pharmacist-01",
        "synthetic-pharmacist-02",
        "synthetic-pharmacist-20",
        "synthetic-pharmacist-19",
    }

    # 祝日を含めた土日構成でも、必要シフト定義は共有されることを確認
    assert any(shift.shift_id == "WEEKEND_ONCALL" for shift in loaded.shift_types)


@pytest.mark.parametrize(
    ("year", "month", "expected_days", "holiday_dates"),
    [
        (2025, 2, 28, {date(2025, 2, 11), date(2025, 2, 24)}),
        (2025, 11, 30, {date(2025, 11, 3), date(2025, 11, 24)}),
    ],
)
def test_load_day_infos_cover_month(
    year: int, month: int, expected_days: int, holiday_dates: set[date]
) -> None:
    """カレンダーデータが月間の日付をすべてカバーすることを確認する."""

    day_infos = loaders.load_day_infos(year, month, CONFIG_DIR)
    assert len(day_infos) == expected_days

    day_map = {info.day_date: info.day_type for info in day_infos}
    for holiday in holiday_dates:
        assert day_map[holiday] is DayType.HOLIDAY

    assert any(info.day_type is DayType.SATURDAY for info in day_infos)
    assert any(info.day_type is DayType.SUNDAY for info in day_infos)


def test_loaders_can_target_individual_files() -> None:
    """個別ローダーが期待する件数を返すことを検証する."""

    holiday_requests = loaders.load_holiday_requests(2025, 2, CONFIG_DIR)
    assert {req.person_id for req in holiday_requests} == {
        "synthetic-pharmacist-01",
        "synthetic-pharmacist-02",
        "synthetic-pharmacist-03",
        "synthetic-pharmacist-05",
        "synthetic-pharmacist-12",
        "synthetic-pharmacist-19",
    }

    holiday_requests_november = loaders.load_holiday_requests(2025, 11, CONFIG_DIR)
    assert {req.person_id for req in holiday_requests_november} == {
        "synthetic-pharmacist-01",
        "synthetic-pharmacist-02",
        "synthetic-pharmacist-20",
        "synthetic-pharmacist-19",
    }

    profiles = loaders.load_profiles(CONFIG_DIR)
    assert all(
        profile.allowed_weekdays is None
        or all(0 <= d <= 6 for d in profile.allowed_weekdays)
        for profile in profiles
    )


def test_load_penalty_weights_from_rules_yaml(tmp_path: Path) -> None:
    """rules.yaml からペナルティ重みを読み込めることを検証する."""

    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "rules.yaml").write_text(
        """
penalty_weights:
  night_fairness: 99
  oncall_fairness: 88
  holiday_request_base: 42
        """.strip(),
        encoding="utf-8",
    )

    weights = loaders.load_penalty_weights(config_dir)

    assert weights.night_fairness == 99
    assert weights.oncall_fairness == 88
    # unspecified fields should fall back to defaults
    assert weights.day_shift_fairness == PenaltyWeights().day_shift_fairness
    assert weights.holiday_request_base == 42
