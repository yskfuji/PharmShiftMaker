from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies
from shift_scheduler.application.shared_projection import proposal
from shift_scheduler.db.compliance_models import ManagedCopy, PreservedArchive
from shift_scheduler.domain.copies import SharedProjectionReview
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_projection import prepare


def review_for(session, person, *, archives=False):
    for copy in list(session.scalars(select(ManagedCopy))):
        if copy.state != "PRESENT":
            continue
        if archives:
            if copy.locator.get("table") != "preserved_archives":
                continue
        elif not copy.evidence.get("preservation_review"):
            continue
        projected = proposal(session, copy, person)
        copies.review_shared_projection(
            session,
            SCOPE,
            SharedProjectionReview(
                copy_id=copy.copy_id,
                person_id=person,
                content_hash=copy.content_hash,
                projection_hash=projected["payload_hash"],
                shared_text_reviewed=True,
                evidence=EVIDENCE,
            ),
            copy.revision,
            "reviewer",
            AT,
        )


@pytest.mark.parametrize("order", [("p0", "p1"), ("p1", "p0")])
def test_second_subject_erasure_reconstructs_only_survivor_and_keeps_retention(
    pg, order
):
    data, identity, _ = prepare(pg, people=3)
    with pg.begin() as session:
        initial = session.get(ManagedCopy, identity)
        anchor = initial.anchor_at
        review_for(session, order[0])
        plan = copies.preview(session, SCOPE, order[0], "test", AT)
        first = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
        )
        assert len(first["preserved_archive_ids"]) == 2
    with pg.begin() as session:
        review_for(session, order[1], archives=True)
        plan = copies.preview(session, SCOPE, order[1], "test", AT)
        result = copies.execute(
            session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
        )
        assert len(result["preserved_archive_ids"]) == 2
    with pg() as session:
        archives = list(session.scalars(select(PreservedArchive)))
        assert len(archives) == 2
        assert all(
            [p["person_id"] for p in a.payload["retained"]["people"]] == ["p2"]
            for a in archives
        )
        history = next(a for a in archives if "contracts" in a.payload["retained"])
        original = data.model_dump(mode="json")
        assert history.payload["retained"]["contracts"] == [
            c for c in original["contracts"] if c["person_id"] == "p2"
        ]
        for copy in session.scalars(select(ManagedCopy)):
            if (
                copy.locator.get("table") == "preserved_archives"
                and copy.state == "PRESENT"
                and copy.category == "planning_history"
            ):
                assert copy.anchor_at == anchor


def test_concurrent_erasure_of_one_plan_has_one_commit_and_no_duplicate_archives(pg):
    from shift_scheduler.application.planning import Conflict
    from shift_scheduler.db.compliance_models import CopyErasure

    prepare(pg, people=3)
    with pg.begin() as session:
        plan = copies.preview(session, SCOPE, "p0", "test", AT)
    barrier = Barrier(2)

    def execute():
        barrier.wait(timeout=10)
        try:
            with pg.begin() as session:
                result = copies.execute(
                    session, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "test", AT
                )
            return result
        except Conflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(execute) for _ in range(2)]
        results = [future.result(timeout=30) for future in futures]
    assert sum(r is not None for r in results) == 1
    with pg() as session:
        archives = list(session.scalars(select(PreservedArchive)))
        assert len(archives) == 2
        assert all(
            [p["person_id"] for p in a.payload["retained"]["people"]] == ["p1", "p2"]
            for a in archives
        )
        assert session.get(CopyErasure, plan["plan_id"]).revision == 2
