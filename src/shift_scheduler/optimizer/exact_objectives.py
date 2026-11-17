"""Nonnegative arbitrary-size integer objectives encoded as bounded base digits.

Each carry equality is exact. Optimising most-significant digits first with
proved optima fixed is equivalent to minimising the represented integer.
"""

from collections.abc import Sequence
from typing import Any

# CP-SAT model and variable objects are typed as Any here: the expressions mix
# Python ints, IntVar and linear expressions, which OR-Tools does not type.
Rate = tuple[str, int, int, dict[str, int]]

BASE = 1000


def width_for(upper: int) -> int:
    width = 1
    while upper >= BASE:
        upper //= BASE
        width += 1
    return width


def linear_digits(
    model: Any,
    terms: Sequence[tuple[int, Any, int]],
    constant: int,
    width: int,
    name: str,
) -> list[Any]:
    """terms contain (nonnegative Python-int coefficient, variable, upper bound)."""
    digits: list[Any] = []
    carry: Any = 0
    carry_upper = 0
    for i in range(width):
        power = BASE**i
        constant_digit = (constant // power) % BASE
        pieces = [
            ((coefficient // power) % BASE, variable, bound)
            for coefficient, variable, bound in terms
        ]
        upper = constant_digit + carry_upper + sum(c * bound for c, _, bound in pieces)
        if upper >= 2**60:
            raise ValueError("Digit column exceeds the supported CP-SAT integer domain")
        digit = model.new_int_var(0, BASE - 1, f"{name}_digit_{i}")
        next_upper = upper // BASE
        next_carry = (
            model.new_int_var(0, next_upper, f"{name}_carry_{i}")
            if i + 1 < width
            else 0
        )
        model.add(
            constant_digit + sum(c * var for c, var, _ in pieces) + carry
            == digit + BASE * next_carry
        )
        digits.append(digit)
        carry, carry_upper = next_carry, next_upper
    return digits


def absolute_digits(
    model: Any, left: Sequence[Any], right: Sequence[Any], name: str
) -> tuple[list[Any], Any]:
    """Return |left-right| and a Boolean witnessing left >= right (ties arbitrary)."""
    positive = model.new_bool_var(name + "_positive")
    carry: Any = 0
    digits: list[Any] = []
    for i, (a, b) in enumerate(zip(left, right, strict=True)):
        digit = model.new_int_var(0, BASE - 1, f"{name}_digit_{i}")
        next_carry = (
            model.new_int_var(-1, 0, f"{name}_carry_{i}") if i + 1 < len(left) else 0
        )
        model.add(a - b + carry == digit + BASE * next_carry).only_enforce_if(positive)
        model.add(b - a + carry == digit + BASE * next_carry).only_enforce_if(
            positive.Not()
        )
        digits.append(digit)
        carry = next_carry
    return digits, positive


def rational_objectives(
    model: Any,
    rates: Sequence[Rate],
    variables: dict[str, Any],
    common: int,
    upper: int,
    encoding: dict[str, Any],
) -> tuple[Any, ...]:
    width = width_for(upper)
    normalized: list[tuple[str, list[Any]]] = []
    for index, (kind, denominator, previous, coefficients) in enumerate(rates):
        factor = common // denominator
        digits = linear_digits(
            model,
            [(c * factor, variables[key], 1) for key, c in coefficients.items()],
            previous * factor,
            width,
            f"rate_{index}",
        )
        normalized.append((kind, digits))
    maximum = normalized[0][1]
    for index, (_, digits) in enumerate(normalized[1:]):
        _, left_larger = absolute_digits(model, maximum, digits, f"max_order_{index}")
        merged = [
            model.new_int_var(0, BASE - 1, f"max_{index}_{i}") for i in range(width)
        ]
        for a, b, c in zip(maximum, digits, merged, strict=True):
            model.add(c == a).only_enforce_if(left_larger)
            model.add(c == b).only_enforce_if(left_larger.Not())
        maximum = merged
    differences: list[list[Any]] = []
    for i, (kind, left) in enumerate(normalized):
        for other_kind, right in normalized[i + 1 :]:
            if kind == other_kind:
                delta, _ = absolute_digits(
                    model, left, right, f"difference_{len(differences)}"
                )
                differences.append(delta)
    deviation_width = width_for(upper * len(differences))
    deviation = linear_digits(
        model,
        [
            (BASE**i, digit, BASE - 1)
            for digits in differences
            for i, digit in enumerate(digits)
        ],
        0,
        deviation_width,
        "deviation",
    )
    encoding.update(
        kind="exact_base_digits",
        base=BASE,
        common_denominator=str(common),
        maximum_digits=width,
        deviation_digits=deviation_width,
        order="changes, preferences, maximum MSD..LSD, deviation MSD..LSD",
    )
    return (*reversed(maximum), *reversed(deviation))
