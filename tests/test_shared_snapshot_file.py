"""Actual registered JSON file -> reviewed partial history -> persistent unlink."""

import json
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.application.planning import Conflict
from shift_scheduler.application.shared_projection import proposal
from shift_scheduler.db.compliance_models import (
    LegalHold,
    ManagedCopy,
    PreservedArchive,
)
from shift_scheduler.domain.copies import CopyRegistration, SharedProjectionReview
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.managed_writer import publish_bytes, reserve
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_reviewed_planning import snapshot


def prepare(pg, tmp_path, monkeypatch, person):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path))
    data = snapshot(2, 1)
    body = json.dumps(data.model_dump(mode="json")).encode()
    identity = uuid4().hex
    item = CopyRegistration(
        copy_id=identity,
        category="exports",
        medium="file",
        relative_path=identity,
        content_hash=sha256(body).hexdigest(),
        person_ids=("p0", "p1"),
        anchor="last_activity",
        anchor_at="2020-01-01T00:00:00Z",
        subject_status="VERIFIED",
        evidence=EVIDENCE,
    )
    with pg.begin() as s:
        privacy.save_rule(
            s,
            SCOPE,
            RetentionPolicy(
                category="exports",
                purpose="closed synthetic export",
                anchor="last_activity",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=EVIDENCE,
                owner="officer",
                next_review="2036-01-01",
            ),
            0,
            "operator",
        )
    reserve(pg, SCOPE, item, "schedule.json", data.input_hash)
    publish_bytes(pg, SCOPE, identity, body)
    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        prepared = proposal(s, row, person)
        copies.review_shared_projection(
            s,
            SCOPE,
            SharedProjectionReview(
                copy_id=identity,
                person_id=person,
                content_hash=row.content_hash,
                projection_hash=prepared["payload_hash"],
                shared_text_reviewed=True,
                evidence=EVIDENCE,
            ),
            row.revision,
            "operator",
            AT,
        )
        plan = copies.preview(s, SCOPE, person, "operator", AT)
    return identity, plan


@pytest.mark.parametrize("person,other", [("p0", "p1"), ("p1", "p0")])
def test_shared_file_preservation_then_missing_unlink_ack(
    pg, tmp_path, monkeypatch, person, other
):
    identity, plan = prepare(pg, tmp_path, monkeypatch, person)
    with pg.begin() as s:
        result = copies.execute(
            s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "operator", AT
        )
        assert result["queued_copy_ids"] == [identity]
        assert len(result["preserved_archive_ids"]) == 1
        archive = s.get(PreservedArchive, result["preserved_archive_ids"][0])
        assert [p["person_id"] for p in archive.payload["retained"]["people"]] == [
            other
        ]
        assert archive.payload["replayable"] is False
        assert (tmp_path / identity).exists()
    (tmp_path / identity).unlink()
    assert copies.process_one(pg, AT)
    with pg() as s:
        assert s.get(ManagedCopy, identity).state == "ERASED"
        archive_copy = next(
            r
            for r in s.scalars(select(ManagedCopy))
            if r.locator.get("table") == "preserved_archives"
        )
        assert archive_copy.anchor_at.isoformat().startswith("2020-01-01")
    with pg.begin() as s:
        second = copies.preview(s, SCOPE, other, "operator", AT)
        result = copies.execute(
            s, SCOPE, second["plan_id"], second["fingerprint"], 1, "operator", AT
        )
        assert archive_copy.copy_id in result["erased_database_copy_ids"]
    with pg() as s:
        assert not list(s.scalars(select(PreservedArchive)))


def test_changed_file_and_late_hold_block(pg, tmp_path, monkeypatch):
    identity, plan = prepare(pg, tmp_path, monkeypatch, "p0")
    with pg.begin() as s:
        s.add(
            LegalHold(
                hold_id="late",
                scope_id=SCOPE,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
    with pg.begin() as s, pytest.raises(Conflict):
        copies.execute(
            s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "operator", AT
        )
    with (tmp_path / identity).open("ab") as f:
        f.write(b" ")
    with pg() as s, pytest.raises(ValueError, match="hash"):
        proposal(s, s.get(ManagedCopy, identity), "p0")
