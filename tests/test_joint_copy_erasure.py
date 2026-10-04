"""Explicit additional-person review is necessary; no silent joint erasure."""

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies
from shift_scheduler.application import joint_copy_erasure as joint
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import (
    LegalHold,
    ManagedCopy,
    PreservedArchive,
    PrivacyCase,
)
from shift_scheduler.domain.planning import content_hash
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_person_control_sequence import configured, control, execute
from tests.test_shared_snapshot_file import prepare


def ready(pg, tmp_path, monkeypatch):
    configured(pg, monkeypatch)
    identity, _ = prepare(pg, tmp_path, monkeypatch, "p0")
    with pg.begin() as s:
        s.add(
            LegalHold(
                hold_id="p1-hold",
                scope_id=SCOPE,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
        control(s, "p0")
    assert execute(pg, "p0", "first-held")["queued_count"] == 0
    with pg.begin() as s:
        s.get(LegalHold, "p1-hold").active = False
        control(s, "p1")
    return identity


def review(pg, identity):
    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        context = joint.context(s, row, AT)
        return joint.review(
            s,
            SCOPE,
            identity,
            expected_revision=row.revision,
            source_hash=row.content_hash,
            context_hash=content_hash(context),
            reason="Explicit review of both approved persons and entire shared text",
            evidence=EVIDENCE,
            issuer="test",
            subject="admin",
            at=AT,
        )


def test_explicit_all_owner_review_erases_without_recreating_people(
    pg, tmp_path, monkeypatch
):
    identity = ready(pg, tmp_path, monkeypatch)
    with pg() as s:
        inv = copies.inventory(s, SCOPE, "p1", AT)
        row = next(t for t in inv["targets"] if t["copy_id"] == identity)
        assert "joint_review_required" in row["blockers"]
    review(pg, identity)
    result = execute(pg, "p1", "joint-reviewed")
    assert result["queued_count"] == 1 and result["preserved_archive_count"] == 0
    (tmp_path / identity).unlink()  # committed intent; crash before acknowledgement
    assert copies.process_one(pg, AT)
    with pg() as s:
        assert s.get(ManagedCopy, identity).state == "ERASED"
        assert not list(s.scalars(select(PreservedArchive)))


def test_case_revision_and_late_hold_invalidate_joint_review(pg, tmp_path, monkeypatch):
    identity = ready(pg, tmp_path, monkeypatch)
    review(pg, identity)
    from sqlalchemy.exc import IntegrityError

    # The existing stable-person DB barrier itself refuses a later case rewrite.
    with pytest.raises(IntegrityError, match="prevents reintroduction"):
        with pg.begin() as s:
            s.get(PrivacyCase, "erase-p0").revision += 1
    with pg.begin() as s:
        s.add(
            LegalHold(
                hold_id="new-hold",
                scope_id=SCOPE,
                person_id="p0",
                active=True,
                revision=1,
                payload={},
            )
        )
    with pg() as s, pytest.raises(Conflict, match="hold"):
        joint.proposal(s, s.get(ManagedCopy, identity), "p1", AT)
    assert (tmp_path / identity).exists()


def test_public_joint_review_requires_explicit_confirmation_and_retries(
    pg, tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient
    from scripts.long_integrated_api import Clock

    import shift_scheduler.db.session as db
    from shift_scheduler.api.main import app
    from shift_scheduler.db.planning_models import AccountMembership
    from tests.test_compliance_api import QUERY, token

    identity = ready(pg, tmp_path, monkeypatch)
    with pg.begin() as s:
        s.get(AccountMembership, "admin").issuer = "mock"
    monkeypatch.setattr(db, "_SessionFactory", pg)
    monkeypatch.setattr(db, "_ENGINE", pg.kw["bind"])
    Clock.current = AT
    monkeypatch.setattr("shift_scheduler.api.routers.compliance.datetime", Clock)
    path = "/planning/compliance/copies/" + identity + "/joint-review" + QUERY
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        current = client.get(path, headers=auth)
        assert current.status_code == 200, current.text
        value = current.json()
        body = {
            "expected_revision": value["revision"],
            "idempotency_key": "joint-review-http",
            "source_hash": value["source_hash"],
            "context_hash": value["context_hash"],
            "reason": "Explicit joint participant and whole text review",
            "evidence": EVIDENCE.model_dump(mode="json"),
        }
        assert client.post(path, headers=auth, json=body).status_code == 422
        body["shared_text_reviewed"] = True
        response = client.post(path, headers=auth, json=body)
        assert response.status_code == 200, response.text
        assert client.post(path, headers=auth, json=body).json() == response.json()
        assert (
            client.post(
                path, headers=auth, json={**body, "reason": "changed"}
            ).status_code
            == 409
        )


def test_copy_origin_metadata_change_invalidates_previous_review(
    pg, tmp_path, monkeypatch
):
    identity = ready(pg, tmp_path, monkeypatch)
    review(pg, identity)
    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        row.locator = {**row.locator, "source_hash": "0" * 64}
        row.revision += 1
    with pg() as s, pytest.raises(Conflict, match="changed"):
        joint.proposal(s, s.get(ManagedCopy, identity), "p1", AT)
    assert (tmp_path / identity).exists()
