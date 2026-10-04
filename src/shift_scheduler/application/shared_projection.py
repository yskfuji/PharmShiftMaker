"""Schema-specific preservation of the other people in a closed planning input.

No generic JSON redaction: every supported collection has a declared ownership
rule. Unknown fields and unresolved requests block projection. Free text still
requires a hash-bound human review of the complete replacement.
"""

from collections.abc import Collection, Mapping
from copy import deepcopy
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.db.compliance_models import ManagedCopy, PreservedArchive
from shift_scheduler.domain.compliance import parse_snapshot
from shift_scheduler.domain.planning import content_hash

PERSON_COLLECTIONS = {
    "people",
    "contracts",
    "capabilities",
    "candidates",
    "history",
    "restrictions",
    "grants",
    "leaves",
    "reservation_credits",
    "preferences",
    "burden_history",
    "employments",
    "management_models",
    "leave_policies",
    "leave_accounts",
    "leave_obligations",
    "grant_amendments",
    "leave_amendments",
    "outside_declarations",
    "flex_enrollments",
}
COMMON = {
    "schema_version",
    "source_revision",
    "facility_id",
    "department_id",
    "period",
    "context",
    "timezone",
    "rule_revision",
    "policy_evidence",
    "history_complete",
    "candidate_catalog_complete",
    "week_start",
    "demands",
    "overtime_agreements",
    "lookahead_days",
    "lookahead_demand_confirmed",
    "agreements",
    "establishments",
    "rule_reviews",
    "rule_decisions",
    "site_attribution_decisions",
    "annual_calendars",
    "flex_adoptions",
    "duty_templates",
    "catalogue_evidence",
    "fairness_history_evidence",
}
DEPENDENT = {
    "work_terms",
    "leave_records",
    "ledger_recordings",
    "previous_duty_ids",
    "unresolved_requests",
    "replaces_publication_id",
    "accounting_transitions",
}


def project(
    payload: dict[str, Any], person: str, *, partial: bool = False
) -> dict[str, Any]:
    if not partial:
        parse_snapshot(
            payload
        )  # Partial histories must NEVER be parsed as valid inputs.
    unknown = set(payload) - PERSON_COLLECTIONS - COMMON - DEPENDENT
    if (
        unknown
        or payload.get("unresolved_requests")
        or payload.get("replaces_publication_id")
    ):
        raise ValueError("Unsupported fields or unresolved cross-record references")
    people = {p["person_id"] for p in payload["people"]}
    if person not in people or len(people) < 2:
        raise ValueError(
            "Projection requires a shared input containing the selected person"
        )
    retained = {k: deepcopy(v) for k, v in payload.items() if k in COMMON}
    removed = {}
    for key in PERSON_COLLECTIONS & payload.keys():
        retained[key] = [deepcopy(r) for r in payload[key] if r["person_id"] != person]
        removed[key] = len(payload[key]) - len(retained[key])
    duties = {
        r["duty_id"] for k in ("candidates", "history") for r in retained.get(k, [])
    }
    accounts = {r["account_id"] for r in retained.get("leave_accounts", [])}
    employments = {r["revision_id"] for r in retained.get("employments", [])}
    if "accounting_transitions" in payload:
        retained["accounting_transitions"] = [
            deepcopy(r)
            for r in payload["accounting_transitions"]
            if r["before_revision_id"] in employments
            and r["after_revision_id"] in employments
        ]
    if "work_terms" in payload:
        retained["work_terms"] = [
            deepcopy(r) for r in payload["work_terms"] if r["duty_id"] in duties
        ]
    if "leave_records" in payload:
        retained["leave_records"] = [
            deepcopy(r) for r in payload["leave_records"] if r["account_id"] in accounts
        ]
    events = {r["event_id"] for r in retained.get("leave_records", [])}
    if "ledger_recordings" in payload:
        retained["ledger_recordings"] = [
            deepcopy(r)
            for r in payload["ledger_recordings"]
            if r["object_id"]
            in (accounts if r["object_kind"] == "leave_account" else events)
        ]
    retained["previous_duty_ids"] = [
        d for d in payload.get("previous_duty_ids", []) if d in duties
    ]
    for key in (
        "work_terms",
        "leave_records",
        "ledger_recordings",
        "previous_duty_ids",
    ):
        if key in payload:
            removed[key] = len(payload[key]) - len(retained[key])
    # Preserve every retained owned record verbatim. Shared prose is deliberately
    # NOT claimed anonymous or automatically certified free of the removed person.
    return {
        "archive_format": "partial-planning-history-v1",
        "replayable": False,
        "publishable": False,
        "retained": retained,
        "removed_counts": removed,
    }


def project_archive(payload: dict[str, Any], person: str) -> dict[str, Any]:
    """Remove another subject without making partial history executable again."""
    if (
        payload.get("archive_format") != "partial-planning-history-v1"
        or payload.get("replayable") is not False
        or payload.get("publishable") is not False
    ):
        raise ValueError("Unknown preserved history format")
    record_type = payload.get("record_type")
    if record_type == "subject-record":
        from shift_scheduler.application.shared_subject_record import project_partial

        return project_partial(payload, person)
    if record_type is None:
        return project(payload["retained"], person, partial=True)
    if record_type not in {
        "input-registration",
        "planning-job",
        "planning-draft",
        "planning-publication",
        "planning-event",
    }:
        raise ValueError("Unreviewed partial record type")
    retained = deepcopy(payload["retained"])
    if retained.get("actor"):
        raise ValueError(
            "Legacy event actor is not partitioned; attribution review is required"
        )
    people = retained.get("people", [])
    if person not in {p["person_id"] for p in people} or len(people) < 2:
        raise ValueError("Projection requires multiple retained subjects")
    retained["people"] = [p for p in people if p["person_id"] != person]
    for field in ("assignments", "leave_allocations"):
        if field in retained:
            retained[field] = [r for r in retained[field] if r["person_id"] != person]
    # Fields were allowlisted when the archive was made. Never keep new fields
    # from a future format simply because this is already a historical record.
    allowed = {
        "people",
        "assignments",
        "leave_allocations",
        "status",
        "version",
        "period_key",
        "event_kind",
        "actor",
        "input_digest",
        "event_fields",
    }
    if set(retained) - allowed:
        raise ValueError("Unknown retained history fields")
    return {**deepcopy(payload), "retained": retained, "removed_counts": {"people": 1}}


def planning_record(
    session: Session, table_name: str, row: Mapping[Any, Any], person: str
) -> dict[str, Any]:
    """Keep actual per-person assignments; joint scores/reports are invalidated."""
    from shift_scheduler.db.planning_models import PlanningDraft, PlanningInput
    from shift_scheduler.domain.planning import Proposal

    if table_name == "planning_jobs" and row["status"] in {"QUEUED", "RUNNING"}:
        raise ValueError("An active job cannot be replaced by partial history")
    if table_name == "planning_publications":
        draft = session.get(PlanningDraft, row["draft_id"])
        if not draft:
            raise ValueError("Publication draft provenance missing")
        input_hash = draft.input_hash
        raw_proposal = row["payload"]["proposal"]
    else:
        input_hash = row["input_hash"]
        raw_proposal = (
            row["proposal"]
            if table_name == "planning_drafts"
            else (row["result"] or {}).get("proposal")
        )
    source = session.get(PlanningInput, input_hash)
    if not source:
        raise ValueError("Planning input provenance missing")
    parsed = parse_snapshot(source.payload)
    proposal_value = (
        Proposal.model_validate(raw_proposal) if raw_proposal else Proposal()
    )
    known_duties = {d.duty_id: d for d in parsed.candidates}
    known_leaves = {a.allocation_id: a for a in parsed.leaves}
    if (
        set(proposal_value.duty_ids) - known_duties.keys()
        or set(proposal_value.leave_ids) - known_leaves.keys()
    ):
        raise ValueError("Unresolved proposal ownership")
    assignments = [
        known_duties[d].model_dump(mode="json") for d in proposal_value.duty_ids
    ]
    leaves = [known_leaves[a].model_dump(mode="json") for a in proposal_value.leave_ids]
    if table_name == "planning_publications":
        payload = row["payload"]
        allowed = {
            "input_hash",
            "rule_revision",
            "proposal",
            "assignments",
            "leave_allocations",
            "validation",
            "reviewed_by",
            "replaces",
            "leave_reservation_ids",
            "leave_person_ids",
            "carried_assignments",
        }
        if set(payload) - allowed:
            raise ValueError("Unknown publication fields")
        # The published body is the authority: require full equality to its
        # immutable proposal/input before partitioning, including no unknown prose.
        from shift_scheduler.domain.planning import Duty, LeaveAllocation

        if payload.get("carried_assignments"):
            from shift_scheduler.application.publication_history import carried_duties

            assignments += carried_duties(
                session,
                payload,
                parsed,
                source.scope_id,
                row["period_key"],
                row["version"],
            )
        published_duties = [
            Duty.model_validate(d).model_dump(mode="json")
            for d in payload["assignments"]
        ]
        published_leaves = [
            LeaveAllocation.model_validate(a).model_dump(mode="json")
            for a in payload["leave_allocations"]
        ]
        if (
            sorted(published_duties, key=lambda d: d["duty_id"])
            != sorted(assignments, key=lambda d: d["duty_id"])
            or sorted(published_leaves, key=lambda a: a["allocation_id"])
            != sorted(leaves, key=lambda a: a["allocation_id"])
            or payload.get("input_hash", input_hash) != input_hash
        ):
            raise ValueError("Publication body does not match its immutable proposal")
        assignments, leaves = published_duties, published_leaves
    body_fields = {
        name: row[name] for name in ("status", "version", "period_key") if name in row
    }
    bodies = {
        p.person_id: {
            "person_id": p.person_id,
            "person": p.model_dump(mode="json"),
            **body_fields,
            "assignments": [
                deepcopy(d) for d in assignments if d["person_id"] == p.person_id
            ],
            "leave_allocations": [
                deepcopy(a) for a in leaves if a["person_id"] == p.person_id
            ],
        }
        for p in parsed.people
    }
    from shift_scheduler.application.shared_subject_record import project_owned_records

    return project_owned_records(
        session, table_name, row, source.scope_id, person, bodies
    )


def file_payload(session: Session, copy: ManagedCopy, person: str) -> Any:
    import json

    from shift_scheduler.application.copies import checked_file, file_digest

    if copy.medium != "file" or copy.locator.get("route") != "schedule.json":
        raise ValueError(
            "Only registered schedule.json snapshots support file preservation"
        )
    path = checked_file(copy.locator["relative_path"])
    if not path.exists() and copy.state in {"PENDING_ERASURE", "RETRY_WAIT"}:
        archive = session.get(
            PreservedArchive, copy.evidence.get("preserved_archive_id")
        )
        review = copy.evidence.get("preservation_review", {})
        if (
            not archive
            or archive.source_digest != copy.content_hash
            or archive.payload_hash != review.get("projection_hash")
            or content_hash(archive.payload) != archive.payload_hash
            or review.get("person_id") != person
        ):
            raise ValueError("Committed preservation proof unavailable after unlink")
        return archive.payload
    if not path.is_file() or file_digest(path) != copy.content_hash:
        raise ValueError("Complete file hash does not match reviewed source")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    try:
        payload = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as error:
        raise ValueError("Invalid snapshot JSON") from error
    if not isinstance(payload, dict) or payload.get("schema_version") not in (1, 2, 3):
        raise ValueError("Known versioned snapshot required")
    parsed = parse_snapshot(payload)
    from shift_scheduler.db.compliance_models import CopySubject

    registered = set(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
        )
    )
    if (
        registered != {p.person_id for p in parsed.people}
        or copy.scope_id != parsed.facility_id + "/" + parsed.department_id
    ):
        raise ValueError("Snapshot scope or complete registered subject set differs")
    if parsed.input_hash != copy.locator.get("source_hash"):
        raise ValueError("Immutable source input version differs from exported body")
    return project(payload, person)


def proposal(
    session: Session, copy: ManagedCopy, person: str, at: datetime | None = None
) -> dict[str, Any]:
    if copy.medium == "file":
        from datetime import UTC, datetime

        from shift_scheduler.application.joint_copy_erasure import proposal as joint

        prepared = joint(session, copy, person, at or datetime.now(UTC))
        if prepared:
            return prepared
        from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject

        owners = set(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
            )
        )
        if any(
            session.get(ErasedSubject, (copy.scope_id.split("/")[0], p))
            for p in owners - {person}
        ):
            raise ValueError("joint_review_required")
        payload = file_payload(session, copy, person)
        return {
            "adapter": "partial-planning-history-v1",
            "payload": payload,
            "payload_hash": content_hash(payload),
            "source_digest": copy.content_hash,
            "person_ids": sorted(p["person_id"] for p in payload["retained"]["people"]),
        }
    from datetime import UTC, datetime

    from shift_scheduler.application.joint_copy_erasure import proposal as joint

    prepared = joint(session, copy, person, at or datetime.now(UTC))
    if prepared:
        return prepared
    from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject

    owners = set(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == copy.copy_id)
        )
    )
    # A single-person archive would retain a co-owner who is already under an
    # approved erasure control; the identity barrier rejects that archive.
    others = owners - {person}
    if copy.scope_id == "__unclassified__":
        # The identity barrier applies to every facility for unclassified rows.
        controlled = others and session.scalar(
            select(ErasedSubject.person_id)
            .where(ErasedSubject.person_id.in_(others))
            .limit(1)
        )
    else:
        controlled = any(
            session.get(ErasedSubject, (copy.scope_id.split("/")[0], p)) for p in others
        )
    if controlled:
        raise ValueError("joint_review_required")
    return database_projection(session, copy, person)


def joint_database_projection(
    session: Session, copy: ManagedCopy, controlled: Collection[str]
) -> dict[str, Any]:
    """Remove every controlled owner from one shared row, keeping the others.

    The first removal uses the row's reviewed schema adapter; later removals use
    the preserved-history adapter, which never makes the history replayable.
    """
    ordered = sorted(controlled)
    prepared = database_projection(session, copy, ordered[0])
    payload = prepared["payload"]
    for person in ordered[1:]:
        payload = project_archive(payload, person)
    retained = sorted(p["person_id"] for p in payload["retained"]["people"])
    if not retained or set(retained) & set(ordered):
        raise ValueError("Joint projection must retain only uncontrolled owners")
    return {
        "adapter": "joint-partial-history-v1",
        "payload": payload,
        "payload_hash": content_hash(payload),
        "source_digest": copy.content_hash,
        "person_ids": retained,
    }


def database_projection(
    session: Session, copy: ManagedCopy, person: str
) -> dict[str, Any]:
    from shift_scheduler.application.database_erasure import resolve

    table, where = resolve(copy)
    row = session.execute(select(table).where(*where)).mappings().one()
    if table.name == "planning_inputs":
        payload = project(row["payload"], person)
    elif table.name == "preserved_archives":
        payload = project_archive(row["payload"], person)
    elif table.name in {"planning_jobs", "planning_drafts", "planning_publications"}:
        payload = planning_record(session, table.name, row, person)
    elif table.name in {
        "planning_change_cases",
        "planning_change_events",
        "staff_lifecycle_cases",
        "staff_lifecycle_events",
    }:
        from shift_scheduler.application.shared_subject_record import (
            project_workflow_record,
        )

        payload = project_workflow_record(
            session, table.name, row, copy.scope_id, person
        )
    elif table.name == "planning_outbox" and row["kind"] in {
        "input.register",
        "job.enqueue",
        "draft.create",
        "draft.edit",
        "draft.review",
        "schedule.published",
    }:
        from shift_scheduler.db.planning_models import PlanningDraft, PlanningInput

        fields = row["payload"]
        allowed_fields = {
            "input_hash",
            "revision",
            "job_id",
            "draft_id",
            "version",
            "publishable",
            "review_hash",
            "publication_id",
            "person_ids",
        }
        if set(fields) - allowed_fields:
            raise ValueError("Unknown event fields")
        digest = fields.get("input_hash")
        if not digest and fields.get("draft_id"):
            draft = session.get(PlanningDraft, fields["draft_id"])
            digest = draft.input_hash if draft else None
        parent = session.get(PlanningInput, digest) if digest else None
        if not parent or parent.scope_id != copy.scope_id:
            raise ValueError("Referenced input unavailable for preservation")
        from shift_scheduler.application.shared_subject_record import project_event

        payload = project_event(
            session,
            row,
            copy.scope_id,
            person,
            [p["person_id"] for p in parent.payload["people"]],
            {k: deepcopy(v) for k, v in fields.items() if k in {"revision", "version"}},
        )
    elif table.name == "planning_outbox":
        from shift_scheduler.application.shared_subject_record import project_outbox

        payload = project_outbox(session, row, copy.scope_id, person)
    else:
        from shift_scheduler.application.shared_subject_record import project_record

        payload = project_record(session, table.name, row, copy.scope_id, person)
    return {
        "adapter": "partial-planning-history-v1",
        "payload": payload,
        "payload_hash": content_hash(payload),
        "source_digest": copy.content_hash,
        "person_ids": sorted(p["person_id"] for p in payload["retained"]["people"]),
    }


def preserve(
    session: Session, copy: ManagedCopy, prepared: dict[str, Any], at: datetime
) -> str:
    archive_id = content_hash(
        [copy.copy_id, copy.content_hash, prepared["payload_hash"]]
    )
    existing = session.get(PreservedArchive, archive_id)
    if existing and (
        existing.payload_hash != prepared["payload_hash"]
        or existing.payload != prepared["payload"]
    ):
        raise ValueError("Preserved archive identity collision")
    if not existing:
        session.add(
            PreservedArchive(
                archive_id=archive_id,
                scope_id=copy.scope_id,
                source_digest=copy.content_hash,
                payload_hash=prepared["payload_hash"],
                payload=prepared["payload"],
                created_at=at,
            )
        )
        session.flush()  # PostgreSQL trigger registers the new people and copy.
        from shift_scheduler.db.compliance_models import ManagedCopy

        for tracked in session.scalars(
            select(ManagedCopy).where(ManagedCopy.medium == "database")
        ):
            if tracked.locator.get(
                "table"
            ) == "preserved_archives" and tracked.locator.get("pk") == {
                "archive_id": archive_id
            }:
                # Reconstruction does not restart the original retention clock.
                tracked.category, tracked.anchor, tracked.anchor_at = (
                    copy.category,
                    copy.anchor,
                    copy.anchor_at,
                )
                tracked.subject_status = "VERIFIED"
                # The evidence of the review that approved THIS payload.
                if prepared["adapter"] == "joint-partial-history-v1":
                    review = copy.evidence["joint_erasure_review"]
                    if review.get("projection_hash") != prepared["payload_hash"]:
                        raise ValueError(
                            "Joint review does not approve this partial history"
                        )
                else:
                    review = copy.evidence["preservation_review"]
                    if review.get("projection_hash") != prepared["payload_hash"]:
                        raise ValueError(
                            "Preservation review does not approve this partial history"
                        )
                tracked.evidence = {
                    **review["evidence"],
                    "adapter": prepared["adapter"],
                    "preserved_payload_hash": prepared["payload_hash"],
                    "reviewed_content_hash": tracked.content_hash,
                }
    return archive_id
