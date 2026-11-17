"""Real producer-backed job/draft/publication partitions, not invented batch JSON."""

from copy import deepcopy

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, planning
from shift_scheduler.application.shared_projection import (
    planning_record,
    preserve,
    project_archive,
    proposal,
)
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ManagedCopy,
    PreservedArchive,
)
from shift_scheduler.db.planning_models import (
    AccountMembership,
    PlanningPublication,
)
from shift_scheduler.domain.copies import DatabaseCopyReview, SharedProjectionReview
from shift_scheduler.optimizer.planning import solve
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_reviewed_planning import snapshot


def produced(factory):
    data = snapshot(3, 1)
    with factory.begin() as session:
        session.add(
            AccountMembership(
                membership_id="producer",
                issuer="oidc",
                subject="producer-account",
                person_id="operator-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        session.flush()
        planning.register_input(session, data, "producer-account", 0)
        job = planning.enqueue(
            session,
            data.input_hash,
            SCOPE,
            "producer-account",
            "real-producer-request",
            5,
        )
        job_id = job.job_id
    with factory.begin() as session:
        claimed = planning.claim_job(session)
    result = solve(data, 5)
    with factory.begin() as session:
        draft_id = planning.finish_job(session, job_id, claimed[1], result)
        review = planning.review_draft(session, draft_id, SCOPE, 1, "producer-account")
        assert review["publishable"]
        result = planning.publish(
            session,
            draft_id,
            SCOPE,
            "producer-account",
            1,
            0,
            data.input_hash,
            review["review_hash"],
            "actual-publication-key",
        )
    return job_id, draft_id, result["publication_id"]


@pytest.mark.parametrize(
    "table", ["planning_jobs", "planning_drafts", "planning_publications"]
)
@pytest.mark.parametrize(
    "order", [("operator-person", "p0"), ("p0", "operator-person")]
)
def test_producer_partitions_accounts_and_body_both_orders_with_pg_archives(
    pg, table, order
):
    produced(pg)
    with pg.begin() as session:
        copy = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("table") == table
        )
        original_hash, original_anchor = copy.content_hash, copy.anchor_at
        people = tuple(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        )
        copies.review_database_copy(
            session,
            SCOPE,
            DatabaseCopyReview(
                copy_id=copy.copy_id,
                content_hash=copy.content_hash,
                person_ids=people,
                evidence=EVIDENCE,
            ),
            copy.revision,
            "officer",
            AT,
        )
        prepared = proposal(session, copy, order[0])
        copies.review_shared_projection(
            session,
            SCOPE,
            SharedProjectionReview(
                copy_id=copy.copy_id,
                person_id=order[0],
                content_hash=copy.content_hash,
                projection_hash=prepared["payload_hash"],
                shared_text_reviewed=True,
                evidence=EVIDENCE,
            ),
            copy.revision,
            "officer",
            AT,
        )
        archive_id = preserve(session, copy, prepared, AT)
        first = session.get(PreservedArchive, archive_id)
        assert first.source_digest == original_hash
        assert copy.content_hash == original_hash
        assert not first.payload["publishable"] and not first.payload["replayable"]
        successor = project_archive(first.payload, order[1])
        assert "producer-account" not in str(successor)
        assert [p["person_id"] for p in successor["retained"]["people"]] == ["p1", "p2"]
        assert {r["person_id"] for r in successor["retained"]["subject_records"]} == {
            "p1",
            "p2",
        }
        for retained in successor["retained"]["subject_records"]:
            assert retained["data"]["person"]["person_id"] == retained["person_id"]
            assert all(
                d["person_id"] == retained["person_id"]
                for d in retained["data"]["assignments"]
            )
        tracked = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator.get("pk") == {"archive_id": archive_id}
        )
        assert tracked.anchor_at == original_anchor
        # This comparison checks successor order without mutating either original.
        reverse_first = proposal(session, copy, order[1])["payload"]
        reverse = project_archive(reverse_first, order[0])
        assert successor["retained"] == reverse["retained"]
        tampered = deepcopy(first.payload)
        target = next(r for r in tampered["retained"]["subject_records"] if r["data"])
        target["data"]["joint_prose"] = "unreviewed future format"
        with pytest.raises(ValueError, match="Unknown planning body"):
            project_archive(tampered, order[1])


def test_publication_unknown_fields_and_assignment_changes_are_not_silently_partitioned(
    pg,
):
    produced(pg)
    with pg() as session:
        table = PlanningPublication.__table__
        row = dict(session.execute(select(table)).mappings().one())
        original = deepcopy(row)
        row["payload"] = {**row["payload"], "joint_free_text": "unattributable"}
        with pytest.raises(ValueError, match="Unknown publication"):
            planning_record(session, table.name, row, "p0")
        row = deepcopy(original)
        row["payload"]["assignments"][0]["person_id"] = (
            "p2" if row["payload"]["assignments"][0]["person_id"] != "p2" else "p1"
        )
        with pytest.raises(ValueError, match="immutable proposal"):
            planning_record(session, table.name, row, "p0")
        assert dict(session.execute(select(table)).mappings().one()) == original
