"""Planned periods and checked contexts are whole calendar days in Japan time.

A day is the calendar day 00:00-24:00 (昭63.1.1基発1号); statutory holidays are
calendar days. Rules that count days (holidays, four-week windows, month anchors,
consecutive days, burden spans) are wrong for a boundary inside a day, so such an
input is refused as unsupported. An instant written with another offset is refused
too: dates would otherwise be read in that offset.
"""

from datetime import datetime, timedelta

import pytest
from scripts.remediation_fixture import snapshot

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import input_findings


def boundary_findings(data):
    return sorted(
        f.message for f in input_findings(data) if f.rule_id == "period.boundary"
    )


def with_period_end(end):
    payload = snapshot().model_dump(mode="json")
    payload["period"]["end"] = end
    return parse_snapshot(payload)


def test_midnight_boundaries_pass():
    assert boundary_findings(snapshot()) == []


def test_a_period_ending_inside_a_day_is_unsupported_and_blocks_planning():
    data = with_period_end("2026-01-12T01:00:00+09:00")
    assert boundary_findings(data) == [
        "The period end must be midnight in Japan time (+09:00)"
    ]
    assert all(
        f.status == "unsupported"
        for f in input_findings(data)
        if f.rule_id == "period.boundary"
    )
    assert solve(data, 5).status == "BLOCKED"


@pytest.mark.parametrize(
    "end",
    [
        "2026-01-12T00:00:00+00:00",  # midnight UTC is 09:00 in Japan
        "2026-01-11T15:00:00+00:00",  # the same instant as Japan midnight, written in UTC
    ],
)
def test_other_offsets_are_refused(end):
    assert boundary_findings(with_period_end(end)) == [
        "The period end must be midnight in Japan time (+09:00)"
    ]


def test_context_boundaries_are_checked_too():
    payload = snapshot().model_dump(mode="json")
    start = datetime.fromisoformat(payload["context"]["start"]) + timedelta(hours=6)
    payload["context"]["start"] = start.isoformat()
    assert boundary_findings(parse_snapshot(payload)) == [
        "The context start must be midnight in Japan time (+09:00)"
    ]


def test_the_wide_export_groups_duties_by_the_japan_date():
    # 15:00 UTC on Jan 5 is 00:00 on Jan 6 in Japan: the duty belongs to Jan 6.
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from scripts.remediation_fixture import snapshot

    from shift_scheduler.application.publication_artifacts import render

    template = next(d for d in snapshot().candidates if d.person_id).model_dump(
        mode="json"
    )
    shift = datetime(2026, 1, 5, 15, tzinfo=UTC) - datetime.fromisoformat(
        template["start"]
    )

    def moved(value):
        # Every instant moved by the same amount and written with a +00:00 offset.
        if isinstance(value, dict):
            return {
                k: (
                    (datetime.fromisoformat(v) + shift).astimezone(UTC).isoformat()
                    if k in ("start", "end")
                    else moved(v)
                )
                for k, v in value.items()
            }
        return [moved(v) for v in value] if isinstance(value, list) else value

    duty = moved(template)
    publication = SimpleNamespace(
        publication_id="pub",
        period_key="2026-01",
        version=1,
        payload={"assignments": [duty], "input_hash": "h", "rule_revision": "r"},
    )
    rows = render(publication, "csv-wide").decode().splitlines()
    assert rows[1].startswith("2026-01-06,")
