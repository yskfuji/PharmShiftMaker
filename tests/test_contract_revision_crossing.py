"""F01: duties that cross a contract revision boundary (no database needed).

Rule under test: a duty belongs as a whole to the revision in effect at its
start; later revisions must continue without a gap and stay compatible.
"""

from datetime import timedelta

import pytest

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.contract_segments import resolve_contract
from shift_scheduler.optimizer.planning import solve
from shift_scheduler.validation.planning import contract_for, validate
from shift_scheduler.validation.v3_inputs import input_findings
from tests.test_catalogue_v3 import data


def night_payload(split=True, *, gap_hours=0, new=None, nights=3, common=None):
    """One person, nights 22:00-02:00; contract split at midnight after night 0."""
    payload = data().model_dump(mode="json")
    template = payload["duty_templates"][0]
    template.update(
        kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:nights]
    )
    base = payload["contracts"][0]
    base["allowed_kinds"] = ["NIGHT"]
    base.update(common or {})
    start = parse_snapshot(payload).period.start
    boundary = start + timedelta(days=1)
    if split:
        old = dict(base, revision_id="old", end=boundary.isoformat())
        later = dict(
            base,
            revision_id="new",
            start=(boundary + timedelta(hours=gap_hours)).isoformat(),
        )
        later.update(new or {})
        payload["contracts"] = [old, later]
    raw = parse_snapshot(payload)
    generated = generate_catalogue(raw)
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    payload["demands"] = [
        dict(
            payload["demands"][0],
            demand_id=f"night-{i}",
            start=(start + timedelta(days=i, hours=22)).isoformat(),
            end=(start + timedelta(days=i + 1, hours=2)).isoformat(),
            minimum=0,
        )
        for i in range(nights)
    ]
    return payload, generated


def first_night(generated):
    return min(generated["candidates"], key=lambda d: d["start"])


def test_crossing_night_is_generated_and_governed_by_the_starting_revision():
    payload, generated = night_payload()
    assert not generated["excluded"]
    snapshot = parse_snapshot(payload)
    crossing = next(
        d
        for d in snapshot.candidates
        if d.start < parse_snapshot(payload).contracts[0].end < d.end
    )
    assert contract_for(snapshot, crossing).revision_id == "old"
    assert not input_findings(snapshot)


def test_same_terms_split_keeps_candidate_ids():
    _, split = night_payload()
    _, whole = night_payload(split=False)
    assert sorted(d["duty_id"] for d in split["candidates"]) == sorted(
        d["duty_id"] for d in whole["candidates"]
    )


def test_kind_is_judged_on_the_governing_revision_only():
    # Only the later revision forbids NIGHT: the crossing night (governed by
    # "old") stays valid; nights starting under "new" are unavailable.
    payload, generated = night_payload(new={"allowed_kinds": ["DAY"]})
    snapshot = parse_snapshot(payload)
    crossing = next(
        d for d in snapshot.candidates if contract_for(snapshot, d).revision_id == "old"
    )
    report = validate(snapshot, _proposal(crossing.duty_id))
    assert not [
        f
        for f in report.findings
        if f.rule_id == "contract.availability" and crossing.duty_id in f.subjects
    ]
    later = [
        d for d in snapshot.candidates if contract_for(snapshot, d).revision_id == "new"
    ]
    assert later
    report = validate(snapshot, _proposal(later[0].duty_id))
    assert [f for f in report.findings if f.rule_id == "contract.availability"]


def _proposal(*ids):
    from shift_scheduler.domain.planning import Proposal

    return Proposal(duty_ids=tuple(ids))


def test_gap_between_revisions_is_explicit_and_excludes_only_that_candidate():
    payload, generated = night_payload(gap_hours=1)
    reasons = {e["reason"] for e in generated["excluded"]}
    assert reasons == {"contract_revision_gap"}
    entry = generated["excluded"][0]
    assert entry["revision_ids"] == ["old", "new"]
    # Only the crossing candidate is excluded; the V3 input is not blocked.
    assert not input_findings(parse_snapshot(payload))


@pytest.mark.parametrize(
    "change", [{"employer_id": "other-employer"}, {"regime": "flex"}]
)
def test_incompatible_revisions_are_explicit_and_do_not_block(change):
    payload, generated = night_payload(new=change)
    assert "contract_revision_incompatible" in {
        e["reason"] for e in generated["excluded"]
    }
    assert not input_findings(parse_snapshot(payload))


def test_no_successor_is_partial_coverage_and_not_blocking():
    payload = data().model_dump(mode="json")
    template = payload["duty_templates"][0]
    template.update(kind="NIGHT", start_second=22 * 3600, dates=template["dates"][:3])
    base = payload["contracts"][0]
    base["allowed_kinds"] = ["NIGHT"]
    start = parse_snapshot(payload).period.start
    base["end"] = (
        start + timedelta(days=1)
    ).isoformat()  # employment contract ends at midnight
    raw = parse_snapshot(payload)
    generated = generate_catalogue(raw)
    reasons = [e["reason"] for e in generated["excluded"]]
    assert "contract_coverage_partial" in reasons
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    assert not any(
        "not contiguous or compatible" in f.message
        for f in input_findings(parse_snapshot(payload))
    )


def test_crossing_duty_counts_fully_toward_the_governing_revision_cap():
    # "old" only allows 2 hours in the period; the crossing night (4h) is
    # attributed to "old" as a whole, so selecting it breaks the old cap.
    payload, generated = night_payload(new={"period_max_seconds": 10**7})
    payload["contracts"][0]["period_max_seconds"] = 2 * 3600
    snapshot = parse_snapshot(payload)
    crossing = next(
        d for d in snapshot.candidates if contract_for(snapshot, d).revision_id == "old"
    )
    report = validate(snapshot, _proposal(crossing.duty_id))
    assert [f for f in report.findings if f.rule_id == "contract.volume"]
    result = solve(snapshot, budget_seconds=20)
    assert (
        result.status == "OPTIMAL" and crossing.duty_id not in result.proposal.duty_ids
    )


def test_resolution_unit_cases():
    payload, _ = night_payload()
    snapshot = parse_snapshot(payload)
    crossing = next(
        d
        for d in snapshot.candidates
        if contract_for(snapshot, d).revision_id == "old"
        and d.end > snapshot.contracts[0].end
    )
    forward = resolve_contract(snapshot.contracts, crossing.relationship_id, crossing)
    backward = resolve_contract(
        tuple(reversed(snapshot.contracts)), crossing.relationship_id, crossing
    )
    assert (
        forward == backward
        and forward.reason is None
        and forward.revision_ids == ("old", "new")
    )
    inside = next(
        d
        for d in snapshot.candidates
        if d.end <= snapshot.contracts[0].end or d.start >= snapshot.contracts[1].start
    )
    assert (
        len(
            resolve_contract(
                snapshot.contracts, inside.relationship_id, inside
            ).revision_ids
        )
        == 1
    )


def test_crossing_duty_in_fixed_history_no_longer_blocks_publication():
    payload, generated = night_payload()
    snapshot = parse_snapshot(payload)
    crossing = next(
        d for d in snapshot.candidates if d.start < snapshot.contracts[0].end < d.end
    )
    history = dict(crossing.model_dump(mode="json"), source="published", fixed=True)
    payload["history"] = [*payload.get("history", []), history]
    payload["candidates"] = [
        c for c in payload["candidates"] if c["duty_id"] != crossing.duty_id
    ]
    # The work classification stays: history duties need it as candidates do.
    snapshot = parse_snapshot(payload)
    report = validate(snapshot, _proposal())
    assert not [f for f in report.findings if f.rule_id == "contract.effective"]


def test_agency_crossing_duty_must_be_within_dispatch_tasks_of_every_revision():
    evidence = data().policy_evidence.model_dump(mode="json")
    common = {
        "engagement": "agency",
        "dispatch_tasks": ["dispensing"],
        "dispatch_evidence": evidence,
    }
    payload, generated = night_payload(
        common=common, new={"dispatch_tasks": ["other-task"]}
    )
    snapshot = parse_snapshot(payload)
    crossing = next(
        d for d in snapshot.candidates if d.start < snapshot.contracts[0].end < d.end
    )
    report = validate(snapshot, _proposal(crossing.duty_id))
    assert [
        f
        for f in report.findings
        if f.rule_id == "dispatch" and crossing.duty_id in f.subjects
    ]


def test_fixed_duty_crossing_a_gap_still_blocks_publication():
    payload, _ = night_payload(split=False)
    snapshot = parse_snapshot(payload)
    boundary = snapshot.period.start + timedelta(days=1)
    crossing = next(d for d in snapshot.candidates if d.start < boundary < d.end)
    base = payload["contracts"][0]
    payload["contracts"] = [
        dict(base, revision_id="old", end=boundary.isoformat()),
        dict(
            base, revision_id="new", start=(boundary + timedelta(hours=1)).isoformat()
        ),
    ]
    payload["history"] = [
        *payload.get("history", []),
        dict(crossing.model_dump(mode="json"), source="published", fixed=True),
    ]
    payload["candidates"] = [
        c for c in payload["candidates"] if c["duty_id"] != crossing.duty_id
    ]
    report = validate(parse_snapshot(payload), _proposal())
    assert [
        f
        for f in report.findings
        if f.rule_id == "contract.effective" and "Gap" in f.message
    ]
