"""Integration tests around configurable penalty weights."""

from __future__ import annotations

from datetime import date

import pytest

from shift_scheduler.constraints import soft_constraints
from shift_scheduler.data import LoadedConfig
from shift_scheduler.domain import (
    DayInfo,
    DayType,
    EmploymentType,
    Person,
    Profile,
    Role,
    ShiftCategory,
    ShiftType,
    TimelineEntry,
    TimelineStatus,
)
from shift_scheduler.optimizer import solve_schedule
from shift_scheduler.settings import PenaltyWeights


def _single_day_config(weight_override: PenaltyWeights) -> LoadedConfig:
    person = Person(person_id="alpha", name="Alpha", role=Role.PHARMACIST)
    profile = Profile(
        profile_id="alpha_profile",
        name="Alpha",
        employment_type=EmploymentType.FULL_TIME,
        can_night_duty=False,
        can_on_call=False,
        can_evening=False,
        can_ward_alone=True,
        weekend_allowed=True,
        holiday_allowed=True,
    )
    timeline = TimelineEntry(
        person_id=person.person_id,
        from_date=date(2025, 3, 1),
        to_date=None,
        profile_id=profile.profile_id,
        status=TimelineStatus.ACTIVE,
    )
    day_info = DayInfo(
        day_date=date(2025, 3, 5), day_type=DayType.WEEKDAY, is_business_day=True
    )
    shift = ShiftType(
        shift_id="DAY",
        name="Day",
        category=ShiftCategory.DAY_SHIFT,
        required_count=1,
        applicable_day_types=[DayType.WEEKDAY],
    )
    return LoadedConfig(
        people=[person],
        profiles=[profile],
        timeline_entries=[timeline],
        day_infos=[day_info],
        shift_types=[shift],
        holiday_requests=[],
        leave_quotas=[],
        penalty_weights=weight_override,
    )


def test_solver_passes_loaded_penalty_weights(monkeypatch: pytest.MonkeyPatch) -> None:
    """`solve_schedule` should forward penalty weights derived from the config layer."""

    captured: dict[str, PenaltyWeights] = {}

    def fake_build_objective_terms(
        *args: object, weights: PenaltyWeights, **kwargs: object
    ) -> list[int]:
        captured["weights"] = weights
        return []

    monkeypatch.setattr(
        soft_constraints, "build_objective_terms", fake_build_objective_terms
    )

    custom_weights = PenaltyWeights(night_fairness=123, holiday_request_base=77)
    config = _single_day_config(custom_weights)

    assignments = solve_schedule(config)

    assert assignments, "Solver should still produce at least one assignment"
    assert captured["weights"] == custom_weights
