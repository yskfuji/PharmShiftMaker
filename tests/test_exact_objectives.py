"""Brute-force integer/Fraction oracles; no production helper computes expectations."""

from fractions import Fraction
from itertools import product
from math import lcm

import pytest
from ortools.sat.python import cp_model

from shift_scheduler.optimizer.exact_objectives import rational_objectives


def test_large_coprime_denominators_preserve_lexicographic_optimum():
    denominators = [1000000007, 1000000009, 1000000033]
    # Eight assignments; exactly one or two duties, independently enumerated.
    alternatives = []
    for choices in product([0, 1], repeat=3):
        if 1 <= sum(choices) <= 2:
            ratios = [
                Fraction(prior + selected * 17, d)
                for prior, selected, d in zip(
                    [13, 7, 3], choices, denominators, strict=True
                )
            ]
            alternatives.append(
                (
                    (
                        max(ratios),
                        sum(
                            abs(a - b)
                            for i, a in enumerate(ratios)
                            for b in ratios[i + 1 :]
                        ),
                    ),
                    choices,
                )
            )
    expected = min(score for score, _ in alternatives)
    model = cp_model.CpModel()
    variables = {str(i): model.new_bool_var(str(i)) for i in range(3)}
    model.add(sum(variables.values()) >= 1)
    model.add(sum(variables.values()) <= 2)
    common = lcm(*denominators)
    rates = [
        ("night", d, prior, {str(i): 17})
        for i, (d, prior) in enumerate(zip(denominators, [13, 7, 3], strict=True))
    ]
    upper = max((prior + 17) * (common // d) for _, d, prior, _ in rates)
    assert upper > 2**60
    encoding = {}
    levels = rational_objectives(model, rates, variables, common, upper, encoding)
    assert model.validate() == ""
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    results = []
    for level in levels:
        model.minimize(level)
        assert solver.solve(model) == cp_model.OPTIMAL
        value = solver.value(level)
        results.append(value)
        model.add(level == value)
    chosen = tuple(solver.value(variables[str(i)]) for i in range(3))
    assert (
        next(score for score, choices in alternatives if choices == chosen) == expected
    )
    split = encoding["maximum_digits"]

    def decode(digits):
        value = 0
        for digit in digits:
            value = value * 1000 + digit
        return Fraction(value, common)

    assert (decode(results[:split]), decode(results[split:])) == expected


def test_digit_representation_is_exact_for_every_assignment_including_borrows():
    rates = [("night", 7, 2, {"a": 5}), ("night", 11, 3, {"b": 9})]
    common = lcm(7, 11) * (10**30 + 123456789)
    for a, b in product([0, 1], repeat=2):
        model = cp_model.CpModel()
        variables = {key: model.new_bool_var(key) for key in ("a", "b")}
        model.add(variables["a"] == a)
        model.add(variables["b"] == b)
        encoding = {}
        levels = rational_objectives(
            model, rates, variables, common, 2 * common, encoding
        )
        solver = cp_model.CpSolver()
        assert solver.solve(model) == cp_model.OPTIMAL
        digits = [solver.value(v) for v in levels]
        split = encoding["maximum_digits"]

        def decode(parts):
            result = 0
            for value in parts:
                result = result * 1000 + value
            return Fraction(result, common)

        left, right = Fraction(2 + 5 * a, 7), Fraction(3 + 9 * b, 11)
        assert decode(digits[:split]) == max(left, right)
        assert decode(digits[split:]) == abs(left - right)


@pytest.mark.parametrize(
    "denominators,prior,kind",
    [
        ([1000000007, 1000000009, 1000000033], [14400, 28800, 0], "exact_base_digits"),
        ([1000003, 1000033, 1000037], [1, 2, 0], "scaled_integer"),
    ],
)
def test_public_solver_handles_large_normalization_without_model_invalid(
    denominators, prior, kind
):
    from datetime import timedelta

    from shift_scheduler.domain.candidate_generation import generate_catalogue
    from shift_scheduler.domain.compliance import parse_snapshot
    from shift_scheduler.optimizer.planning import solve
    from tests.test_catalogue_v3 import data

    payload = data().model_dump(mode="json")
    for i in (1, 2):
        payload["people"].append({"person_id": f"p{i}", "name": f"Synthetic {i}"})
        payload["contracts"].append(
            dict(
                payload["contracts"][0],
                person_id=f"p{i}",
                revision_id=f"c{i}",
                relationship_id=f"e{i}",
            )
        )
        payload["employments"].append(
            dict(
                payload["employments"][0],
                person_id=f"p{i}",
                revision_id=f"emp{i}",
                relationship_id=f"e{i}",
            )
        )
        payload["capabilities"].append(
            dict(payload["capabilities"][0], person_id=f"p{i}")
        )
    for contract in payload["contracts"]:
        contract["allowed_kinds"] = ["NIGHT"]
    template = payload["duty_templates"][0]
    template.update(kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:3])
    raw = parse_snapshot(payload)
    catalogue = generate_catalogue(raw)
    payload.update(
        candidates=catalogue["candidates"], work_terms=catalogue["work_terms"]
    )
    payload["demands"] = [
        dict(
            payload["demands"][0],
            demand_id=f"night-{i}",
            start=(raw.period.start + timedelta(days=i, hours=22)).isoformat(),
            end=(raw.period.start + timedelta(days=i + 1, hours=2)).isoformat(),
        )
        for i in range(3)
    ]
    payload["burden_history"] = [
        {
            "person_id": f"p{i}",
            "kind": "night",
            "seconds": prior[i],
            "eligible_seconds": d - 43200,
            "period_start": "2025-12-01",
            "period_end": "2026-01-01",
            "eligibility_evidence": payload["policy_evidence"],
        }
        for i, d in enumerate(denominators)
    ]
    snapshot = parse_snapshot(payload)

    def score(counts):
        rates = [
            Fraction(prior[i] + 14400 * counts[i], denominators[i]) for i in range(3)
        ]
        return max(rates), sum(
            abs(a - b) for i, a in enumerate(rates) for b in rates[i + 1 :]
        )

    # All 27 assignments of three non-overlapping nights to three eligible staff.
    optimum = min(
        score([owners.count(i) for i in range(3)])
        for owners in product(range(3), repeat=3)
    )
    for seed in (0, 7):
        result = solve(snapshot, 10, seed=seed)
        assert result.status == "OPTIMAL", result.diagnostics
        assert result.objective_encoding["kind"] == kind
        chosen = [
            d for d in snapshot.candidates if d.duty_id in result.proposal.duty_ids
        ]
        assert len(chosen) == 3
        assert (
            score([sum(d.person_id == f"p{i}" for d in chosen) for i in range(3)])
            == optimum
        )
        assert result.validation.publishable
        common = int(result.objective_encoding["common_denominator"])
        if kind == "scaled_integer":
            reported = tuple(
                Fraction(value, common) for value in result.objective_by_level[2:]
            )
        else:
            cut = 2 + int(result.objective_encoding["maximum_digits"])

            def decode(parts, denominator=common):
                value = 0
                for part in parts:
                    value = value * 1000 + part
                return Fraction(value, denominator)

            reported = (
                decode(result.objective_by_level[2:cut]),
                decode(result.objective_by_level[cut:]),
            )
        assert reported == optimum
