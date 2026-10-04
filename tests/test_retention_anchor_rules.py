"""One category, two retention anchors: each row follows the rule for its own anchor."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import ManagedCopy, RetentionRule
from shift_scheduler.db.planning_models import PlanningInput, PlanningScope
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE


def policy(anchor, days=1):
    return RetentionPolicy(
        category="planning_history",
        purpose="synthetic " + anchor,
        anchor=anchor,
        retention_days=days,
        legal_minimum_days=0,
        effective_from="2030-01-01",
        effective_until="2040-01-01",
        evidence=EVIDENCE,
        owner="officer",
        next_review="2036-01-01",
    )


def test_anchor_chains_coexist_with_stable_keys_and_revisions(pg):
    with pg.begin() as s:
        first = privacy.save_rule(s, SCOPE, policy("last_activity"), 0, "officer")
        # The original key form stays for the first chain.
        assert first == {
            "key": content_hash([SCOPE, "planning_history", 1]),
            "revision": 1,
        }
        second = privacy.save_rule(s, SCOPE, policy("period_end"), 0, "officer")
        assert second["revision"] == 1 and second["key"] != first["key"]
        with pytest.raises(Conflict):
            privacy.save_rule(s, SCOPE, policy("period_end"), 0, "officer")
        privacy.save_rule(s, SCOPE, policy("period_end", 2), 1, "officer")
        assert (
            privacy.applicable_rule(s, SCOPE, "planning_history", "period_end").payload[
                "retention_days"
            ]
            == 2
        )
        assert (
            privacy.applicable_rule(s, SCOPE, "planning_history", "last_activity").key
            == first["key"]
        )
        assert (
            privacy.applicable_rule(s, SCOPE, "planning_history", "case_closed") is None
        )
        assert len(list(s.scalars(select(RetentionRule)))) == 3


@pytest.mark.parametrize(
    "rules,expected",
    [
        ((), "retention_rule_missing"),
        # A rule exists for the category, but only for another anchor.
        (("last_activity",), "retention_anchor_mismatch"),
        (("last_activity", "period_end"), None),
    ],
)
def test_period_end_rows_use_their_own_rule(pg, rules, expected):
    with pg.begin() as s:
        if not s.get(PlanningScope, SCOPE):
            s.add(PlanningScope(scope_id=SCOPE))
        s.flush()
        s.add(
            PlanningInput(
                input_hash="a" * 64,
                scope_id=SCOPE,
                input_revision=1,
                created_by="test",
                payload={
                    "person_id": "p0",
                    "period": {
                        "start": "2029-12-01T00:00:00+00:00",
                        "end": "2030-01-01T00:00:00+00:00",
                    },
                },
                created_at=datetime(2029, 12, 1, tzinfo=UTC),
            )
        )
    with pg.begin() as s:
        for anchor in rules:
            privacy.save_rule(s, SCOPE, policy(anchor), 0, "officer")
    with pg() as s:
        row = next(
            c
            for c in s.scalars(select(ManagedCopy))
            if c.locator.get("table") == "planning_inputs"
        )
        assert row.anchor == "period_end"
        target = next(
            t
            for t in copies.inventory(s, SCOPE, "p0", AT)["targets"]
            if t["copy_id"] == row.copy_id
        )
    if expected:
        assert {"retention_rule_missing", "retention_anchor_mismatch"} & set(
            target["blockers"]
        ) == {expected}
    else:
        assert not {
            "retention_rule_missing",
            "retention_anchor_mismatch",
            "retention_not_expired",
        } & set(target["blockers"])
        assert target["expires_at"].startswith("2030-01-02")
