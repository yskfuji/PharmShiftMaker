# pyright: reportAttributeAccessIssue=false, reportArgumentType=false, reportCallIssue=false, reportUnhashable=false
"""Typed database provenance; text equality is never evidence of ownership.

Physical foreign keys and explicitly named JSON references are distinguished.
Unknown free text and unscoped legacy rows remain reviewable residuals.
"""

from datetime import date, datetime

from sqlalchemy import select

from shift_scheduler.db.base import Base
from shift_scheduler.domain.planning import content_hash

CONTROL = {
    "control_commits",
    "managed_copies",
    "copy_subjects",
    "copy_erasures",
    "erasure_markers",
    "erasure_plans",
    "restore_gates",
    "retention_rules",
    "legal_holds",
    "erased_subjects",
    "planning_scopes",
}
LOGICAL = {
    "input_hash": ("planning_inputs", "input_hash"),
    "draft_id": ("planning_drafts", "draft_id"),
    "publication_id": ("planning_publications", "publication_id"),
    "source_publication_id": ("planning_publications", "publication_id"),
    "job_id": ("planning_jobs", "job_id"),
    "request_id": ("planning_requests", "request_id"),
    "case_id": None,
    "membership_id": ("account_memberships", "membership_id"),
    "source_input_hash": ("planning_inputs", "input_hash"),
    "entity_key": ("compliance_entities", "key"),
    "grant_id": ("planning_leave_balances", "grant_id"),
}


def logical_target(row, key):
    """Resolve overloaded logical IDs using their producer contract."""
    if key != "case_id":
        return LOGICAL[key]
    if row["table"] != "planning_outbox":
        return None  # Workflow event tables already carry physical foreign keys.
    kind = row["payload"].get("kind", "")
    if kind.startswith("privacy."):
        return "privacy_cases", "case_id"
    if kind.startswith("change."):
        return "planning_change_cases", "case_id"
    if kind.startswith("lifecycle."):
        return "staff_lifecycle_cases", "case_id"
    return None


def normalized(value):
    if isinstance(value, date | datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: normalized(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [normalized(v) for v in value]
    return value


def typed_values(value, names):
    """Yield declared keys only; prose and bare matching IDs are ignored."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key in names and isinstance(child, str):
                yield key, child
            elif (
                key == "person_ids" and "person_id" in names and isinstance(child, list)
            ):
                for person in child:
                    if isinstance(person, str):
                        yield "person_id", person
            else:
                yield from typed_values(child, names)
    elif isinstance(value, list):
        for child in value:
            yield from typed_values(child, names)


def database_inventory(session, scope, person):
    from shift_scheduler.db.compliance_models import CopyErasure

    prefix = scope.split("/")[0] + "/"
    copy_plans = set(session.scalars(select(CopyErasure.plan_id)))
    records, indices = [], {}
    for mapper in sorted(Base.registry.mappers, key=lambda m: m.local_table.name):
        table = mapper.local_table
        if table.name in CONTROL:
            continue
        for source in session.execute(select(table)).mappings():
            payload = normalized(dict(source))
            if table.name == "planning_outbox" and payload["kind"].startswith(
                ("copy.", "erasure.")
            ):
                continue
            if (
                table.name == "planning_receipts"
                and payload.get("response", {}).get("plan_id") in copy_plans
            ):
                continue
            row_scope = payload.get("scope_id")
            if row_scope and not row_scope.startswith(prefix):
                continue
            pk = {c.name: payload[c.name] for c in table.primary_key}
            from shift_scheduler.application.subject_references import (
                account_references,
            )

            accounts = account_references(session, row_scope, payload)
            entry = {
                "table": table.name,
                "object": content_hash([table.name, pk]),
                "hash": content_hash(payload),
                "pk": pk,
                "payload": payload,
                "owners": {v for _, v in typed_values(payload, {"person_id"})}
                | {p for ref in accounts for p in ref["person_ids"]},
                "account_references": accounts,
                "scopes": {row_scope} if row_scope else set(),
                "parents": [],
                "edges": [],
                "metadata": table,
            }
            records.append(entry)
            for name, value in payload.items():
                if isinstance(value, str | int):
                    indices.setdefault((table.name, name, value), []).append(entry)
    for row in records:
        table, payload = row["metadata"], row["payload"]
        for constraint in table.foreign_key_constraints:
            elements = list(constraint.elements)
            if not elements or elements[0].column.table.name in CONTROL:
                continue
            first = elements[0]
            candidates = indices.get(
                (
                    first.column.table.name,
                    first.column.name,
                    payload[first.parent.name],
                ),
                [],
            )
            for parent in candidates:
                if all(
                    parent["payload"][e.column.name] == payload[e.parent.name]
                    for e in elements
                ):
                    row["parents"].append(parent)
                    row["edges"].append(
                        {"target": parent["object"], "kind": "physical_fk"}
                    )
                    # Aggregate containers inherit children; a shared profile must
                    # never spread its people back to an unrelated timeline entry.
                    if (row["table"], parent["table"]) in {
                        ("staff_timeline", "profiles"),
                        ("schedule_assignments", "schedules"),
                    }:
                        parent["parents"].append(row)
                        row["parents"].remove(parent)
        for key, value in typed_values(payload, set(LOGICAL)):
            target = logical_target(row, key)
            if target is None:
                continue
            target_table, target_column = target
            if target_table == row["table"] and key != "source_publication_id":
                continue
            for parent in indices.get((target_table, target_column, value), []):
                if parent["object"] == row["object"]:
                    continue
                if all(p["object"] != parent["object"] for p in row["parents"]):
                    row["parents"].append(parent)
                    row["edges"].append(
                        {"target": parent["object"], "kind": "logical_json"}
                    )
    changed = True
    while changed:
        changed = False
        for row in records:
            owners, scopes = set(row["owners"]), set(row["scopes"])
            for parent in row["parents"]:
                owners.update(parent["owners"])
                scopes.update(parent["scopes"])
            if owners != row["owners"] or scopes != row["scopes"]:
                row["owners"], row["scopes"] = owners, scopes
                changed = True
    return {
        "records": [
            {
                "table": r["table"],
                "object": r["object"],
                "hash": r["hash"],
                "scope_known": bool(r["scopes"]),
                "references": r["edges"],
                "subject_method": "structured_fields_and_typed_relationships",
                "account_references": r["account_references"],
            }
            for r in records
            if person in r["owners"]
        ],
        "unclassified_text_records": sorted(
            r["object"] for r in records if not r["owners"] or not r["scopes"]
        ),
        "control_metadata_retained": sorted(CONTROL),
        "control_records_remaining": control_inventory(session, scope, person),
        "complete": False,
    }


def control_inventory(session, scope, person):
    """Retained controls are personal-data residuals, not an erasure exemption.

    No automatic deletion: source prevention and restore evidence have their own
    purpose and require a reviewed retention decision. Unknown/global ownership
    is explicit and never interpreted as an empty inventory.
    """
    from shift_scheduler.db.compliance_models import CopySubject, RetentionRule

    prefix = scope.split("/")[0] + "/"
    copies = set(
        session.scalars(
            select(CopySubject.copy_id).where(CopySubject.person_id == person)
        )
    )
    entries = []
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table.name not in CONTROL | {"planning_outbox", "planning_receipts"}:
            continue
        for source in session.execute(select(table)).mappings():
            row = normalized(dict(source))
            row_scope = row.get("scope_id")
            if row_scope and not row_scope.startswith(prefix):
                continue
            if row.get("facility_id") and row["facility_id"] != scope.split("/")[0]:
                continue
            if table.name == "planning_outbox" and not row["kind"].startswith(
                ("copy.", "erasure.")
            ):
                continue
            from shift_scheduler.application.subject_references import (
                account_references,
            )

            accounts = account_references(session, row_scope or scope, row)
            entries.append(
                {
                    "table": table,
                    "row": row,
                    "owners": {v for _, v in typed_values(row, {"person_id"})}
                    | {p for reference in accounts for p in reference["person_ids"]},
                    "copy_match": any(
                        v in copies for _, v in typed_values(row, {"copy_id"})
                    ),
                }
            )
    plans = {
        entry["row"]["plan_id"]
        for entry in entries
        if entry["row"].get("plan_id")
        and (person in entry["owners"] or entry["copy_match"])
    }
    result = []
    rules = list(
        session.scalars(
            select(RetentionRule).where(RetentionRule.scope_id.startswith(prefix))
        )
    )
    for entry in entries:
        row, table = entry["row"], entry["table"]
        direct = person in entry["owners"] or entry["copy_match"]
        linked = any(v in plans for _, v in typed_values(row, {"plan_id"}))
        global_control = not entry["owners"] and table.name in {
            "control_commits",
            "restore_gates",
            "retention_rules",
            "legal_holds",
            "planning_scopes",
        }
        if not (direct or linked or global_control):
            continue
        category = row.get("category", "control")
        policies = [
            r
            for r in rules
            if r.category == category
            and (not row.get("scope_id") or r.scope_id == row["scope_id"])
        ]
        result.append(
            {
                "table": table.name,
                "object": content_hash(
                    [table.name, {c.name: row[c.name] for c in table.primary_key}]
                ),
                "hash": content_hash(row),
                "revision": row.get("revision"),
                "subject_relation": (
                    "structured"
                    if direct
                    else "plan_reference" if linked else "shared_or_unresolved_control"
                ),
                "purpose": "消去・保全・復元の整合性と再作成防止",
                "state": "RETAINED_CONTROL",
                "retention_status": (
                    "RULE_REQUIRES_APPLICABILITY_REVIEW" if policies else "RULE_MISSING"
                ),
                "rule_references": [
                    {"key": r.key, "revision": r.revision} for r in policies
                ],
                "reason": "制御記録の保存根拠と必要期間の個別判断が必要。消去完了件数へ算入しない。",
            }
        )
    return sorted(result, key=lambda row: (row["table"], row["object"]))
