"""Database trigger coverage includes raw SQL writes outside the API/ORM path."""

import pytest
from scripts.remediation_fixture import snapshot
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from shift_scheduler.application.planning import register_input
from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject, ManagedCopy
from tests.test_planning_postgres import pg as _pg

pg = _pg


def test_raw_sql_copy_is_registered_and_changed_version_invalidates_review(pg):
    with pg.begin() as session:
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('case','hospital/pharmacy','p0','access','REQUESTED',1,CAST(:payload AS json))"
            ),
            {"payload": '{"reason":"synthetic free text"}'},
        )
    with pg.begin() as session:
        copy = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator["table"] == "privacy_cases"
        )
        assert copy.medium == "database" and copy.subject_status == "UNVERIFIED"
        assert list(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        ) == ["p0"]
        old_hash = copy.content_hash
        copy.subject_status = "VERIFIED"
        copy.evidence = {
            "reference": "reviewed free text subjects",
            "status": "verified",
            "verified_by": "officer",
        }
    with pg.begin() as session:
        session.execute(
            text(
                "UPDATE privacy_cases SET payload=CAST(:payload AS json), revision=2 WHERE case_id='case'"
            ),
            {"payload": '{"reason":"changed synthetic free text"}'},
        )
    with pg() as session:
        changed = session.get(ManagedCopy, copy.copy_id)
        assert changed.revision == 2 and changed.content_hash != old_hash
        assert changed.subject_status == "UNVERIFIED"


def test_typed_input_relationship_registers_all_snapshot_people(pg):
    data = snapshot()
    with pg.begin() as session:
        register_input(session, data, "synthetic", 0)
        session.execute(
            text(
                "INSERT INTO planning_jobs(job_id,input_hash,status,requested_by,request_key,budget_seconds,attempts,created_at) VALUES ('job',:input,'QUEUED','synthetic','key',20,0,now())"
            ),
            {"input": data.input_hash},
        )
    with pg() as session:
        copy = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator["table"] == "planning_jobs"
        )
        assert copy.scope_id == "hospital/pharmacy"
        assert set(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        ) == {"p0", "p1"}


def test_erasure_control_prevents_raw_sql_reintroduction(pg):
    with pg.begin() as session:
        session.add(
            ErasedSubject(
                facility_id="hospital",
                person_id="p0",
                plan_id="approved-erasure",
                evidence={"reference": "synthetic accepted decision"},
            )
        )
    with (
        pytest.raises(IntegrityError, match="prevents reintroduction"),
        pg.begin() as session,
    ):
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('returned','hospital/pharmacy','p0','access','REQUESTED',1,'{}')"
            )
        )
    with pg() as session:
        assert not session.scalar(text("SELECT count(*) FROM privacy_cases"))


def test_review_binds_revision_and_cannot_erase_structured_owner(pg):
    from shift_scheduler.application.copies import (
        execute,
        preview,
        review_database_copy,
    )
    from shift_scheduler.application.planning import Conflict
    from shift_scheduler.domain.copies import DatabaseCopyReview

    with pg.begin() as session:
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('case','hospital/pharmacy','p0','access','COMPLETED',1,'{}')"
            )
        )
    with pg.begin() as session:
        row = next(
            c
            for c in session.scalars(select(ManagedCopy))
            if c.locator["table"] == "privacy_cases"
        )
        item = DatabaseCopyReview(
            copy_id=row.copy_id,
            content_hash=row.content_hash,
            person_ids=("p0", "p1"),
            evidence=snapshot().policy_evidence,
        )
        with pytest.raises(ValueError, match="cannot be removed"):
            review_database_copy(
                session,
                "hospital/pharmacy",
                item.model_copy(update={"person_ids": ("p1",)}),
                1,
                "officer",
            )
        result = review_database_copy(session, "hospital/pharmacy", item, 1, "officer")
        assert result["revision"] == 2
    with pg.begin() as session:
        with pytest.raises(Conflict):
            review_database_copy(session, "hospital/pharmacy", item, 1, "officer")
        plan = preview(session, "hospital/pharmacy", "p0", "officer")
    # The preview's own retained audit row must not invalidate its fingerprint.
    with pg.begin() as session:
        outcome = execute(
            session,
            "hospital/pharmacy",
            plan["plan_id"],
            plan["fingerprint"],
            1,
            "officer",
        )
        assert outcome["queued_copy_ids"] == []
        assert (
            "shared_copy_requires_separate_preservation_decision"
            in outcome["targets"][0]["blockers"]
        )


def test_typed_graph_does_not_treat_matching_prose_as_subject(pg):
    from shift_scheduler.application.copy_graph import database_inventory

    with pg.begin() as session:
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('case','hospital/pharmacy','p1','access','REQUESTED',1,CAST(:payload AS json))"
            ),
            {"payload": '{"reason":"p0"}'},
        )
        session.execute(
            text(
                "INSERT INTO planning_outbox(event_id,kind,scope_id,actor,payload,created_at) VALUES ('audit','privacy.request','hospital/pharmacy','synthetic',CAST(:payload AS json),now())"
            ),
            {"payload": '{"case_id":"case"}'},
        )
    with pg() as session:
        assert database_inventory(session, "hospital/pharmacy", "p0")["records"] == []
        result = database_inventory(session, "hospital/pharmacy", "p1")
        assert {r["table"] for r in result["records"]} == {
            "privacy_cases",
            "planning_outbox",
        }
        assert (
            next(r for r in result["records"] if r["table"] == "planning_outbox")[
                "references"
            ][0]["kind"]
            == "logical_json"
        )
