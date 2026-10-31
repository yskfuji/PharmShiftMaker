"""Tests for staff name revision (marital surname change, former-name co-display,
Family Court-permitted official name change, and Pharmacist Act Art. 9 registry verification).
"""

from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from shift_scheduler.application import compliance as service
from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import ComplianceEntity, ComplianceRevision
from shift_scheduler.db.planning_models import PlanningScope
from shift_scheduler.domain.planning import Evidence, Person, content_hash


def test_legacy_person_serialization_and_hash_remain_identical() -> None:
    legacy = Person(person_id="p-legacy", name="佐藤 花子")
    dumped = legacy.model_dump(mode="json")
    assert dumped == {"person_id": "p-legacy", "name": "佐藤 花子"}
    assert content_hash(dumped) == content_hash(
        {"person_id": "p-legacy", "name": "佐藤 花子"}
    )


def test_marital_surname_change_and_former_name_co_display_validates() -> None:
    revised = Person(
        person_id="p-1",
        name="佐藤 花子",
        legal_name="高橋 花子",
        former_names=("佐藤 花子",),
        name_change_category="surname_change",
        effective_on=date(2026, 10, 1),
        pharmacist_registry_status="pending_30day_filing",
        evidence=Evidence(
            reference="人事届出 HR-2026-1001",
            status="verified",
            verified_by="admin-pharm-01",
        ),
    )
    dumped = revised.model_dump(mode="json")
    assert dumped["person_id"] == "p-1"
    assert dumped["name"] == "佐藤 花子"
    assert dumped["legal_name"] == "高橋 花子"
    assert dumped["former_names"] == ["佐藤 花子"]
    assert dumped["name_change_category"] == "surname_change"
    assert dumped["effective_on"] == "2026-10-01"
    assert dumped["pharmacist_registry_status"] == "pending_30day_filing"


def test_court_permitted_official_name_change_and_pharmacist_act_art9_verification() -> (
    None
):
    revised = Person(
        person_id="p-2",
        name="青木 健一",
        legal_name="青木 健一",
        former_names=("鈴木 健一",),
        name_change_category="court_permitted_change",
        effective_on=date(2026, 10, 15),
        pharmacist_registry_status="verified",
        evidence=Evidence(
            reference="家裁審判書確認・薬剤師名簿書換交付済 REG-2026-88",
            status="verified",
            verified_by="admin-pharm-01",
        ),
    )
    assert revised.pharmacist_registry_status == "verified"
    assert revised.evidence is not None
    assert revised.evidence.status == "verified"


def test_counterexamples_rejected_by_domain_validator() -> None:
    # 1. Marital or court-permitted change without effective_on or evidence is rejected.
    with pytest.raises(
        ValidationError, match="effective date and verification evidence"
    ):
        Person(
            person_id="p-1",
            name="高橋 花子",
            name_change_category="surname_change",
        )

    # 2. Verified pharmacist registry status without verified evidence is rejected.
    with pytest.raises(ValidationError, match="Verified pharmacist registry change"):
        Person(
            person_id="p-1",
            name="高橋 花子",
            name_change_category="surname_change",
            effective_on=date(2026, 10, 1),
            pharmacist_registry_status="verified",
            evidence=Evidence(reference="届出受付のみ", status="unverified"),
        )

    # 3. Blank legal_name or duplicate former_names are rejected.
    with pytest.raises(ValidationError, match="Legal name cannot be blank"):
        Person(person_id="p-1", name="高橋 花子", legal_name="   ")

    with pytest.raises(
        ValidationError, match="Former names must be non-empty and unique"
    ):
        Person(
            person_id="p-1",
            name="高橋 花子",
            former_names=("佐藤 花子", "佐藤 花子"),
        )


def test_save_entity_versions_person_name_revisions_with_cas() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    scope = "central-hosp/pharmacy"
    with Session(engine) as session:
        session.add(
            PlanningScope(
                scope_id=scope,
                display_name="薬剤部",
                data_revision=1,
            )
        )
        session.commit()

        # Revision 1: initial registration
        rev1 = service.save_entity(
            session,
            scope,
            "person",
            {"person_id": "p-pharmacist-1", "name": "佐藤 花子"},
            expected=0,
            actor="admin-1",
        )
        session.commit()
        assert rev1.revision == 1
        assert rev1.payload == {"person_id": "p-pharmacist-1", "name": "佐藤 花子"}

        # Revision 2: marital surname change + former-name search + Pharmacist Act Art. 9 verification
        rev2 = service.save_entity(
            session,
            scope,
            "person",
            {
                "person_id": "p-pharmacist-1",
                "name": "高橋 花子",
                "legal_name": "高橋 花子",
                "former_names": ["佐藤 花子"],
                "name_change_category": "surname_change",
                "effective_on": "2026-10-01",
                "pharmacist_registry_status": "verified",
                "evidence": {
                    "reference": "人事届出 HR-2026-1001・名簿書換確認",
                    "status": "verified",
                    "verified_by": "admin-1",
                    "valid_until": None,
                },
            },
            expected=1,
            actor="admin-1",
        )
        session.commit()
        assert rev2.revision == 2
        assert rev2.payload["former_names"] == ["佐藤 花子"]
        assert rev2.payload["pharmacist_registry_status"] == "verified"

        revisions = list(
            session.scalars(
                select(ComplianceRevision)
                .where(ComplianceRevision.entity_key == rev2.key)
                .order_by(ComplianceRevision.revision)
            )
        )
        assert len(revisions) == 2
        assert revisions[0].payload["name"] == "佐藤 花子"
        assert revisions[1].payload["name"] == "高橋 花子"
        assert revisions[1].payload["former_names"] == ["佐藤 花子"]
        stored_entity = session.get(ComplianceEntity, rev2.key)
        assert stored_entity is not None
        assert stored_entity.person_id == "p-pharmacist-1"


def test_person_name_revision_covered_by_privacy_and_database_erasure_inventory() -> (
    None
):
    """ID-2 & ID-3: Former names and legal names are surfaced in privacy subject listings,
    staged overlays, and owned database erasure inventories (both entity and revision rows).
    """
    from shift_scheduler.application import copy_graph, privacy

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    scope = "central-hosp/pharmacy"
    with Session(engine) as session:
        session.add(
            PlanningScope(
                scope_id=scope,
                display_name="薬剤部",
                data_revision=1,
            )
        )
        session.commit()

        # Register initial person and then a marital surname revision with former_names & legal_name
        service.save_entity(
            session,
            scope,
            "person",
            {"person_id": "p-pharmacist-1", "name": "佐藤 花子"},
            expected=0,
            actor="admin-1",
        )
        rev2 = service.save_entity(
            session,
            scope,
            "person",
            {
                "person_id": "p-pharmacist-1",
                "name": "高橋 花子",
                "legal_name": "高橋 花子",
                "former_names": ["佐藤 花子"],
                "name_change_category": "surname_change",
                "effective_on": "2026-10-01",
                "pharmacist_registry_status": "pending_30day_filing",
                "evidence": {
                    "reference": "人事届出 HR-2026-1001",
                    "status": "verified",
                    "verified_by": "admin-1",
                    "valid_until": None,
                },
            },
            expected=1,
            actor="admin-1",
        )
        # Also register a person using former surname at workplace with distinct legal_name
        service.save_entity(
            session,
            scope,
            "person",
            {
                "person_id": "p-pharmacist-2",
                "name": "鈴木 美咲",
                "legal_name": "渡辺 美咲",
                "former_names": ["鈴木 美咲"],
                "name_change_category": "surname_change",
                "effective_on": "2026-10-10",
                "pharmacist_registry_status": "verified",
                "evidence": {
                    "reference": "人事届出 HR-2026-1010",
                    "status": "verified",
                    "verified_by": "admin-1",
                    "valid_until": None,
                },
            },
            expected=0,
            actor="admin-1",
        )
        session.commit()

        # 1. Privacy subject discovery and formatted name labels (ID-2 & ID-3)
        subjects = privacy.scoped_people(session, scope)
        assert subjects == {"p-pharmacist-1", "p-pharmacist-2"}
        subject_names = privacy.scoped_person_names(session, scope)
        assert subject_names == {
            "p-pharmacist-1": "高橋 花子（旧姓：佐藤 花子）",
            "p-pharmacist-2": "鈴木 美咲（戸籍名：渡辺 美咲）",
        }

        # 2. Compliance overlay carries full revised Person payload into staged planning inputs
        overlaid = service.overlay(
            session,
            scope,
            {
                "people": [
                    {"person_id": "p-pharmacist-1", "name": "佐藤 花子"},
                ]
            },
        )
        assert len(overlaid["people"]) == 2
        by_id = {p["person_id"]: p for p in overlaid["people"]}
        assert by_id["p-pharmacist-1"]["name"] == "高橋 花子"
        assert by_id["p-pharmacist-1"]["legal_name"] == "高橋 花子"
        assert by_id["p-pharmacist-1"]["former_names"] == ["佐藤 花子"]
        assert by_id["p-pharmacist-2"]["name"] == "鈴木 美咲"
        assert by_id["p-pharmacist-2"]["legal_name"] == "渡辺 美咲"

        # 3. Database erasure inventory attributes both compliance_entities and all compliance_revisions
        #    (containing the historical and revised names) to p-pharmacist-1
        db_inv = copy_graph.database_inventory(session, scope, "p-pharmacist-1")
        owned_records = db_inv["records"]
        owned_tables = {r["table"] for r in owned_records}
        assert "compliance_entities" in owned_tables
        assert "compliance_revisions" in owned_tables
        entity_rows = [r for r in owned_records if r["table"] == "compliance_entities"]
        assert len(entity_rows) == 1
        assert entity_rows[0]["scope_known"] is True
        revision_rows = [
            r for r in owned_records if r["table"] == "compliance_revisions"
        ]
        assert len(revision_rows) == 2
        assert rev2.revision == 2
