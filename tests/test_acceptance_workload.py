"""Development seeds excluded from any eventual held-out performance assessment."""

from collections import Counter

from scripts.acceptance_workload import workload

from shift_scheduler.application.planning import register_input
from shift_scheduler.validation.v3_inputs import input_findings
from tests.test_reviewed_planning import db as _db

db = _db


def test_profiles_have_nonempty_boundaries_recording_evidence_and_independent_history():
    for seed in (930020, 930021):
        s = workload(30, 28, seed)
        assert not input_findings(s)
        assert s.accounting_transitions and s.management_models and s.grant_amendments
        assert len(s.ledger_recordings) == len(s.leave_accounts) + len(s.leave_records)
        assert any(t.employment_revision_ids for t in s.work_terms)
        history = Counter()
        for d in s.history:
            if d.duty_id.startswith("burden-"):
                assert (
                    d.start.hour == 22
                    and d.end.hour == 23
                    and d.start.date() == d.end.date()
                )
                history[d.person_id] += int((d.end - d.start).total_seconds())
        assert history == Counter({p.person_id: 12 * 3600 for p in s.people})
        for p in s.people:
            for kind in ("night", "holiday"):
                assert (
                    sum(
                        h.seconds
                        for h in s.burden_history
                        if h.person_id == p.person_id and h.kind == kind
                    )
                    == 12 * 3600
                )
        if seed % 2 == 0:
            assert any(
                sum(w.end_seconds - w.start_seconds for w in t.work) == 8 * 3600
                for t in s.duty_templates
            )
            assert any(d.demand_id.startswith("afternoon-") for d in s.demands)


def test_distinct_cases_do_not_redefine_authoritative_sites_or_rule_reviews(db):
    for revision, (days, seed, lookahead) in enumerate(
        [(28, 930022, 7), (29, 930023, 14), (29, 930023, 28)]
    ):
        with db.begin() as s:
            register_input(s, workload(30, days, seed, lookahead), "audit", revision)
