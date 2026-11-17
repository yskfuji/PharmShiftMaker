from datetime import UTC, datetime

from sqlalchemy import select

from shift_scheduler.application import copies, privacy
from shift_scheduler.application.shared_projection import proposal
from shift_scheduler.db.compliance_models import (
    ComplianceEntity,
    ComplianceRevision,
    CopySubject,
    ManagedCopy,
    PreservedArchive,
)
from shift_scheduler.db.planning_models import AccountMembership
from shift_scheduler.domain.copies import DatabaseCopyReview, SharedProjectionReview
from shift_scheduler.domain.privacy import RetentionPolicy
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE


def test_shared_compliance_revision_preserves_other_actor_and_original_clock(pg):
    anchor = datetime(2020, 1, 1, tzinfo=UTC)
    with pg.begin() as s:
        s.add(
            AccountMembership(
                membership_id="reviewer",
                issuer="oidc",
                subject="account1",
                person_id="p1",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
        privacy.save_rule(
            s,
            SCOPE,
            RetentionPolicy(
                category="compliance",
                purpose="closed synthetic history",
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
        s.add(
            ComplianceEntity(
                key="owner",
                scope_id=SCOPE,
                kind="person",
                entity_id="p0",
                person_id="p0",
                revision=1,
                payload={"person_id": "p0", "name": "Synthetic only"},
                created_at=anchor,
            )
        )
        s.flush()
        s.add(
            ComplianceRevision(
                key="shared",
                entity_key="owner",
                revision=1,
                payload={"person_id": "p0", "name": "Synthetic only"},
                actor="account1",
                created_at=anchor,
            )
        )
    with pg.begin() as s:
        for row in list(
            s.scalars(select(ManagedCopy).where(ManagedCopy.category == "compliance"))
        ):
            people = tuple(
                s.scalars(
                    select(CopySubject.person_id).where(
                        CopySubject.copy_id == row.copy_id
                    )
                )
            )
            copies.review_database_copy(
                s,
                SCOPE,
                DatabaseCopyReview(
                    copy_id=row.copy_id,
                    content_hash=row.content_hash,
                    person_ids=people,
                    evidence=EVIDENCE,
                ),
                row.revision,
                "operator",
                AT,
            )
            if set(people) == {"p0", "p1"}:
                projected = proposal(s, row, "p0")
                copies.review_shared_projection(
                    s,
                    SCOPE,
                    SharedProjectionReview(
                        copy_id=row.copy_id,
                        person_id="p0",
                        content_hash=row.content_hash,
                        projection_hash=projected["payload_hash"],
                        shared_text_reviewed=True,
                        evidence=EVIDENCE,
                    ),
                    row.revision,
                    "operator",
                    AT,
                )
        plan = copies.preview(s, SCOPE, "p0", "operator", AT)
        result = copies.execute(
            s, SCOPE, plan["plan_id"], plan["fingerprint"], 1, "operator", AT
        )
        assert len(result["erased_database_copy_ids"]) == 2
        assert len(result["preserved_archive_ids"]) == 1
    with pg() as s:
        assert s.get(ComplianceEntity, "owner") is None
        assert s.get(ComplianceRevision, "shared") is None
        preserved = s.scalar(select(PreservedArchive))
        assert preserved.payload["record_type"] == "subject-record"
        assert preserved.payload["retained"]["people"] == [{"person_id": "p1"}]
        assert preserved.payload["retained"]["subject_records"][0]["data"] == {}
        copy = next(
            r
            for r in s.scalars(select(ManagedCopy))
            if r.locator.get("pk") == {"archive_id": preserved.archive_id}
        )
        assert copy.anchor_at == anchor
