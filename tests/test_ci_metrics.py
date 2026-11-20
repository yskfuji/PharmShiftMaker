import pytest
from devtools.ci.metrics import (
    job_durations,
    percentile,
    render,
    summarize_runs,
    zero_failure_upper_bound,
)


def test_nearest_rank_percentile():
    values = [float(v) for v in range(1, 101)]
    assert percentile(values, 0.5) == 50
    assert percentile(values, 0.95) == 95
    assert percentile([7.0], 0.95) == 7
    assert percentile([], 0.5) is None


def test_zero_failure_upper_bound_matches_the_rule_of_three_region():
    assert zero_failure_upper_bound(300) == pytest.approx(0.00994, abs=1e-4)
    assert zero_failure_upper_bound(0) is None


def test_suspected_flakes_need_both_outcomes_on_one_commit():
    runs = [
        {"head_sha": "a", "conclusion": "failure"},
        {"head_sha": "a", "conclusion": "success"},  # same code, different outcome
        {"head_sha": "b", "conclusion": "failure"},
        {
            "head_sha": "b",
            "conclusion": "failure",
        },  # consistently failing: a real failure
        {"head_sha": "c", "conclusion": "success"},
        {"head_sha": "d", "conclusion": "cancelled"},  # ignored
    ]
    summary = summarize_runs(runs)
    assert summary["runs"] == 5
    assert summary["failed"] == 3
    assert summary["suspected_flaky_commits"] == ["a"]
    assert summary["flake_upper_bound_95"] is None


def test_upper_bound_reported_only_without_suspects():
    summary = summarize_runs(
        [{"head_sha": str(i), "conclusion": "success"} for i in range(300)]
    )
    assert summary["suspected_flaky_commits"] == []
    assert summary["flake_upper_bound_95"] == pytest.approx(0.00994, abs=1e-4)


def test_durations_use_successful_jobs_only_and_render_a_table():
    jobs = [
        {
            "name": "Backend",
            "conclusion": "success",
            "started_at": "2026-11-19T00:00:00Z",
            "completed_at": "2026-11-19T00:30:00Z",
        },
        {
            "name": "Backend",
            "conclusion": "failure",
            "started_at": "2026-11-19T00:00:00Z",
            "completed_at": "2026-11-19T00:01:00Z",
        },
        {
            "name": "Frontend",
            "conclusion": "success",
            "started_at": "2026-11-19T00:00:00Z",
            "completed_at": "2026-11-19T00:02:00Z",
        },
    ]
    durations = job_durations(jobs)
    assert durations == {"Backend": [30.0], "Frontend": [2.0]}
    text = render(
        summarize_runs([{"head_sha": "a", "conclusion": "success"}]), durations
    )
    assert "| Backend | 1 | 30.0 | 30.0 |" in text
