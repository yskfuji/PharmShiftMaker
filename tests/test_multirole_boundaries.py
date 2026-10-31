"""Independent occupation/permission counterexamples; not a full workflow acceptance."""

from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi import HTTPException

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.routers.holiday_requests import _resolve_person_id
from shift_scheduler.domain.enums import Role, ShiftCategory
from shift_scheduler.domain.occupation import (
    occupation_allows_category,
    occupation_allows_duty,
)
from shift_scheduler.domain.planning import Person, Proposal, SolverSnapshot
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import validate
from tests.fixtures.reviewed_planning import reviewed_planning_snapshot


def clerical_snapshot():
    base = reviewed_planning_snapshot(4, 1)
    roles = (Role.CLERK, Role.PHARMACIST, Role.ASSISTANT, Role.PHARMACIST)
    tasks = ("reception", "dispensing", "stock-support", "dispensing")
    return base.model_copy(
        update={
            "people": tuple(
                p.model_copy(update={"occupation": role})
                for p, role in zip(base.people, roles, strict=True)
            ),
            "demands": tuple(
                base.demands[0].model_copy(
                    update={
                        "demand_id": f"staffing-{task}",
                        "required_occupation": role,
                        "task": task,
                    }
                )
                for task, role in zip(tasks[:3], roles[:3], strict=True)
            ),
            "candidates": tuple(
                d.model_copy(update={"task": tasks[int(d.person_id[1:])]})
                for d in base.candidates
            ),
            "capabilities": tuple(
                c.model_copy(update={"task": tasks[int(c.person_id[1:])]})
                for c in base.capabilities
            ),
        }
    )


def test_old_person_serialization_and_input_hash_are_preserved():
    original = {"person_id": "p0", "name": "Person 0"}
    assert Person.model_validate(original).model_dump(mode="json") == original
    data = reviewed_planning_snapshot(1, 1)
    raw = data.model_dump(mode="json")
    assert "occupation" not in raw["people"][0]
    assert "required_occupation" not in raw["demands"][0]
    assert SolverSnapshot.model_validate(raw).input_hash == data.input_hash


def test_clerk_can_fill_explicit_clerical_demand():
    data = clerical_snapshot()
    result = solve(data, 5)
    assert result.status == "OPTIMAL"
    assert validate(data, result.proposal).publishable


@pytest.mark.parametrize("required", [Role.PHARMACIST, Role.ASSISTANT, None])
def test_verified_capability_does_not_override_occupation(required):
    data = clerical_snapshot()
    data = data.model_copy(
        update={
            "demands": (
                data.demands[0].model_copy(update={"required_occupation": required}),
            )
        }
    )
    proposal = Proposal(duty_ids=(data.candidates[0].duty_id,))
    assert not validate(data, proposal).publishable
    assert solve(data, 5).proposal is None


def test_expired_capability_does_not_become_valid_by_occupation():
    data = clerical_snapshot()
    cap = data.capabilities[0].model_copy(update={"end": data.horizon.start})
    data = data.model_copy(update={"capabilities": (cap,)})
    assert not validate(
        data, Proposal(duty_ids=(data.candidates[0].duty_id,))
    ).publishable


@pytest.mark.parametrize("role", [AppRole.STAFF, AppRole.PHARMACIST])
def test_self_service_permissions_reject_other_person(role):
    user = UserPrincipal(user_id="clerk", role=role)
    assert _resolve_person_id(None, user) == "clerk"
    with pytest.raises(HTTPException) as error:
        _resolve_person_id("other", user)
    assert error.value.status_code == 403
    assert _resolve_person_id("other", replace(user, role=AppRole.LEADER)) == "other"


@pytest.mark.parametrize("category", list(ShiftCategory))
def test_legacy_clerk_never_counts_as_clinical_staff(category):
    assert occupation_allows_category(Role.CLERK, category) == (
        category in {ShiftCategory.OFF, ShiftCategory.CLERICAL}
    )


def test_iterated_demands_do_not_lose_occupation_constraints():
    data = clerical_snapshot()
    demand = data.demands[0].model_copy(update={"required_occupation": Role.PHARMACIST})
    assert not occupation_allows_duty(
        iter(data.people), iter([demand]), data.candidates[0]
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_adjacent_clerical_demands_cover_entire_duty(reverse):
    data = clerical_snapshot()
    duty = data.candidates[0]
    split = duty.start + (duty.end - duty.start) / 2
    first = data.demands[0].model_copy(update={"end": split})
    second = first.model_copy(
        update={"demand_id": "second", "start": split, "end": duty.end}
    )
    demands = [first, second]
    if reverse:
        demands.reverse()
    assert occupation_allows_duty(data.people, iter(demands), duty)
    snapshot = data.model_copy(update={"demands": tuple(demands)})
    assert validate(snapshot, Proposal(duty_ids=(duty.duty_id,))).publishable


@pytest.mark.parametrize(
    "break_kind", ["gap", "other-task", "other-location", "other-role", "unknown-role"]
)
def test_adjacent_clerical_demands_cannot_hide_invalid_coverage(break_kind):
    data = clerical_snapshot()
    duty = data.candidates[0]
    split = duty.start + (duty.end - duty.start) / 2
    first = data.demands[0].model_copy(update={"end": split})
    changes = {
        "gap": {"start": split + timedelta(seconds=1)},
        "other-task": {"task": "dispensing"},
        "other-location": {"location": "elsewhere"},
        "other-role": {"required_occupation": Role.PHARMACIST},
        "unknown-role": {"required_occupation": None},
    }
    second = first.model_copy(
        update={
            "demand_id": "second",
            "start": split,
            "end": duty.end,
            **changes[break_kind],
        }
    )
    assert not occupation_allows_duty(data.people, [first, second], duty)
    snapshot = data.model_copy(update={"demands": (first, second)})
    assert not validate(snapshot, Proposal(duty_ids=(duty.duty_id,))).publishable
