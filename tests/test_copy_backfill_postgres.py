"""Pre-trigger rows are registered without rewriting business content/reviews."""

import importlib.util
from pathlib import Path

from sqlalchemy import select, text

from shift_scheduler.db.compliance_models import ManagedCopy
from tests.test_planning_postgres import pg as _pg

pg = _pg


def backfill(connection):
    path = Path("alembic/versions/20260922_0007_backfill_copy_inventory.py")
    spec = importlib.util.spec_from_file_location("backfill_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.backfill(connection)


def test_old_row_backfill_preserves_values_and_is_idempotent(pg):
    with pg.begin() as session:
        session.execute(
            text("ALTER TABLE privacy_cases DISABLE TRIGGER pharmshift_copy_write")
        )
        session.execute(
            text(
                "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('old','hospital/pharmacy','p0','access','REQUESTED',1,'{}')"
            )
        )
        session.execute(
            text("ALTER TABLE privacy_cases ENABLE TRIGGER pharmshift_copy_write")
        )
        before = session.scalar(
            text("SELECT to_jsonb(p)::text FROM privacy_cases p WHERE case_id='old'")
        )
        assert backfill(session.connection())["privacy_cases"] == 1
        assert before == session.scalar(
            text("SELECT to_jsonb(p)::text FROM privacy_cases p WHERE case_id='old'")
        )
        row = session.scalars(select(ManagedCopy)).one()
        assert row.subject_status == "UNVERIFIED"
        row.subject_status = "VERIFIED"
        row.evidence = {"reference": "synthetic exact-version review"}
        session.flush()
        version, hash_ = row.revision, row.content_hash
        assert sum(backfill(session.connection()).values()) == 0
        session.expire_all()
        assert row.subject_status == "VERIFIED" and (
            row.revision,
            row.content_hash,
        ) == (version, hash_)
