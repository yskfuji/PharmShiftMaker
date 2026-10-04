"""Local signed erasure manifest; restored databases stay quarantined until replay."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from shift_scheduler.application.privacy import BUNDLE_MODELS
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ErasedSubject,
    ErasureMarker,
    ManagedCopy,
    PreservedArchive,
    PrivacyCase,
    RestoreGate,
)
from shift_scheduler.db.planning_models import PlanningHead, PlanningInputHead
from shift_scheduler.domain.planning import content_hash


def _signature(payload: dict[str, Any], secret: bytes) -> str:
    if len(secret) < 32:
        raise ValueError(
            "A separate restore-manifest signing key of at least 32 bytes is required"
        )
    return hmac.new(
        secret,
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(),
        hashlib.sha256,
    ).hexdigest()


def preservation_artifacts(session: Session) -> list[dict[str, Any]]:
    """Exact independent restore artifact shape; contents require controlled storage."""
    return [
        {
            "archive_id": row.archive_id,
            "scope_id": row.scope_id,
            "source_digest": row.source_digest,
            "payload_hash": row.payload_hash,
            "payload": row.payload,
        }
        for row in session.scalars(
            select(PreservedArchive).order_by(PreservedArchive.archive_id)
        )
    ]


def export_manifest(
    session: Session, secret: bytes, *, include_policies: bool = False
) -> dict[str, Any]:
    markers = session.scalars(
        select(ErasureMarker).order_by(
            ErasureMarker.created_at, ErasureMarker.marker_id
        )
    ).all()
    payload = {
        "version": 4,
        "erased_subjects": [
            {
                "facility_id": r.facility_id,
                "person_id": r.person_id,
                "plan_id": r.plan_id,
                "created_at": r.created_at.isoformat(),
                "evidence": r.evidence,
            }
            for r in session.scalars(
                select(ErasedSubject).order_by(
                    ErasedSubject.facility_id, ErasedSubject.person_id
                )
            )
        ],
        "managed_copies": [
            {
                "copy_id": r.copy_id,
                "scope_id": r.scope_id,
                "category": r.category,
                "medium": r.medium,
                "locator": r.locator,
                "content_hash": r.content_hash,
                "revision": r.revision,
                "state": r.state,
                "subject_status": r.subject_status,
                "anchor": r.anchor,
                "anchor_at": r.anchor_at.isoformat(),
                "evidence": r.evidence,
                "person_ids": list(
                    session.scalars(
                        select(CopySubject.person_id).where(
                            CopySubject.copy_id == r.copy_id
                        )
                    )
                ),
            }
            for r in session.scalars(
                select(ManagedCopy).where(ManagedCopy.state == "ERASED")
            )
        ],
        "issued_at": datetime.now(UTC).isoformat(),
        "restrictions": [
            {
                "case_id": case.case_id,
                "scope_id": case.scope_id,
                "person_id": case.person_id,
                "revision": case.revision,
                "status": case.status,
                "payload": case.payload,
            }
            for case in session.scalars(
                select(PrivacyCase).where(
                    PrivacyCase.kind == "restrict",
                )
            )
        ],
        "markers": [
            {
                "marker_id": r.marker_id,
                "plan_id": r.plan_id,
                "scope_id": r.scope_id,
                "table": r.table_name,
                "key": r.object_key,
                "prior_hash": r.prior_hash,
            }
            for r in markers
        ],
    }
    archives = list(
        session.scalars(select(PreservedArchive).order_by(PreservedArchive.archive_id))
    )
    if archives:
        payload["version"] = 6
        # The control manifest never duplicates the remaining people's payload.
        archive_requirements: list[dict[str, Any]] = [
            {
                "archive_id": r.archive_id,
                "scope_id": r.scope_id,
                "source_digest": r.source_digest,
                "payload_hash": r.payload_hash,
                "created_at": r.created_at.isoformat(),
            }
            for r in archives
        ]
        payload["preserved_archives"] = archive_requirements
        for requirement in archive_requirements:
            tracked = [
                c
                for c in session.scalars(select(ManagedCopy))
                if c.locator.get("table") == "preserved_archives"
                and c.locator.get("pk") == {"archive_id": requirement["archive_id"]}
                and c.state == "PRESENT"
            ]
            if len(tracked) != 1:
                raise ValueError(
                    "Preserved history must have exactly one current copy record"
                )
            c = tracked[0]
            requirement["retention"] = {
                "category": c.category,
                "anchor": c.anchor,
                "anchor_at": c.anchor_at.isoformat(),
                "subject_status": c.subject_status,
                "evidence": c.evidence,
            }
    if include_policies:
        from shift_scheduler.db.compliance_models import LegalHold, RetentionRule

        payload["version"] = 7
        payload.setdefault("preserved_archives", [])
        payload["retention_rules"] = [
            {
                "key": r.key,
                "scope_id": r.scope_id,
                "category": r.category,
                "revision": r.revision,
                "payload": r.payload,
            }
            for r in session.scalars(select(RetentionRule).order_by(RetentionRule.key))
        ]
        payload["legal_holds"] = [
            {
                "hold_id": r.hold_id,
                "scope_id": r.scope_id,
                "person_id": r.person_id,
                "active": r.active,
                "revision": r.revision,
                "payload": r.payload,
            }
            for r in session.scalars(select(LegalHold).order_by(LegalHold.hold_id))
        ]
    return {"payload": payload, "signature": _signature(payload, secret)}


def quarantine(session: Session) -> None:
    session.merge(RestoreGate(gate_id="restore", state="QUARANTINED"))


def replay(
    session: Session,
    manifest: dict[str, Any],
    expected_hash: str,
    secret: bytes,
    preservation_artifacts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """expected_hash must come from the independent current erasure register, not the backup."""
    gate = session.get(RestoreGate, "restore")
    if not gate or gate.state != "QUARANTINED":
        raise ValueError("Restore must first enter committed quarantine")
    if content_hash(manifest) != expected_hash or not hmac.compare_digest(
        _signature(manifest["payload"], secret), manifest["signature"]
    ):
        raise ValueError(
            "Manifest signature or independent current manifest hash differs"
        )
    payload = manifest["payload"]
    if payload.get("version") not in {1, 2, 3, 4, 5, 6, 7}:
        raise ValueError("Unsupported manifest version")
    if payload["version"] >= 3 and "erased_subjects" not in payload:
        raise ValueError("V3 manifest must declare subject erasure controls")
    if payload["version"] >= 5 and "preserved_archives" not in payload:
        raise ValueError("V5 manifest must declare preservation requirements")
    if payload["version"] >= 7:
        from shift_scheduler.db.compliance_models import LegalHold, RetentionRule

        policy_models: tuple[
            tuple[str, type[RetentionRule] | type[LegalHold], str], ...
        ] = (
            ("retention_rules", RetentionRule, "key"),
            ("legal_holds", LegalHold, "hold_id"),
        )
        for field, policy_model, identity in policy_models:
            if field not in payload:
                raise ValueError("V7 control manifest must include policies and holds")
            authoritative_ids = {value[identity] for value in payload[field]}
            if len(authoritative_ids) != len(payload[field]):
                raise ValueError("Duplicate independent policy/hold identity")
            if any(
                getattr(row, identity) not in authoritative_ids
                for row in session.scalars(select(policy_model))
            ):
                raise ValueError(
                    "Restored policy/hold is absent from the independent authority"
                )
            for value in payload[field]:
                existing = cast(
                    "RetentionRule | LegalHold | None",
                    session.get(policy_model, value[identity]),
                )
                if existing and (
                    existing.revision > value["revision"]
                    or (
                        existing.revision == value["revision"]
                        and any(
                            getattr(existing, key) != val for key, val in value.items()
                        )
                    )
                ):
                    raise ValueError(
                        "Restored policy/hold conflicts with independent authority"
                    )
                session.merge(policy_model(**value))
    supplied = {a["archive_id"]: a for a in preservation_artifacts or []}
    if len(supplied) != len(preservation_artifacts or []):
        raise ValueError("Duplicate preservation artifact")
    required = {a["archive_id"]: a for a in payload.get("preserved_archives", [])}
    if set(supplied) - set(required):
        raise ValueError("Unapproved preservation artifact")
    prepared_archives = []
    for identity, requirement in required.items():
        row = session.get(PreservedArchive, identity)
        source: dict[str, Any] | None = (
            {
                "archive_id": row.archive_id,
                "scope_id": row.scope_id,
                "source_digest": row.source_digest,
                "payload_hash": row.payload_hash,
                "payload": row.payload,
            }
            if row
            else supplied.get(identity)
        )
        if (
            not source
            or any(
                source.get(k) != requirement[k]
                for k in ("archive_id", "scope_id", "source_digest", "payload_hash")
            )
            or content_hash(source["payload"]) != requirement["payload_hash"]
            or source["payload"].get("archive_format") != "partial-planning-history-v1"
            or source["payload"].get("replayable") is not False
            or source["payload"].get("publishable") is not False
        ):
            raise ValueError(
                "Required preserved history is missing or changed; keep restore quarantined"
            )
        if not row:
            fields = {
                k: requirement[k]
                for k in ("archive_id", "scope_id", "source_digest", "payload_hash")
            }
            if payload["version"] >= 6:
                fields["created_at"] = datetime.fromisoformat(requirement["created_at"])
            prepared_archives.append(
                PreservedArchive(**fields, payload=source["payload"])
            )
    session.add_all(prepared_archives)
    session.flush()
    if payload["version"] >= 6:
        for identity, requirement in required.items():
            retention = requirement["retention"]
            row = session.get(PreservedArchive, identity)
            if row is None or row.created_at != datetime.fromisoformat(
                requirement["created_at"]
            ):
                # add_all/flush above guarantees presence; a missing row is a changed archive.
                raise ValueError("Preserved history creation time differs")
            tracked = [
                c
                for c in session.scalars(select(ManagedCopy))
                if c.locator.get("table") == "preserved_archives"
                and c.locator.get("pk") == {"archive_id": identity}
                and c.state == "PRESENT"
            ]
            if len(tracked) != 1:
                raise ValueError("Restored preserved history copy is missing")
            c = tracked[0]
            c.category, c.anchor = retention["category"], retention["anchor"]
            c.anchor_at = datetime.fromisoformat(retention["anchor_at"])
            c.subject_status, c.evidence = (
                retention["subject_status"],
                retention["evidence"],
            )
    models = {m.__tablename__: m for m in BUNDLE_MODELS}
    # Check complete scope before changing anything. Old revisions are not silently relabelled.
    for marker in payload["markers"]:
        if marker["table"] not in models:
            raise ValueError("Unknown erasure table")
    removed = 0
    # Deletion ordering follows dependencies, not arbitrary marker timestamps.
    for model in BUNDLE_MODELS:
        for marker in payload["markers"]:
            if marker["table"] != model.__tablename__:
                continue
            obj = session.get(model, marker["key"])
            if obj is not None:
                # The immutable identifier is the erasure authority across older backup versions;
                # the marker records the later pre-erasure hash, not the hash of this restored version.
                if model.__tablename__ == "planning_inputs":
                    for head in session.scalars(
                        select(PlanningInputHead).where(
                            PlanningInputHead.input_hash == marker["key"]
                        )
                    ):
                        session.delete(head)
                if model.__tablename__ == "planning_publications":
                    for published_head in session.scalars(
                        select(PlanningHead).where(
                            PlanningHead.publication_id == marker["key"]
                        )
                    ):
                        published_head.publication_id = None
                session.flush()
                session.delete(obj)
                session.flush()
                removed += 1
            session.merge(
                ErasureMarker(
                    marker_id=marker["marker_id"],
                    plan_id=marker["plan_id"],
                    scope_id=marker["scope_id"],
                    table_name=marker["table"],
                    object_key=marker["key"],
                    prior_hash=marker["prior_hash"],
                )
            )
    database_copies = [
        item
        for item in payload.get("managed_copies", [])
        if item["medium"] == "database"
    ]
    if database_copies:
        if payload["version"] < 4:
            raise ValueError("Database erasure requires V4 signed controls")
        from sqlalchemy import delete

        from shift_scheduler.application.database_erasure import lock_inventory, resolve
        from shift_scheduler.db.base import Base

        lock_inventory(session)
        order = {
            table.name: index
            for index, table in enumerate(reversed(Base.metadata.sorted_tables))
        }
        for item in sorted(
            database_copies, key=lambda r: order.get(r["locator"].get("table"), -1)
        ):
            if item["state"] != "ERASED":
                raise ValueError("Unapproved database erasure control")
            fields = {key: value for key, value in item.items() if key != "person_ids"}
            fields["anchor_at"] = datetime.fromisoformat(fields["anchor_at"])
            control = ManagedCopy(**fields)
            table, where = resolve(control)
            restored = session.execute(select(table).where(*where)).mappings().first()
            if restored is not None:
                if (
                    restored.get("scope_id")
                    and restored["scope_id"] != item["scope_id"]
                ):
                    raise ValueError(
                        "Restored database identity belongs to another scope"
                    )
                session.execute(delete(table).where(*where))
                removed += 1
            session.merge(control)
            session.flush()
            for person in item["person_ids"]:
                session.merge(CopySubject(copy_id=item["copy_id"], person_id=person))
    for item in payload.get("managed_copies", []):
        from shift_scheduler.application.copies import checked_file, file_digest

        if item["medium"] == "database":
            continue
        if item["state"] != "ERASED" or item["medium"] not in {"file", "backup"}:
            raise ValueError("Unsupported restored copy erasure evidence")
        path = checked_file(item["locator"]["relative_path"])
        if path.exists() and (
            not path.is_file() or file_digest(path) != item["content_hash"]
        ):
            raise ValueError("Restored managed file differs from approved erased copy")
        from shift_scheduler.application.copies import storage_root
        from shift_scheduler.ops.managed_erasure import erase_verified

        # Resume a captured file even when its original pathname is absent.
        # Never open the restore gate while a crash remnant remains in quarantine.
        erase_verified(
            storage_root(),
            item["locator"]["relative_path"],
            item["copy_id"],
            item["content_hash"],
        )
        fields = {key: value for key, value in item.items() if key != "person_ids"}
        fields["anchor_at"] = datetime.fromisoformat(fields["anchor_at"])
        session.merge(ManagedCopy(**fields))
        session.flush()
        for person in item["person_ids"]:
            session.merge(CopySubject(copy_id=item["copy_id"], person_id=person))
    for restriction in payload.get("restrictions", []):
        session.merge(PrivacyCase(**restriction, kind="restrict"))
    session.flush()
    # Old backups do not contain the latest subject-level write barriers. Keep
    # the gate closed if their operational records were not erased by this replay.
    from shift_scheduler.application.copy_graph import database_inventory

    for item in payload.get("erased_subjects", []):
        remaining = database_inventory(
            session, item["facility_id"] + "/__restore__", item["person_id"]
        )
        if remaining["records"]:
            raise ValueError(
                "Restored erased subject still has operational database copies"
            )
        session.merge(
            ErasedSubject(
                **{key: value for key, value in item.items() if key != "created_at"},
                created_at=datetime.fromisoformat(item["created_at"]),
            )
        )
    session.flush()
    if session.get_bind().dialect.name == "postgresql" and session.scalar(
        text("SELECT to_regclass('pharmshift_restore_control.gate')")
    ):
        session.execute(
            text("UPDATE pharmshift_restore_control.gate SET state='REPLAYED'")
        )
    gate.state = "REPLAYED"
    gate.marker_manifest_hash = expected_hash
    return {"removed": removed, "state": "REPLAYED", "manifest_hash": expected_hash}
