"""Property checks for working-time accounting (no database needed)."""

from hypothesis import given, settings
from hypothesis import strategies as st

from shift_scheduler.validation.work_accounting import account_work
from tests.test_compliance_v2 import work_fixture

duty = st.tuples(
    st.sampled_from("AB"),
    st.integers(0, 6),
    st.integers(0, 23),
    st.integers(1, 12),
    st.integers(0, 12),
)


def build(raw):
    """Non-overlapping duties of one person; overnight and two employers a day allowed."""
    seen, spans, specs = set(), [], []
    for employer, day, hour, hours, scheduled in raw:
        start = day * 24 + hour
        end = start + hours
        if (
            (employer, day) in seen
            or end > 7 * 24
            or any(start < e and s < end for s, e in spans)
        ):
            continue
        seen.add((employer, day))
        spans.append((start, end))
        specs.append((employer, day, hour, hours, min(scheduled, hours)))
    return specs


def test_generator_reaches_overnight_and_same_day_dual_employment():
    specs = build([("A", 0, 22, 8, 8), ("A", 1, 8, 4, 4), ("B", 1, 14, 4, 4)])
    assert len(specs) == 3  # overnight into day 1, then two employers on day 1


@settings(max_examples=60, deadline=None)
@given(st.lists(duty, min_size=1, max_size=6))
def test_seconds_are_conserved_and_overtime_is_bounded(raw):
    specs = build(raw)
    data = work_fixture(specs)
    result = account_work(data, list(data.candidates))
    assert sum(r["work_seconds"] for r in result["trace"]) == sum(
        h * 3600 for *_, h, _ in specs
    )
    for row in result["trace"]:
        assert 0 <= row["overtime_seconds"] <= row["work_seconds"]
        assert (
            row["daily_overtime_seconds"] + row["weekly_overtime_seconds"]
            <= row["work_seconds"]
        )
        if row["holiday_seconds"]:
            assert row["daily_overtime_seconds"] == row["weekly_overtime_seconds"] == 0


@settings(max_examples=40, deadline=None)
@given(st.lists(duty, min_size=1, max_size=6))
def test_result_does_not_depend_on_input_order(raw):
    specs = build(raw)

    def per_employer(ordered):
        data = work_fixture(ordered)
        trace = account_work(data, list(data.candidates))["trace"]
        return sorted(
            (r["employer_id"], r["date"], r["work_seconds"], r["overtime_seconds"])
            for r in trace
        )

    assert per_employer(specs) == per_employer(list(reversed(specs)))
