"""An old backup cannot silently discard newer subject-level erasure controls."""

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from shift_scheduler.db.compliance_models import ErasedSubject, RestoreGate
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_planning_postgres import pg as _pg

pg = _pg

SECRET = b"isolated-subject-control-test-key-0000"


def manifest_for_erased_person(pg):
    with pg.begin() as session:
        session.add(
            ErasedSubject(
                facility_id="hospital",
                person_id="p0",
                plan_id="approved",
                evidence={"reference": "synthetic decision"},
            )
        )
        session.flush()
        manifest = export_manifest(session, SECRET)
        assert manifest["payload"]["version"] == 4
    # Simulate restoring a backup predating the independently retained control.
    with pg.begin() as session:
        session.execute(text("DELETE FROM erased_subjects"))
        quarantine(session)
    return manifest


def test_subject_barrier_is_reinstated_before_gate_release(pg):
    manifest = manifest_for_erased_person(pg)
    with pg.begin() as session:
        result = replay(session, manifest, content_hash(manifest), SECRET)
        assert result["state"] == "REPLAYED"
    with (
        pytest.raises(IntegrityError, match="prevents reintroduction"),
        pg.begin() as session,
    ):
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('recreated','hospital/pharmacy','p0','access','REQUESTED',1,'{}')"
            )
        )


def test_unremoved_old_copy_keeps_restore_in_quarantine(pg):
    manifest = manifest_for_erased_person(pg)
    with pg.begin() as session:
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('old','hospital/pharmacy','p0','access','REQUESTED',1,'{}')"
            )
        )
    with (
        pytest.raises(ValueError, match="operational database copies"),
        pg.begin() as session,
    ):
        replay(session, manifest, content_hash(manifest), SECRET)
    with pg() as session:
        assert session.get(RestoreGate, "restore").state == "QUARANTINED"
        assert session.scalar(text("SELECT count(*) FROM privacy_cases")) == 1
        assert not session.scalars(select(ErasedSubject)).all()
