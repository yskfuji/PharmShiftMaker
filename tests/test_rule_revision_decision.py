"""G04: a revised rule source is bound to its document and needs a publish/hold decision.

A rule review may record the SHA-256 and version of the source document. Such a
review requires one decision that names the same rule and document and the impact
listed for it (publications, grant assessments and grant records decided under an
earlier rule revision). Publication also stops when the review is overdue on the
day of publication, or when the impact changed after the decision.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.compliance_v3 import RuleReview
from shift_scheduler.validation.v3_inputs import input_findings

SHA = "a" * 64
OTHER = "b" * 64


def rules(findings):
    return sorted(f.message for f in findings if f.rule_id == "rules.v3")


def with_review(decisions=(), **review):
    payload = snapshot().model_dump(mode="json")
    payload["rule_reviews"][0].update(
        source_sha256=SHA, document_version="2026-06-19", **review
    )
    evidence = payload["policy_evidence"]
    payload["rule_decisions"] = [
        {
            "decision_id": f"d{i}",
            "review_id": "review",
            "rule_id": payload["rule_revision"],
            "source_sha256": SHA,
            "decision": "publish",
            "impact_hash": "c" * 64,
            "impact_count": 0,
            "decided_on": "2026-01-02",
            "evidence": evidence,
        }
        | d
        for i, d in enumerate(decisions)
    ]
    return parse_snapshot(payload)


def test_optional_fields_keep_stored_hashes_and_validate_the_digest():
    review = snapshot().rule_reviews[0]
    assert "source_sha256" not in review.model_dump(mode="json")
    assert "rule_decisions" not in snapshot().model_dump(mode="json")
    with pytest.raises(ValueError):
        RuleReview.model_validate(
            review.model_dump(mode="json") | {"source_sha256": "A" * 64}
        )


def test_bound_review_without_a_decision_is_unverified():
    assert rules(input_findings(snapshot())) == []
    assert rules(input_findings(with_review())) == [
        "Revised rule source has no publication decision"
    ]


def test_decision_outcomes():
    assert rules(input_findings(with_review([{}]))) == []
    assert rules(input_findings(with_review([{"decision": "hold"}]))) == [
        "Publication is held for the revised rule"
    ]
    assert rules(input_findings(with_review([{"source_sha256": OTHER}]))) == [
        "Publication decision does not match the reviewed rule source"
    ]
    assert rules(input_findings(with_review([{}, {"decision": "hold"}]))) == [
        "Publication decision does not match the reviewed rule source"
    ]
    unverified = {
        "reference": "pending",
        "status": "unverified",
        "verified_by": None,
        "valid_until": None,
    }
    assert rules(input_findings(with_review([{"evidence": unverified}]))) == [
        "Publication decision evidence is unverified"
    ]


def test_a_decision_for_another_review_does_not_count():
    assert rules(input_findings(with_review([{"review_id": "elsewhere"}]))) == [
        "Revised rule source has no publication decision"
    ]


SCOPE = "hospital/pharmacy"


def at(monkeypatch, day):
    monkeypatch.setattr(
        "shift_scheduler.application.rule_impact.today", lambda timezone: day
    )


def publish(factory, data, version, key):
    from shift_scheduler.application import planning
    from shift_scheduler.optimizer.planning import solve

    with factory.begin() as session:
        source = planning.require_input(session, data.input_hash, SCOPE)
        proposal = solve(data, 10).proposal
        assert proposal is not None
        draft = planning.new_draft(session, source, proposal, "admin")
        session.flush()
        review = planning.review_draft(session, draft.draft_id, SCOPE, 1, "admin")
        return planning.publish(
            session,
            draft.draft_id,
            SCOPE,
            "admin",
            1,
            version,
            data.input_hash,
            review["review_hash"],
            key,
        )


def publish_fixture(factory, monkeypatch, day, data=None):
    from tests.test_compliance_v3_api import prepare

    at(monkeypatch, day)
    data = data or snapshot()
    prepare(factory, data)
    return publish(factory, data, 0, "rule-publication")


def revise(factory, payload_changes=None):
    """Register an input under another rule (if given) and refresh it with the stored records."""
    from shift_scheduler.application import planning
    from shift_scheduler.db.planning_models import PlanningInput, PlanningScope

    if payload_changes is not None:
        payload = snapshot().model_dump(mode="json") | payload_changes
        with factory.begin() as session:
            revision = session.get(PlanningScope, SCOPE).input_revision
            planning.register_input(session, parse_snapshot(payload), "admin", revision)
    with factory.begin() as session:
        revision = session.get(PlanningScope, SCOPE).input_revision
        refreshed = planning.refresh_input(session, SCOPE, "admin", revision)
        return parse_snapshot(
            session.get(PlanningInput, refreshed["input_hash"]).payload
        )


def test_overdue_review_stops_publication_of_a_current_period(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.application.planning import Blocked

    payload = snapshot().model_dump(mode="json")
    payload["rule_reviews"][0]["next_review_on"] = "2026-01-06"
    # On 2026-01-07 the period (to 2026-01-12) is current and the review is overdue.
    with pytest.raises(Blocked, match="overdue since 2026-01-06"):
        publish_fixture(
            sqlite_session_factory,
            monkeypatch,
            date(2026, 1, 7),
            parse_snapshot(payload),
        )


def test_a_past_period_keeps_the_review_valid_at_that_time(
    sqlite_session_factory, monkeypatch
):
    # The fixture's review is due on 2026-02-01; a correction of the January week
    # published later is judged with the review that covered it.
    assert publish_fixture(sqlite_session_factory, monkeypatch, date(2026, 9, 26))[
        "publication_id"
    ]


def test_changing_the_rule_without_a_bound_review_stops_publication(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.application.planning import Blocked

    publish_fixture(sqlite_session_factory, monkeypatch, date(2026, 1, 5))
    plain = snapshot().rule_reviews[0].model_dump(mode="json") | {
        "review_id": "plain-v2",
        "rule_id": "general-test-v2",
    }
    # Registered through the input path, which does not ask for the source digest.
    revised = revise(
        sqlite_session_factory,
        {"rule_revision": "general-test-v2", "rule_reviews": [plain]},
    )
    with pytest.raises(Blocked, match="Rule revision changed without a review bound"):
        publish(sqlite_session_factory, revised, 1, "plain-revision")


def test_impact_listing_decision_and_publication_check(
    sqlite_session_factory, monkeypatch
):
    from shift_scheduler.api.main import app
    from shift_scheduler.application.planning import Blocked
    from shift_scheduler.application.rule_impact import rule_impact
    from shift_scheduler.db.planning_models import PlanningReceipt
    from tests.test_compliance_api import BASE, QUERY, token
    from tests.test_grant_assessment_api import assessment

    published = publish_fixture(sqlite_session_factory, monkeypatch, date(2026, 1, 5))
    at(monkeypatch, date(2030, 1, 5))  # the synthetic day of the revision
    data = snapshot()
    base = data.rule_reviews[0].model_dump(mode="json")
    revised = dict(
        base,
        review_id="r1",
        rule_id="general-test-v2",
        start="2025-12-01T00:00:00+09:00",
        end="2027-01-01T00:00:00+09:00",
        reviewed_on="2030-01-01",
        next_review_on="2031-01-01",
    )
    bound = dict(revised, source_sha256=SHA, document_version="2026-06-19")
    with sqlite_session_factory.begin() as session:
        # Another facility's assessment of an account with the same identity.
        session.add(
            PlanningReceipt(
                receipt_id="elsewhere",
                fingerprint="0" * 64,
                response={
                    "assessment": {},
                    "assessment_id": "foreign",
                    "account_id": "g0",
                    "scope_id": "clinic/pharmacy",
                    "rule_revision": "general-test-v1",
                    "as_of": "2026-01-02",
                    "status": "pass",
                },
            )
        )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)

        def post(kind, payload, key, revision=0):
            return client.post(
                BASE + "/records/" + kind + QUERY,
                headers=admin,
                json={
                    "expected_revision": revision,
                    "idempotency_key": key,
                    "payload": payload,
                },
            )

        def grade(key, assessment_id):
            context = client.get(
                BASE + "/grant-assessments/context" + QUERY, headers=admin
            ).json()
            request = assessment(context) | {"idempotency_key": key}
            request["payload"] = request["payload"] | {"assessment_id": assessment_id}
            response = client.post(
                BASE + "/grant-assessments" + QUERY, headers=admin, json=request
            )
            assert response.status_code == 200, response.text

        grade("assessment-request-1", "assess-1")  # under the earlier rule
        assert post("rule_review", revised, "rule-review-plain").status_code == 422
        assert post("rule_review", bound, "rule-review-bound").status_code == 200
        impact = client.get(BASE + "/rule-impact/r1" + QUERY, headers=admin).json()
        assert [r["account_id"] for r in impact["grant_records"]] == ["g0", "g1"]
        assert [
            (a["assessment_id"], a["rule_revision"])
            for a in impact["grant_assessments"]
        ] == [("assess-1", "general-test-v1")]
        assert [p["publication_id"] for p in impact["publications"]] == [
            published["publication_id"]
        ]
        assert impact["impact_count"] == 4
        decision = {
            "decision_id": "r1-decision",
            "review_id": "r1",
            "rule_id": "general-test-v2",
            "source_sha256": SHA,
            "decision": "publish",
            "impact_hash": "c" * 64,
            "impact_count": impact["impact_count"],
            "decided_on": "2030-01-02",
            "evidence": data.policy_evidence.model_dump(mode="json"),
        }
        stale = post("rule_decision", decision, "rule-decision-stale")
        assert stale.status_code == 422 and "影響の一覧が変わりました" in stale.text
        assert (
            post(
                "rule_decision",
                dict(decision, source_sha256=OTHER),
                "rule-decision-other",
            ).status_code
            == 422
        )
        early = post(
            "rule_decision",
            dict(decision, impact_hash=impact["impact_hash"], decided_on="2029-12-31"),
            "rule-decision-early",
        )
        assert early.status_code == 422 and "判断日" in early.text
        decision["impact_hash"] = impact["impact_hash"]
        assert (
            post("rule_decision", decision, "rule-decision-current").status_code == 200
        )
        assert (
            client.get(BASE + "/rule-impact/r1" + QUERY, headers=admin).json() == impact
        )  # read-only
        # After the decision, one more assessment under the earlier rule changes the impact.
        grade("assessment-request-2", "assess-2")
        changed = client.get(BASE + "/rule-impact/r1" + QUERY, headers=admin).json()
        assert changed["impact_count"] == 5

    # Other departments see nothing of this department's decisions under the earlier rule.
    with sqlite_session_factory() as session:
        other = rule_impact(
            session,
            "hospital/other",
            parse_snapshot(
                data.model_dump(mode="json") | {"rule_reviews": [bound]}
            ).rule_reviews[0],
        )
        assert other["impact_count"] == 0
    new_rule = {"rule_revision": "general-test-v2", "rule_reviews": [bound]}
    stale_input = revise(sqlite_session_factory, new_rule)
    with pytest.raises(
        Blocked, match="Impact of rule review r1 changed after the decision"
    ):
        publish(sqlite_session_factory, stale_input, 1, "revised-stale")
    # Hold: the input finding stops validation, so no plan is offered.
    from shift_scheduler.application.compliance import save_entity
    from shift_scheduler.optimizer.planning import solve

    with sqlite_session_factory.begin() as session:
        save_entity(
            session,
            SCOPE,
            "rule_decision",
            decision
            | {
                "decision": "hold",
                "impact_hash": changed["impact_hash"],
                "impact_count": 5,
            },
            1,
            "admin",
        )
    held = revise(sqlite_session_factory)
    assert rules(input_findings(held)) == ["Publication is held for the revised rule"]
    assert solve(held, 10).status == "BLOCKED"
    with sqlite_session_factory.begin() as session:
        save_entity(
            session,
            SCOPE,
            "rule_decision",
            decision | {"impact_hash": changed["impact_hash"], "impact_count": 5},
            2,
            "admin",
        )
    current = revise(sqlite_session_factory)
    assert publish(sqlite_session_factory, current, 1, "revised-current")[
        "publication_id"
    ]


def test_impact_cli_compares_the_downloaded_source(tmp_path):
    from scripts.rule_impact import sha256

    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-1.7 synthetic")
    import hashlib

    assert sha256(source) == hashlib.sha256(b"%PDF-1.7 synthetic").hexdigest()
