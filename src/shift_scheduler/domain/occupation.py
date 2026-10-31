"""Occupation limits are independent of permissions and verified capabilities."""

from collections.abc import Iterable

from .enums import Role, ShiftCategory
from .planning import Demand, Duty, Person


def occupation_allows_duty(
    people: Iterable[Person], demands: Iterable[Demand], duty: Duty
) -> bool:
    person = next((p for p in people if p.person_id == duty.person_id), None)
    if person is None:
        return False
    matching = [
        d
        for d in demands
        if d.task == duty.task and d.location == duty.location and d.overlaps(duty)
    ]
    # New clerical assignments require an explicitly classified staffing demand.
    # An unclassified legacy demand is not evidence of permission.
    if person.occupation == Role.CLERK:
        covered_until = duty.start
        for demand in sorted(matching, key=lambda item: item.start):
            if demand.required_occupation != Role.CLERK:
                continue
            if demand.start > covered_until:
                return False
            covered_until = max(covered_until, demand.end)
        if covered_until < duty.end:
            return False
    return all(
        person.occupation == demand.required_occupation
        for demand in matching
        if demand.required_occupation is not None
    )


def occupation_allows_category(role: Role, category: ShiftCategory) -> bool:
    """Legacy inputs have no capability evidence: never infer extra clinical duties."""
    if category == ShiftCategory.OFF:
        return True
    if role == Role.CLERK:
        return category == ShiftCategory.CLERICAL
    if category == ShiftCategory.CLERICAL:
        return False
    if role == Role.ASSISTANT:
        return category == ShiftCategory.DAY_SHIFT
    return True
