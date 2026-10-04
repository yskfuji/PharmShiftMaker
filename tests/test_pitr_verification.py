import hashlib

import pytest
from scripts.pitr_verification import (
    durable_copy,
    is_explicit_hba_rejection,
    snapshot_database,
)
from sqlalchemy import text
from sqlalchemy.exc import OperationalError


def test_all_actual_tables_columns_and_constraints(pg):
    engine = pg.kw["bind"]
    with engine.begin() as c:
        c.execute(
            text(
                "CREATE TABLE unknown_notice_receipt(id integer PRIMARY KEY, payload text NOT NULL CHECK(length(payload)>0))"
            )
        )
        c.execute(
            text(
                "INSERT INTO unknown_notice_receipt VALUES(1,'published'),(2,'receipt')"
            )
        )
    from shift_scheduler.db.planning_models import PlanningReceipt

    with pg.begin() as session:
        session.add(
            PlanningReceipt(
                receipt_id="pitr-receipt",
                fingerprint="f" * 64,
                response={"published": True},
            )
        )
    before = snapshot_database(pg)
    assert "unknown_notice_receipt" in before["tables"]
    assert before == snapshot_database(pg)
    with engine.begin() as c:
        c.execute(
            text(
                "UPDATE unknown_notice_receipt SET payload='changed notice' WHERE id=1"
            )
        )
    with pg.begin() as session:
        session.get(PlanningReceipt, "pitr-receipt").response = {"published": False}
    updated = snapshot_database(pg)
    assert (
        before["tables"]["planning_receipts"]["rows_sha256"]
        != updated["tables"]["planning_receipts"]["rows_sha256"]
    )
    assert (
        before["tables"]["unknown_notice_receipt"]["rows_sha256"]
        != updated["tables"]["unknown_notice_receipt"]["rows_sha256"]
    )
    assert (
        before["tables"]["unknown_notice_receipt"]["schema_sha256"]
        == updated["tables"]["unknown_notice_receipt"]["schema_sha256"]
    )
    with engine.begin() as c:
        c.execute(
            text(
                "CREATE INDEX unknown_notice_payload ON unknown_notice_receipt(payload)"
            )
        )
    indexed = snapshot_database(pg)
    assert (
        indexed["tables"]["unknown_notice_receipt"]["schema_sha256"]
        != updated["tables"]["unknown_notice_receipt"]["schema_sha256"]
    )
    assert (
        indexed["tables"]["unknown_notice_receipt"]["rows_sha256"]
        == updated["tables"]["unknown_notice_receipt"]["rows_sha256"]
    )


class PGError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.sqlstate = code


@pytest.mark.parametrize(
    "message,code,expected",
    [
        (
            'pg_hba.conf rejects connection for host "127.0.0.1", user "app"',
            "28000",
            True,
        ),
        ('no pg_hba.conf entry for host "127.0.0.1"', None, True),
        ('password authentication failed for user "app"', "28P01", False),
        ("connection timed out", None, False),
        ("connection refused", None, False),
    ],
)
def test_exact_hba_error(message, code, expected):
    assert (
        is_explicit_hba_rejection(OperationalError(None, None, PGError(message, code)))
        is expected
    )
    assert not is_explicit_hba_rejection(RuntimeError(message))


def test_durable_known_hash_and_unknown_or_changed_file(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"known")
    target = tmp_path / "target"
    digest = hashlib.sha256(b"known").hexdigest()
    assert durable_copy(source, target, digest) == {"sha256": digest, "size": 5}
    assert target.read_bytes() == b"known"
    with pytest.raises(FileExistsError):
        durable_copy(source, target, digest)
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="hash mismatch"):
        durable_copy(source, tmp_path / "bad", digest)
    assert not (tmp_path / "bad").exists()
    alias = tmp_path / "alias"
    alias.symlink_to(source)
    with pytest.raises(OSError):
        durable_copy(alias, tmp_path / "linked", hashlib.sha256(b"changed").hexdigest())
