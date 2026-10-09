"""Person control to committed file intents; PG is real, control transport is fake."""

from datetime import UTC, datetime
from hashlib import sha256
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from shift_scheduler.application import copies
from shift_scheduler.application import subject_controls as controls
from shift_scheduler.application.planning import Conflict
from shift_scheduler.control import transaction
from shift_scheduler.db.compliance_models import LegalHold, ManagedCopy, RetentionRule
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import Evidence
from tests.test_subject_controls_postgres import NOW, SCOPE, call, setup


def prepare(pg, monkeypatch, tmp_path, shared=False):
    setup(pg)
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path))
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    fake = SimpleNamespace(
        client_id="synthetic",
        require_access=lambda: {"generation": 1},
        request=lambda *a: {},
    )
    monkeypatch.setattr(controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)
    with pg.begin() as s:
        s.add(
            RetentionRule(
                key="exports",
                scope_id=SCOPE,
                category="exports",
                revision=1,
                payload={
                    "category": "exports",
                    "purpose": "synthetic expired test file",
                    "anchor": "last_activity",
                    "retention_days": 1,
                    "legal_minimum_days": 0,
                    "effective_from": "2026-01-01",
                    "effective_until": "2027-01-01",
                    "evidence": {
                        "reference": "fixture approval",
                        "status": "verified",
                        "verified_by": "officer",
                    },
                    "owner": "officer",
                    "next_review": "2026-12-31",
                },
            )
        )
        for person in ("p1", "p2"):
            body = (person + " synthetic").encode()
            (tmp_path / person).write_bytes(body)
            copies.register(
                s,
                SCOPE,
                CopyRegistration(
                    copy_id="file-" + person,
                    category="exports",
                    medium="file",
                    relative_path=person,
                    content_hash=sha256(body).hexdigest(),
                    person_ids=(person,),
                    anchor="last_activity",
                    anchor_at=datetime(2020, 1, 1, tzinfo=UTC),
                    subject_status="VERIFIED",
                    evidence=Evidence(
                        reference="fixture approved",
                        status="verified",
                        verified_by="officer",
                    ),
                ),
                0,
                "admin",
            )
    if shared:
        from shift_scheduler.application.shared_projection import proposal
        from shift_scheduler.db.compliance_models import (
            ComplianceEntity,
            ComplianceRevision,
            CopySubject,
        )
        from shift_scheduler.db.planning_models import AccountMembership
        from shift_scheduler.domain.copies import (
            DatabaseCopyReview,
            SharedProjectionReview,
        )

        evidence = Evidence(
            reference="fixed synthetic shared review",
            status="verified",
            verified_by="officer",
        )
        with pg.begin() as s:
            s.add(
                AccountMembership(
                    membership_id="reviewer",
                    issuer="test",
                    subject="other-actor",
                    person_id="p2",
                    scope_id=SCOPE,
                    role="ADMIN",
                    active=True,
                )
            )
            policy = dict(s.get(RetentionRule, "exports").payload)
            policy["category"] = "compliance"
            s.add(
                RetentionRule(
                    key="compliance",
                    scope_id=SCOPE,
                    category="compliance",
                    revision=1,
                    payload=policy,
                )
            )
            s.add(
                ComplianceEntity(
                    key="shared-owner",
                    scope_id=SCOPE,
                    kind="person",
                    entity_id="p1",
                    person_id="p1",
                    revision=1,
                    payload={"person_id": "p1", "name": "Synthetic only"},
                    created_at=datetime(2020, 1, 1, tzinfo=UTC),
                )
            )
            s.flush()
            s.add(
                ComplianceRevision(
                    key="shared-revision",
                    entity_key="shared-owner",
                    revision=1,
                    payload={"person_id": "p1", "name": "Synthetic only"},
                    actor="other-actor",
                    created_at=datetime(2020, 1, 1, tzinfo=UTC),
                )
            )
        with pg.begin() as s:
            for row in list(
                s.scalars(
                    select(ManagedCopy).where(ManagedCopy.category == "compliance")
                )
            ):
                people = tuple(
                    s.scalars(
                        select(CopySubject.person_id).where(
                            CopySubject.copy_id == row.copy_id
                        )
                    )
                )
                assert set(people) in ({"p1"}, {"p1", "p2"})
                copies.review_database_copy(
                    s,
                    SCOPE,
                    DatabaseCopyReview(
                        copy_id=row.copy_id,
                        content_hash=row.content_hash,
                        person_ids=people,
                        evidence=evidence,
                    ),
                    row.revision,
                    "admin",
                    NOW,
                )
                if set(people) == {"p1", "p2"}:
                    projected = proposal(s, row, "p1")
                    copies.review_shared_projection(
                        s,
                        SCOPE,
                        SharedProjectionReview(
                            copy_id=row.copy_id,
                            person_id="p1",
                            content_hash=row.content_hash,
                            projection_hash=projected["payload_hash"],
                            shared_text_reviewed=True,
                            evidence=evidence,
                        ),
                        row.revision,
                        "admin",
                        NOW,
                    )
    with pg.begin() as s:
        call(s)
    with pg.begin() as s:
        return copies.preview(s, SCOPE, "p1", "admin", NOW)


def execute(s, plan, **overrides):
    args = {
        "issuer": "test",
        "subject": "admin",
        "plan_id": plan["plan_id"],
        "plan_revision": plan["revision"],
        "fingerprint": plan["fingerprint"],
        "expected_revision": 1,
        "idempotency_key": "eligible-erasure-1",
        "at": NOW,
    }
    args.update(overrides)
    return controls.execute_eligible(s, SCOPE, "p1", **args)


def test_committed_file_erasure_resume_and_other_person_preserved(
    pg, monkeypatch, tmp_path
):
    plan = prepare(pg, monkeypatch, tmp_path)
    with pg.begin() as s:
        first = execute(s, plan)
        assert first["queued_count"] == 1
        assert first["all_copies_erased"] is False
        assert (tmp_path / "p1").exists()
    with pg.begin() as s:
        assert execute(s, plan) == first
        with pytest.raises(Conflict):
            execute(s, plan, fingerprint="0" * 64)
    # Model the real worker interruption after unlink but before DB acknowledgement.
    (tmp_path / "p1").unlink()
    assert copies.process_one(pg, NOW)
    assert not copies.process_one(pg, NOW)
    assert (tmp_path / "p2").read_text() == "p2 synthetic"
    with pg() as s:
        assert s.get(ManagedCopy, "file-p1").state == "ERASED"
        assert s.get(ManagedCopy, "file-p2").state == "PRESENT"


def test_hold_added_after_preview_rejects_without_file_mutation(
    pg, monkeypatch, tmp_path
):
    plan = prepare(pg, monkeypatch, tmp_path)
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
    with pg.begin() as s, pytest.raises(Conflict, match="hold"):
        execute(s, plan)
    assert (tmp_path / "p1").exists() and (tmp_path / "p2").exists()


def test_person_control_then_typed_shared_preservation(pg, monkeypatch, tmp_path):
    from shift_scheduler.db.compliance_models import (
        ComplianceEntity,
        ComplianceRevision,
        PreservedArchive,
    )

    plan = prepare(pg, monkeypatch, tmp_path, shared=True)
    with pg.begin() as s:
        result = execute(s, plan)
        assert result["erased_database_count"] == 2
        assert result["preserved_archive_count"] == 1
    with pg() as s:
        assert s.get(ComplianceEntity, "shared-owner") is None
        assert s.get(ComplianceRevision, "shared-revision") is None
        archive = s.scalar(select(PreservedArchive))
        assert archive.payload["retained"]["people"] == [{"person_id": "p2"}]
        assert archive.payload["retained"]["subject_records"][0]["data"] == {}


@pytest.mark.parametrize("shared", [False, True])
def test_will_process_flag_is_what_the_subject_erasure_processed(
    pg, monkeypatch, tmp_path, shared
):
    from shift_scheduler.db.compliance_models import CopyErasure

    prepare(pg, monkeypatch, tmp_path, shared=shared)
    with pg.begin() as s:
        control = controls.preview(
            s, SCOPE, "p1", issuer="test", subject="admin", at=NOW
        )
        planned = controls.plan_eligible(
            s,
            SCOPE,
            "p1",
            issuer="test",
            subject="admin",
            expected_revision=1,
            idempotency_key="eligible-plan-flags",
            at=NOW,
        )
    # The plan response and the control's inventory state the same flag per target.
    flags = {t["copy_id"]: t["will_process"] for t in planned["targets"]}
    listed = control["inventory"]["targets"]
    assert {t["copy_id"]: t["will_process"] for t in listed} == flags
    assert all(set(t) == {"copy_id", "will_process"} for t in planned["targets"])
    assert flags and all(type(value) is bool for value in flags.values())
    # Both kinds are present: a file nothing blocks, database records that are blocked,
    # and (shared) database records that are erased.
    kinds = {(t["medium"], t["will_process"]) for t in listed}
    assert {("file", True), ("database", False)} <= kinds
    assert (("database", True) in kinds) is shared
    assert {t["copy_id"] for t in listed if not t["blockers"]} == {
        key for key, value in flags.items() if value
    }
    with pg() as s:
        before = {
            row.copy_id: (row.state, row.revision)
            for row in s.scalars(select(ManagedCopy))
        }
    with pg.begin() as s:
        result = execute(s, planned)
        stored = s.get(CopyErasure, planned["plan_id"]).payload
    processed = set(stored["queued_copy_ids"]) | set(stored["erased_database_copy_ids"])
    # flag == actually processed, for the targets with a blocker and for those without.
    assert {key for key, value in flags.items() if value} == processed
    assert result["queued_count"] + result["erased_database_count"] == len(processed)
    with pg() as s:
        after = {
            row.copy_id: (row.state, row.revision)
            for row in s.scalars(select(ManagedCopy))
        }
    for key, value in flags.items():
        if value:
            assert after[key] != before[key]
            assert after[key][0] in {"PENDING_ERASURE", "ERASED"}
        else:
            assert after[key] == before[key]
    # A replay of the plan request answers the same flags from the receipt.
    with pg.begin() as s:
        assert (
            controls.plan_eligible(
                s,
                SCOPE,
                "p1",
                issuer="test",
                subject="admin",
                expected_revision=1,
                idempotency_key="eligible-plan-flags",
                at=NOW,
            )
            == planned
        )
