"""Pre-registered reviewer + observer through the public API on real PostgreSQL.

Synthetic rows only. Fixture rows are inserted directly (they stand for business
history); every review decision goes through the reviewer module and API.
"""

import json
import shutil
from datetime import UTC, datetime
from hashlib import sha256
from types import SimpleNamespace
from urllib.parse import quote
from uuid import uuid4

import pytest
from scripts.long_integrated_api import Clock
from scripts.long_subject_events import apply_subject_event
from scripts.long_subject_review import SyntheticReviewer, protocol_digest
from sqlalchemy import select

from shift_scheduler.application import privacy
from shift_scheduler.application import subject_controls as controls
from shift_scheduler.control import transaction
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    CopySubject,
    LegalHold,
    ManagedCopy,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import Evidence
from shift_scheduler.domain.privacy import RetentionPolicy
from shift_scheduler.ops.managed_writer import publish_bytes, reserve
from tests.test_reviewed_planning import snapshot

SCOPE = "hospital/pharmacy"
SOLO = {"p0": "solo-a", "p1": "solo-b"}
V1, V2, PROTOCOL = (f"ops/synthetic-review-protocol-v{n}.json" for n in (1, 2, 3))
FIRST_AT, SECOND_AT = "2028-03-14T13:00:00+09:00", "2028-03-15T13:00:00+09:00"
OLD = datetime(
    2024, 1, 1, tzinfo=UTC
)  # past every protocol retention period by 2028-03
RECENT = datetime(2027, 12, 1, tzinfo=UTC)  # inside the 1095-day compliance period
EVIDENCE = Evidence(
    reference="synthetic fixture", status="verified", verified_by="officer"
)


class Adapter:
    def __init__(self, factory, reviewer):
        from scripts.coupled_acceptance_api import PublicApiProjection

        self.factory = factory
        self.api = PublicApiProjection(factory)
        self.api.attach_existing()
        self.scope = SCOPE
        self.query = "?scope_id=" + quote(SCOPE, safe="")
        self.base = "/planning/compliance"
        self.person_prefix = ""
        self.applied_events = []
        self.responses = []
        self.reviewer = reviewer
        self.ev = {
            "reference": "synthetic-fixture",
            "status": "verified",
            "verified_by": "independent-fixture",
        }

    def require(self, response):
        self.responses.append({"status": response.status_code})
        if response.status_code >= 400:
            raise AssertionError(f"HTTP {response.status_code}: {response.text}")
        return response.json()

    def write(self, path, payload, key, expected=0):
        return self.require(
            self.api.request(
                self.base + path + self.query,
                {
                    "expected_revision": expected,
                    "idempotency_key": key,
                    "payload": payload,
                },
            )
        )


@pytest.fixture
def world(pg, tmp_path, monkeypatch):
    fake = SimpleNamespace(
        client_id="review",
        require_access=lambda: {"generation": 1},
        request=lambda *a: {},
    )
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "x" * 32)
    monkeypatch.setattr(controls, "configured_client", lambda: fake)
    monkeypatch.setattr(transaction, "configured_client", lambda: fake)
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(tmp_path / "managed"))
    (tmp_path / "managed").mkdir()
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="api-admin",
                issuer="mock",
                subject="admin",
                person_id="privacy-operator",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    Clock.current = datetime.fromisoformat(FIRST_AT)
    adapters = []

    def make(protocol=PROTOCOL):
        reviewer = SyntheticReviewer(
            protocol,
            protocol_digest(protocol),
            tmp_path / f"decisions-{len(adapters)}.jsonl",
        )
        adapters.append(Adapter(pg, reviewer))
        return adapters[-1]

    yield SimpleNamespace(pg=pg, root=tmp_path / "managed", tmp=tmp_path, make=make)
    for adapter in adapters:
        adapter.api.close()


def entity(s, key, payload, created=OLD, person=None):
    s.add(
        ComplianceEntity(
            key=key,
            scope_id=SCOPE,
            kind="synthetic",
            entity_id="external-" + key,
            person_id=person,
            revision=1,
            payload=payload,
            created_at=created,
        )
    )


def db_copy(s, key):
    return next(
        c
        for c in s.scalars(select(ManagedCopy))
        if c.locator.get("pk", {}).get("key") == key
    )


def shared_file(world):
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
        anchor_at="2024-01-01T00:00:00Z",
        subject_status="VERIFIED",
        evidence=EVIDENCE,
    )
    reserve(world.pg, SCOPE, item, "schedule.json", data.input_hash)
    publish_bytes(world.pg, SCOPE, identity, body)
    return identity, sha256(body).hexdigest()


def event(person, at=FIRST_AT):
    return {
        "event_id": "erase-" + person,
        "kind": "erasure",
        "person_id": person,
        "recorded_at": at,
    }


def seed(world):
    with world.pg.begin() as s:
        # Keys are neutral: an identifier embedding a person id is itself an
        # unstructured person reference under the protocol.
        entity(s, "solo-a", {"person_id": "p0", "text": "synthetic"})
        entity(s, "solo-b", {"person_id": "p1", "text": "synthetic"})
        entity(
            s,
            "prose-a",
            {"person_id": "p0", "note": "handover discussed with p1 at night"},
        )
        entity(s, "recent-a", {"person_id": "p0", "text": "synthetic"}, created=RECENT)
        s.add(
            PlanningOutbox(
                event_id="import-both",
                scope_id=SCOPE,
                kind="actual.import",
                actor="operator",
                payload={
                    "person_ids": ["p0", "p1"],
                    "count": 2,
                    "source_hash": "a" * 64,
                },
                created_at=OLD,
            )
        )


@pytest.mark.parametrize("first,second", [("p0", "p1"), ("p1", "p0")])
def test_reviewed_erasure_both_orders_hold_joint_file_and_rejections(
    world, first, second
):
    seed(world)
    identity, digest = shared_file(world)
    hold = "hold-" + second
    with world.pg.begin() as s:
        s.add(
            LegalHold(
                hold_id=hold,
                scope_id=SCOPE,
                person_id=second,
                active=True,
                revision=1,
                payload={},
            )
        )
        other_before = db_copy(s, SOLO[second]).content_hash
    adapter = world.make()
    one = apply_subject_event(adapter, event(first), world.root)
    # Real non-zero erasure of the reviewed, expired, exclusively owned row only.
    assert one["actual_database_erased_count"] >= 1
    assert one["review"]["database_subject"]["approved"] >= 1
    with world.pg() as s:
        assert db_copy(s, SOLO[first]).state == "ERASED"
        assert s.get(ComplianceEntity, SOLO[first]) is None
        # The other person's own row is untouched.
        assert db_copy(s, SOLO[second]).content_hash == other_before
        assert s.get(ComplianceEntity, SOLO[second]) is not None
        if first == "p0":
            # Unstructured prose naming the other person and recent rows remain.
            assert db_copy(s, "prose-a").state == "PRESENT"
            assert db_copy(s, "recent-a").state == "PRESENT"
    if first == "p0":
        assert (
            one["review"]["database_subject"]["rejected"].get(
                "person_reference_in_unstructured_text"
            )
            == 1
        )
    # The shared file and shared DB row stay while the other owner is held.
    assert (world.root / identity).is_file()
    assert one["shared_others_preserved"][0]["state"] == "original_remaining"
    assert one["residual_reasons_overlapping"].get("legal_hold", 0) >= 2
    with world.pg.begin() as s:
        s.get(LegalHold, hold).active = False
        s.get(LegalHold, hold).revision += 1
    two = apply_subject_event(adapter, event(second, SECOND_AT), world.root)
    assert two["actual_database_erased_count"] >= 1
    assert two["review"]["joint_file"]["approved"] == 1
    assert two["actual_file_erased_count"] == 1 and not (world.root / identity).exists()
    assert (
        two["shared_others_preserved"][0]["state"] == "joint_erased_all_owners_reviewed"
    )
    # A shared DB row with an already-controlled co-owner is never approved
    # as a single-person preservation; it stays with an explicit reason.
    assert (
        two["review"]["preservation"]["rejected"].get(
            "other_owner_already_controlled_joint_review_required"
        )
        == 1
    )
    with world.pg() as s:
        outbox = next(
            c
            for c in s.scalars(select(ManagedCopy))
            if c.locator.get("pk", {}).get("event_id") == "import-both"
        )
        assert outbox.state == "PRESENT"
    assert all(t["blockers"] for t in two["remaining"]["targets"])


def test_subject_set_mismatch_is_rejected_and_left(world):
    seed(world)
    with world.pg.begin() as s:
        # Registration drift: the inventory claims an extra person the row does not name.
        s.add(CopySubject(copy_id=db_copy(s, "solo-a").copy_id, person_id="p9"))
    adapter = world.make()
    apply_subject_event(adapter, event("p0"), world.root)
    with world.pg() as s:
        target = db_copy(s, "solo-a").copy_id
    decisions = [
        json.loads(line) for line in adapter.reviewer.log_path.read_text().splitlines()
    ]
    mine = [d for d in decisions if d["copy_id"] == target]
    assert [(d["decision"], d["reason"], d["registered"]) for d in mine] == [
        ("REJECTED", "subject_set_mismatch", ["p0", "p9"])
    ]
    with world.pg() as s:
        assert (
            db_copy(s, "solo-a").state == "PRESENT"
            and db_copy(s, "solo-a").subject_status == "UNVERIFIED"
        )


def test_protocol_changed_after_registration_refuses_all_decisions(world):
    seed(world)
    changed = world.tmp / "protocol.json"
    shutil.copy(PROTOCOL, changed)
    adapter = world.make(str(changed))
    changed.write_text(
        changed.read_text().replace('"retention_days": 365', '"retention_days": 1')
    )
    with pytest.raises(ValueError, match="changed after registration"):
        adapter.reviewer.review_person(adapter, "p0", "erase-p0")
    with world.pg() as s:
        assert all(
            c.subject_status == "UNVERIFIED"
            for c in s.scalars(select(ManagedCopy))
            if c.medium == "database"
        )


def test_late_hold_after_review_and_plan_blocks_execution(world):
    seed(world)
    adapter = world.make()
    Clock.current = datetime.fromisoformat(FIRST_AT)
    from unittest.mock import patch

    with (
        patch("shift_scheduler.api.routers.compliance.datetime", Clock),
        patch("shift_scheduler.application.copies.datetime", Clock),
        patch("shift_scheduler.application.privacy.datetime", Clock),
        patch("shift_scheduler.application.subject_controls.datetime", Clock),
    ):
        with world.pg.begin() as s:
            privacy.save_rule(
                s,
                SCOPE,
                RetentionPolicy(
                    category="control",
                    purpose="synthetic",
                    anchor="case_closed",
                    retention_days=3650,
                    legal_minimum_days=0,
                    effective_from="2026-01-01",
                    effective_until="2029-01-01",
                    evidence=EVIDENCE,
                    owner="officer",
                    next_review="2029-01-01",
                ),
                0,
                "op",
            )
        case = adapter.require(
            adapter.api.request(
                adapter.base + "/privacy/requests" + adapter.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": "late-hold-request",
                    "payload": {
                        "person_id": "p0",
                        "kind": "erase",
                        "reason": "synthetic",
                    },
                },
            )
        )
        for revision, state in ((1, "VERIFIED"), (2, "APPROVED")):
            adapter.require(
                adapter.api.request(
                    adapter.base + "/privacy/cases/" + case["case_id"] + adapter.query,
                    {
                        "expected_revision": revision,
                        "idempotency_key": "late-hold-" + state,
                        "payload": {
                            "status": state,
                            "reason": "synthetic",
                            "identity_evidence": adapter.ev,
                        },
                    },
                )
            )
        path = adapter.base + "/subject-controls/p0"
        adapter.require(
            adapter.api.request(
                path + adapter.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": "late-hold-control",
                    "case_id": case["case_id"],
                    "case_revision": 3,
                    "reason": "synthetic",
                },
            )
        )
        summary = adapter.reviewer.review_person(adapter, "p0", "late-hold")
        assert summary["database_subject"]["approved"] >= 1
        plan = adapter.require(
            adapter.api.request(
                path + "/plans" + adapter.query,
                {"expected_revision": 1, "idempotency_key": "late-hold-plan"},
            )
        )
        with world.pg.begin() as s:
            s.add(
                LegalHold(
                    hold_id="late",
                    scope_id=SCOPE,
                    person_id="p0",
                    active=True,
                    revision=1,
                    payload={},
                )
            )
        response = adapter.api.request(
            path + "/execute" + adapter.query,
            {
                "expected_revision": 1,
                "idempotency_key": "late-hold-execute",
                "plan_id": plan["plan_id"],
                "plan_revision": plan["revision"],
                "fingerprint": plan["fingerprint"],
            },
        )
        assert response.status_code == 409
    with world.pg() as s:
        assert (
            s.get(ComplianceEntity, "solo-a") is not None
            and db_copy(s, "solo-a").state == "PRESENT"
        )


def test_shared_database_row_with_controlled_co_owner_requires_joint_review(
    pg, monkeypatch
):
    """Product counterexample: a single-person preservation of a shared DB row
    must not try to archive an already-controlled co-owner (the identity trigger
    would reject that archive and abort the whole execution)."""
    from shift_scheduler.application import copies
    from shift_scheduler.application.shared_projection import proposal
    from shift_scheduler.domain.copies import DatabaseCopyReview, SharedProjectionReview
    from tests.test_database_erasure_postgres import (
        AT,
    )
    from tests.test_database_erasure_postgres import (
        EVIDENCE as REVIEWED,
    )
    from tests.test_database_erasure_postgres import (
        SCOPE as PHARMACY,
    )
    from tests.test_shared_person_control_sequence import configured, control, execute

    configured(pg, monkeypatch)
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id=PHARMACY,
                role="ADMIN",
                active=True,
            )
        )
        privacy.save_rule(
            s,
            PHARMACY,
            RetentionPolicy(
                category="audit",
                purpose="synthetic expiry",
                anchor="last_activity",
                retention_days=1,
                legal_minimum_days=0,
                effective_from="2030-01-01",
                effective_until="2040-01-01",
                evidence=REVIEWED,
                owner="officer",
                next_review="2036-01-01",
            ),
            0,
            "op",
        )
        s.add(
            PlanningOutbox(
                event_id="import-both",
                scope_id=PHARMACY,
                kind="actual.import",
                actor="operator-account",
                payload={
                    "person_ids": ["p0", "p1"],
                    "count": 2,
                    "source_hash": "a" * 64,
                },
                created_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )
        s.add(
            LegalHold(
                hold_id="p1-hold",
                scope_id=PHARMACY,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
    with pg.begin() as s:
        row = next(
            c
            for c in s.scalars(select(ManagedCopy))
            if c.locator.get("pk", {}).get("event_id") == "import-both"
        )
        identity = row.copy_id
        owners = sorted(
            s.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == identity)
            )
        )
        copies.review_database_copy(
            s,
            PHARMACY,
            DatabaseCopyReview(
                copy_id=identity,
                content_hash=row.content_hash,
                person_ids=tuple(owners),
                evidence=REVIEWED,
            ),
            row.revision,
            "officer",
            AT,
        )
        control(s, "p0")
    assert execute(pg, "p0", "first-held")["erased_database_count"] == 0
    with pg.begin() as s:
        s.get(LegalHold, "p1-hold").active = False
        control(s, "p1")
    with pg() as s:
        blockers = next(
            t
            for t in copies.inventory(s, PHARMACY, "p1", AT)["targets"]
            if t["copy_id"] == identity
        )["blockers"]
    # Expected: the product itself reports that a joint decision is required.
    assert "joint_review_required" in blockers
    # No single-person projection exists, so no approval can be recorded, and
    # execution completes (no identity-barrier abort) with the row retained.
    with pg.begin() as s:
        row = s.get(ManagedCopy, identity)
        with pytest.raises(ValueError, match="joint_review_required"):
            proposal(s, row, "p1", AT)
        with pytest.raises(ValueError, match="joint_review_required"):
            copies.review_shared_projection(
                s,
                PHARMACY,
                SharedProjectionReview(
                    copy_id=identity,
                    person_id="p1",
                    content_hash=row.content_hash,
                    projection_hash="0" * 64,
                    shared_text_reviewed=True,
                    evidence=REVIEWED,
                ),
                row.revision,
                "officer",
                AT,
            )
    result = execute(pg, "p1", "second")
    assert (
        result["state"] == "ELIGIBLE_PROCESSED_REMAINS"
        and result["preserved_archive_count"] == 0
    )
    with pg() as s:
        assert s.get(ManagedCopy, identity).state == "PRESENT"
        assert "preservation_review" not in s.get(ManagedCopy, identity).evidence


@pytest.mark.parametrize("protocol,erased", [(V1, False), (V2, True), (PROTOCOL, True)])
def test_typed_actor_co_owner_needs_v2_extraction_then_reconstructs(
    world, protocol, erased
):
    """v1 leaves actor-shared rows (retained first result); v2 resolves the typed
    actor account, erases the row and archives only the actor's record."""
    from shift_scheduler.db.compliance_models import PreservedArchive

    with world.pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    with world.pg.begin() as s:  # membership must exist before the row is registered
        entity(
            s,
            "acted-a",
            {"person_id": "p0", "reviewed_by": "operator-account", "value": 4},
        )
    adapter = world.make(protocol)
    result = apply_subject_event(adapter, event("p0"), world.root)
    with world.pg() as s:
        copy = db_copy(s, "acted-a")
        assert sorted(
            s.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        ) == ["operator-person", "p0"]
        if not erased:
            assert (
                copy.state == "PRESENT"
                and s.get(ComplianceEntity, "acted-a") is not None
            )
            assert (
                result["review"]["database_subject"]["rejected"].get(
                    "subject_set_mismatch", 0
                )
                >= 1
            )
            return
        assert copy.state == "ERASED" and s.get(ComplianceEntity, "acted-a") is None
        assert (
            result["actual_database_erased_count"] >= 1
            and result["preserved_archive_count"] >= 1
        )
        archives = list(s.scalars(select(PreservedArchive)))
        retained = [
            a for a in archives if a.source_digest == copy.evidence["prior_hash"]
        ]
        assert len(retained) == 1
        body = json.dumps(retained[0].payload)
        assert "operator-person" in body and '"p0"' not in body
        assert retained[0].payload["replayable"] is False


@pytest.mark.parametrize("protocol,erased", [(V2, True), (PROTOCOL, False)])
def test_v3_scans_unresolved_actor_values_and_foreign_names(world, protocol, erased):
    """v2 exempted every typed actor value and any name beside a person_id; v3
    exempts only resolved actors and the person's own registered name."""
    with world.pg.begin() as s:
        entity(s, "solo-b", {"person_id": "p1", "text": "synthetic"})
    with world.pg.begin() as s:
        entity(s, "unresolved-a", {"person_id": "p0", "reviewed_by": "p1", "value": 1})
        entity(s, "foreign-name-a", {"person_id": "p0", "name": "p1", "value": 2})
    adapter = world.make(protocol)
    apply_subject_event(adapter, event("p0"), world.root)
    with world.pg() as s:
        states = {
            key: db_copy(s, key).state for key in ("unresolved-a", "foreign-name-a")
        }
    assert states == dict.fromkeys(states, "ERASED" if erased else "PRESENT")


V4 = "ops/synthetic-review-protocol-v4.json"


@pytest.mark.parametrize(
    "later,expired",
    [("2029-06-01T13:00:00+09:00", False), ("2033-03-17T13:00:00+09:00", True)],
)
def test_v4_joint_database_review_then_deferred_expiry(world, later, expired):
    from scripts.long_subject_events import apply_deferred_expiry

    from shift_scheduler.db.compliance_models import PreservedArchive, RetentionRule

    with world.pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="operator",
                issuer="mock",
                subject="operator-account",
                person_id="operator-person",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    with world.pg.begin() as s:
        s.add(
            PlanningOutbox(
                event_id="import-both",
                scope_id=SCOPE,
                kind="actual.import",
                actor="operator-account",
                payload={
                    "person_ids": ["p0", "p1"],
                    "count": 2,
                    "source_hash": "a" * 64,
                },
                created_at=OLD,
            )
        )
        entity(s, "recent-a", {"person_id": "p0", "text": "synthetic"}, created=RECENT)
        entity(s, "solo-b", {"person_id": "p1", "text": "synthetic"})
        s.add(
            LegalHold(
                hold_id="hold-p1",
                scope_id=SCOPE,
                person_id="p1",
                active=True,
                revision=1,
                payload={},
            )
        )
    adapter = world.make(V4)
    one = apply_subject_event(adapter, event("p0"), world.root)
    with world.pg() as s:
        shared = next(
            c
            for c in s.scalars(select(ManagedCopy))
            if c.locator.get("pk", {}).get("event_id") == "import-both"
        )
        assert shared.state == "PRESENT" and db_copy(s, "recent-a").state == "PRESENT"
    assert one["review"]["preservation"]["rejected"].get("owner_under_legal_hold") == 1
    with world.pg.begin() as s:
        s.get(LegalHold, "hold-p1").active = False
        s.get(LegalHold, "hold-p1").revision += 1
    two = apply_subject_event(adapter, event("p1", SECOND_AT), world.root)
    # Both controlled owners removed together; the operator's record is kept.
    assert two["review"]["joint_database"]["approved"] == 1
    with world.pg() as s:
        assert (
            s.get(ManagedCopy, shared.copy_id).state == "ERASED"
            and s.get(PlanningOutbox, "import-both") is None
        )
        body = json.dumps([a.payload for a in s.scalars(select(PreservedArchive))])
        assert "operator-person" in body and '"p0"' not in body and '"p1"' not in body
    at = datetime.fromisoformat(later)
    deferred = apply_deferred_expiry(
        adapter, "p0", at, world.root, label="deferred-test"
    )
    with world.pg() as s:
        assert db_copy(s, "recent-a").state == ("ERASED" if expired else "PRESENT")
        reconfirmed = [r for r in s.scalars(select(RetentionRule)) if r.revision > 1]
    expected_tables = {"compliance_entities", "privacy_cases"} if expired else set()
    assert deferred["erased_profile"]["erased_by_table"] == dict.fromkeys(
        expected_tables, 1
    )
    assert deferred["actual_database_erased_count"] == len(expected_tables)
    # Both later dates are past the 2029-01-01 review date: rules are re-confirmed
    # explicitly (new revisions), never silently treated as current.
    assert reconfirmed and deferred["review"]["retention_rules_created"]
    if not expired:
        target = next(
            t
            for t in deferred["remaining"]["targets"]
            if t["blockers"] and "retention_not_expired" in t["blockers"]
        )
        assert target


def test_v5_reconfirmation_carries_only_an_unchanged_rule(world):
    from shift_scheduler.db.compliance_models import RetentionRule

    V5 = "ops/synthetic-review-protocol-v5.json"
    adapter = world.make(V5)
    at = datetime.fromisoformat("2028-03-14T13:00:00+09:00")
    first = adapter.reviewer.ensure_retention_rules(adapter, "rules-initial", at)
    assert "compliance" in first
    with world.pg.begin() as s:
        # Someone later shortened the compliance period outside the protocol.
        privacy.save_rule(
            s,
            SCOPE,
            RetentionPolicy.model_validate(
                {
                    **privacy.applicable_rule(
                        s, SCOPE, "compliance", "last_activity"
                    ).payload,
                    "retention_days": 30,
                }
            ),
            1,
            "someone",
        )
    later = datetime.fromisoformat("2033-03-01T13:00:00+09:00")
    result = adapter.reviewer.ensure_retention_rules(adapter, "rules-later", later)
    assert "compliance:rule_differs_from_protocol" in result
    assert "audit:reconfirmed" in result
    with world.pg() as s:
        compliance = privacy.applicable_rule(s, SCOPE, "compliance", "last_activity")
        audit = privacy.applicable_rule(s, SCOPE, "audit", "last_activity")
        assert compliance.revision == 2 and compliance.payload["retention_days"] == 30
        assert audit.revision == 2 and audit.payload["retention_days"] == 365
        assert audit.payload["next_review"] == "2034-03-01"
        assert len(list(s.scalars(select(RetentionRule)))) >= 7


def test_v6_reviewer_owns_control_and_export_rules(world):
    """The observer no longer creates retention rules; the registered reviewer
    does, with the same values, before the subject control is applied."""
    from shift_scheduler.db.compliance_models import RetentionRule

    seed(world)
    identity, digest = shared_file(world)
    adapter = world.make("ops/synthetic-review-protocol-v6.json")
    result = apply_subject_event(adapter, event("p0"), world.root)
    with world.pg() as s:
        rules = {
            (r.category, r.payload["anchor"]): r
            for r in s.scalars(select(RetentionRule))
        }
    control, exports = (
        rules[("control", "case_closed")],
        rules[("exports", "last_activity")],
    )
    assert (
        control.payload["retention_days"] == 3650
        and exports.payload["retention_days"] == 1
    )
    for rule in rules.values():
        assert rule.payload["evidence"]["reference"].startswith(
            "synthetic-review-protocol-v6:"
        )
        assert rule.payload["evidence"]["verified_by"] == "synthetic-protocol-reviewer"
    assert result["control"]  # the control was applied under the reviewer-owned rule


def test_erased_profile_is_taken_before_the_file_worker(world):
    """The worker rewrites the plan payload; the per-table erasure profile must
    still list the erased database rows of the execution."""
    seed(world)
    identity, digest = shared_file(world)
    adapter = world.make("ops/synthetic-review-protocol-v6.json")
    one = apply_subject_event(adapter, event("p0"), world.root)
    two = apply_subject_event(adapter, event("p1", SECOND_AT), world.root)
    for result in (one, two):
        assert (
            sum(result["erased_profile"]["erased_by_table"].values())
            == result["actual_database_erased_count"]
        )
    assert two["worker_steps"] >= 1
