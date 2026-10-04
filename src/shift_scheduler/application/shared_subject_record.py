"""Preserve separately attributable body and account-role information.

Only reviewed schemas with a single body owner are supported. A joint free-text
body is not partitioned by substring replacement or guessed ownership.
"""

from collections.abc import Iterable, Mapping
from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.application.copy_graph import typed_values
from shift_scheduler.application.subject_references import account_references
from shift_scheduler.db.compliance_models import ComplianceEntity

RECORD_SUPPORTED = {
    "compliance_entities",
    "compliance_revisions",
    "privacy_cases",
    "planning_outbox",
    "actual_work_events",
    "planning_jobs",
    "planning_drafts",
    "planning_publications",
    "planning_requests",
    "planning_leave_events",
}
SUPPORTED = RECORD_SUPPORTED | {
    "planning_change_cases",
    "planning_change_events",
    "staff_lifecycle_cases",
    "staff_lifecycle_events",
}


def project_event(
    session: Session,
    row: Mapping[Any, Any],
    scope: str,
    person: str,
    affected: Iterable[str],
    event_fields: Any = None,
    source_schema: str = "planning_outbox",
) -> dict[str, Any]:
    """Reviewed multi-subject event: joint aggregates are not assigned to a person."""
    refs = account_references(session, scope, dict(row))
    if any(not ref["resolved"] for ref in refs):
        raise ValueError("Account-role ownership is unresolved")
    if not affected or any(not isinstance(p, str) or not p for p in affected):
        raise ValueError("Event subject attribution is missing")
    people = set(affected) | {p for ref in refs for p in ref["person_ids"]}
    if person not in people or len(people) < 2:
        raise ValueError("Event is not shared with the selected subject")
    records = []
    for p in sorted(people - {person}):
        accounts, roles = [], []
        for ref in refs:
            if p not in ref["person_ids"]:
                continue
            value = row
            for key in ref["path"]:
                value = value[key]
            accounts.append({"path": ref["path"], "subject": value})
            roles.append(ref["role"])
        if p in affected:
            roles.append("event_subject")
        records.append(
            {
                "person_id": p,
                "roles": sorted(set(roles)),
                "accounts": accounts,
                "data": (
                    {"person_id": p, "event_fields": deepcopy(event_fields or {})}
                    if p in affected
                    else {}
                ),
            }
        )
    return {
        "archive_format": "partial-planning-history-v1",
        "replayable": False,
        "publishable": False,
        "record_type": "subject-record",
        "source_schema": source_schema,
        "retained": {
            "people": [{"person_id": p} for p in sorted(people - {person})],
            "subject_records": records,
            "record_kind": row["kind"],
            "recorded_at": (
                row["created_at"].isoformat() if row.get("created_at") else None
            ),
        },
        "removed_counts": {"people": 1},
        "omitted_derived_fields": [
            "joint_results",
            "aggregate_counts",
            "source_primary_keys",
        ],
    }


def project_owned_records(
    session: Session,
    table: str,
    row: Mapping[Any, Any],
    scope: str,
    person: str,
    bodies: Any,
) -> dict[str, Any]:
    """Planning-only typed partitions. Caller derives bodies from validated models.

    This is not a generic JSON `person_id` filter: arbitrary joint prose is never
    accepted by this interface. Account fields remain in their actor's partition.
    """
    if table not in {
        "planning_jobs",
        "planning_drafts",
        "planning_publications",
        "planning_change_cases",
        "staff_lifecycle_cases",
    }:
        raise ValueError("Unreviewed multi-owner body producer")
    refs = account_references(session, scope, dict(row))
    if any(not ref["resolved"] for ref in refs):
        raise ValueError("Planning account-role ownership is unresolved")
    people = set(bodies) | {p for ref in refs for p in ref["person_ids"]}
    if person not in people or len(people) < 2:
        raise ValueError("Planning record is not shared with selected subject")
    records = []
    for p in sorted(people - {person}):
        accounts, roles = [], []
        for ref in refs:
            if p not in ref["person_ids"]:
                continue
            value = row
            for key in ref["path"]:
                value = value[key]
            accounts.append({"path": ref["path"], "subject": value})
            roles.append(ref["role"])
        if p in bodies:
            roles.append("body_subject")
        records.append(
            {
                "person_id": p,
                "roles": sorted(set(roles)),
                "accounts": accounts,
                "data": deepcopy(bodies.get(p, {})),
            }
        )
    return {
        "archive_format": "partial-planning-history-v1",
        "replayable": False,
        "publishable": False,
        "record_type": "subject-record",
        "source_schema": table,
        "retained": {
            "people": [{"person_id": p} for p in sorted(people - {person})],
            "subject_records": records,
            "record_kind": table,
            "recorded_at": (
                row["created_at"].isoformat() if row.get("created_at") else None
            ),
        },
        "removed_counts": {"people": 1},
        "omitted_derived_fields": [
            "validation",
            "objective",
            "review_token",
            "aggregate_diagnostics",
            "source_primary_keys",
            "joint_results",
        ],
    }


def project_record(
    session: Session, table: str, row: Mapping[Any, Any], scope: str, person: str
) -> dict[str, Any]:
    if table not in RECORD_SUPPORTED:
        raise ValueError("Unreviewed subject record schema")
    if table == "planning_outbox" and row.get("kind") == "actual.import":
        fields = row["payload"]
        if set(fields) != {"source_hash", "count", "person_ids"} or not isinstance(
            fields["person_ids"], list
        ):
            raise ValueError("Unknown actual import event schema")
        return project_event(session, row, scope, person, fields["person_ids"])
    document = dict(row)
    if table == "planning_requests":
        from shift_scheduler.domain.planning import Evidence, Interval

        allowed = {
            "request_id",
            "scope_id",
            "person_id",
            "version",
            "kind",
            "status",
            "payload",
            "decision",
        }
        if set(document) - allowed:
            raise ValueError("Unknown request fields")
        request = deepcopy(document["payload"])
        if row["kind"] == "PAID_LEAVE_V2":
            from shift_scheduler.domain.compliance import LeaveRequest

            typed = {k: v for k, v in request.items() if k not in {"start", "end"}}
            LeaveRequest.model_validate(typed)
        elif row["kind"] in {"PUBLIC_HOLIDAY_REQUEST", "PAID_LEAVE_REQUEST"}:
            if set(request) - {"start", "end", "kind", "rank", "grant_id", "amount"}:
                raise ValueError("Unknown request payload fields")
            Interval(start=request["start"], end=request["end"])
        else:
            raise ValueError("Unreviewed request kind")
        decision = deepcopy(row.get("decision"))
        if decision is not None:
            Evidence.model_validate(decision)
        document = {
            "person_id": row["person_id"],
            "payload": {
                "person_id": row["person_id"],
                "request": request,
                "decision": decision,
                "kind": row["kind"],
                "status": row["status"],
                "version": row["version"],
            },
        }
    elif table == "planning_leave_events":
        from shift_scheduler.db.planning_models import LeaveBalance, PlanningPublication

        allowed = {
            "event_id",
            "grant_id",
            "publication_id",
            "kind",
            "amount",
            "actor",
            "created_at",
        }
        if set(document) - allowed or row["kind"] not in {
            "reserve",
            "release",
            "consume",
            "reverse",
        }:
            raise ValueError("Unknown leave-event schema")
        grant = session.get(LeaveBalance, row["grant_id"])
        publication = (
            session.get(PlanningPublication, row["publication_id"])
            if row.get("publication_id")
            else None
        )
        if not grant or not publication or publication.scope_id != scope:
            raise ValueError(
                "Leave event ownership requires its grant and scoped publication"
            )
        sources = [publication]
        # Republish emits a release against the NEW publication even when its
        # allocation is now empty. Follow only its explicit predecessor, never
        # an arbitrary old publication that happens to mention this grant.
        if row["kind"] == "release" and publication.payload.get("replaces"):
            previous = session.get(PlanningPublication, publication.payload["replaces"])
            if (
                not previous
                or previous.scope_id != scope
                or previous.period_key != publication.period_key
                or previous.version >= publication.version
            ):
                raise ValueError("Leave release predecessor ownership is unresolved")
            sources.append(previous)
        if not any(
            sum(
                a.get("amount", 0)
                for a in source.payload.get("leave_allocations", [])
                if a.get("grant_id") == grant.grant_id
                and a.get("person_id") == grant.person_id
            )
            >= row["amount"]
            > 0
            for source in sources
        ):
            raise ValueError("Leave event and publication grant ownership mismatch")
        document = {
            "person_id": grant.person_id,
            "actor": row["actor"],
            "payload": {
                "person_id": grant.person_id,
                "kind": row["kind"],
                "amount": row["amount"],
                "recorded_at": row["created_at"].isoformat(),
            },
        }
    refs = account_references(session, scope, document)
    if any(not r["resolved"] for r in refs):
        raise ValueError("Account-role ownership is unresolved")
    owners = {p for _, p in typed_values(document.get("payload", {}), {"person_id"})}
    if document.get("person_id"):
        owners.add(document["person_id"])
    if table == "compliance_revisions":
        parent = session.get(ComplianceEntity, row["entity_key"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Administrative revision provenance missing")
        if parent.person_id:
            owners.add(parent.person_id)
    if len(owners) != 1:
        raise ValueError(
            "Shared or unknown body ownership requires a schema-specific adapter"
        )
    owner = next(iter(owners))
    people = owners | {p for r in refs for p in r["person_ids"]}
    if person not in people or len(people) < 2:
        raise ValueError("This is not a shared subject record")
    retained = deepcopy(document.get("payload", {}))
    # Relocate account identifiers into their owner's partition. Otherwise a
    # later erasure of that actor would leave identifiers inside somebody else's
    # retained body. Common prose still requires the exact-hash human review.
    for ref in refs:
        if ref["path"][0] != "payload":
            continue
        cursor = retained
        for key in ref["path"][1:-1]:
            cursor = cursor[key]
        del cursor[ref["path"][-1]]
    records = []
    for retained_person in sorted(people - {person}):
        roles = sorted({r["role"] for r in refs if retained_person in r["person_ids"]})
        body = deepcopy(retained) if owner == retained_person else {}
        if owner == retained_person:
            roles.append("body_subject")
        accounts = []
        for ref in refs:
            if retained_person not in ref["person_ids"]:
                continue
            value: Any = document
            for key in ref["path"]:
                value = value[key]
            accounts.append({"path": ref["path"], "subject": value})
        records.append(
            {
                "person_id": retained_person,
                "roles": roles,
                "accounts": accounts,
                "data": body,
            }
        )
    return {
        "archive_format": "partial-planning-history-v1",
        "replayable": False,
        "publishable": False,
        "record_type": "subject-record",
        "source_schema": table,
        "retained": {
            "people": [{"person_id": p} for p in sorted(people - {person})],
            "subject_records": records,
            "record_kind": row.get("kind", table),
            "recorded_at": (
                created.isoformat() if (created := row.get("created_at")) else None
            ),
        },
        "removed_counts": {"people": 1},
        "omitted_derived_fields": [
            "source_primary_keys",
            "joint_results",
            "unattributable_metadata",
        ],
    }


def project_partial(payload: dict[str, Any], person: str) -> dict[str, Any]:
    if payload.get("source_schema") not in SUPPORTED:
        raise ValueError("Unreviewed preserved subject schema")
    retained = payload["retained"]
    if set(retained) != {"people", "subject_records", "record_kind", "recorded_at"}:
        raise ValueError("Unknown preserved fields")
    people = {p["person_id"] for p in retained["people"]}
    if person not in people or len(people) < 2:
        raise ValueError("Partial record requires multiple subjects")
    if {r["person_id"] for r in retained["subject_records"]} != people:
        raise ValueError("Partial record subject attribution mismatch")
    if payload.get("source_schema") in {
        "planning_jobs",
        "planning_drafts",
        "planning_publications",
    }:
        from shift_scheduler.domain.planning import Duty, LeaveAllocation, Person

        for record in retained["subject_records"]:
            body = record["data"]
            if not body:
                continue  # A known actor without a scheduled-person body.
            if set(body) - {
                "person_id",
                "person",
                "assignments",
                "leave_allocations",
                "status",
                "version",
                "period_key",
            }:
                raise ValueError("Unknown planning body field in partial history")
            owner = record["person_id"]
            if (
                body.get("person_id") != owner
                or Person.model_validate(body.get("person")).person_id != owner
            ):
                raise ValueError("Partial planning body ownership mismatch")
            if any(
                Duty.model_validate(d).person_id != owner
                for d in body.get("assignments", [])
            ):
                raise ValueError("Partial assignment ownership mismatch")
            if any(
                LeaveAllocation.model_validate(a).person_id != owner
                for a in body.get("leave_allocations", [])
            ):
                raise ValueError("Partial leave ownership mismatch")
    elif payload.get("source_schema") == "planning_change_cases":
        from shift_scheduler.domain.planning import Duty

        for record in retained["subject_records"]:
            body = record["data"]
            if not body:
                continue
            if set(body) != {
                "person_id",
                "kind",
                "status",
                "version",
                "affected_assignments",
                "proposed_assignments",
            }:
                raise ValueError("Unknown change-case body field in partial history")
            owner = record["person_id"]
            if body["person_id"] != owner or any(
                Duty.model_validate(d).person_id != owner
                for key in ("affected_assignments", "proposed_assignments")
                for d in body[key]
            ):
                raise ValueError("Partial change-case ownership mismatch")
    elif payload.get("source_schema") == "staff_lifecycle_cases":
        allowed_tasks = {"key", "status", "completed_at"}
        for record in retained["subject_records"]:
            body = record["data"]
            if not body:
                continue
            if set(body) != {
                "person_id",
                "kind",
                "effective_date",
                "status",
                "version",
                "tasks",
            }:
                raise ValueError("Unknown lifecycle body field in partial history")
            if body["person_id"] != record["person_id"] or any(
                set(task) != allowed_tasks for task in body["tasks"]
            ):
                raise ValueError("Partial lifecycle ownership mismatch")

    return {
        **deepcopy(payload),
        "retained": {
            **deepcopy(retained),
            "people": [p for p in retained["people"] if p["person_id"] != person],
            "subject_records": [
                r for r in retained["subject_records"] if r["person_id"] != person
            ],
        },
        "removed_counts": {"people": 1},
    }


def _case_people(row: Mapping[Any, Any]) -> list[str]:
    from shift_scheduler.domain.planning import Duty

    duties = [
        Duty.model_validate(item)
        for key in ("affected_assignments", "proposed_assignments")
        for item in row[key]
    ]
    return sorted({d.person_id for d in duties})


def project_workflow_record(
    session: Session, table: str, row: Mapping[Any, Any], scope: str, person: str
) -> dict[str, Any]:
    """Project reviewed change/lifecycle records without retaining evidence prose."""
    document = dict(row)
    if table == "planning_change_cases":
        allowed = {
            "case_id",
            "scope_id",
            "publication_id",
            "kind",
            "status",
            "version",
            "affected_assignments",
            "proposed_assignments",
            "validation",
            "evidence",
            "created_by",
            "created_at",
            "updated_at",
        }
        if (
            set(document) != allowed
            or row["scope_id"] != scope
            or row["kind"] not in {"ABSENCE", "SWAP"}
            or row["status"] not in {"DRAFT", "AWAITING_CONSENT", "READY", "APPROVED"}
        ):
            raise ValueError("Unknown change-case schema")
        from shift_scheduler.db.planning_models import (
            PlanningInput,
            PlanningPublication,
        )
        from shift_scheduler.domain.planning import Duty

        publication = session.get(PlanningPublication, row["publication_id"])
        if not publication or publication.scope_id != scope:
            raise ValueError("Change-case publication provenance missing")
        affected = [
            Duty.model_validate(item).model_dump(mode="json")
            for item in row["affected_assignments"]
        ]
        proposed = [
            Duty.model_validate(item).model_dump(mode="json")
            for item in row["proposed_assignments"]
        ]
        published = {
            item["duty_id"]: Duty.model_validate(item).model_dump(mode="json")
            for item in publication.payload["assignments"]
        }
        if any(published.get(item["duty_id"]) != item for item in affected):
            raise ValueError("Affected duty disagrees with source publication")
        source = session.get(PlanningInput, publication.payload.get("input_hash"))
        if not source or source.scope_id != scope:
            raise ValueError("Change-case input provenance missing")
        candidates = {
            item["duty_id"]: Duty.model_validate(item).model_dump(mode="json")
            for item in source.payload["candidates"]
        }
        if any(candidates.get(item["duty_id"]) != item for item in proposed):
            raise ValueError("Proposed duty disagrees with source input")
        owners = sorted({item["person_id"] for item in affected + proposed})
        bodies = {
            owner: {
                "person_id": owner,
                "kind": row["kind"],
                "status": row["status"],
                "version": row["version"],
                "affected_assignments": [
                    d for d in affected if d["person_id"] == owner
                ],
                "proposed_assignments": [
                    d for d in proposed if d["person_id"] == owner
                ],
            }
            for owner in owners
        }
        return project_owned_records(session, table, row, scope, person, bodies)
    if table == "staff_lifecycle_cases":
        allowed = {
            "case_id",
            "scope_id",
            "person_id",
            "kind",
            "effective_date",
            "status",
            "version",
            "tasks",
            "evidence",
            "created_by",
            "created_at",
            "updated_at",
        }
        if (
            set(document) != allowed
            or row["scope_id"] != scope
            or row["kind"] not in {"ONBOARD", "OFFBOARD"}
        ):
            raise ValueError("Unknown lifecycle-case schema")
        task_keys = {
            "ONBOARD": {
                "contract",
                "qualification",
                "membership",
                "candidate_generation",
            },
            "OFFBOARD": {
                "contract_end",
                "candidate_exclusion",
                "balance_review",
                "membership_deactivation",
            },
        }
        tasks = []
        for task in row["tasks"]:
            if (
                set(task) - {"key", "status", "completed_at", "evidence"}
                or task.get("key") not in task_keys[row["kind"]]
                or task.get("status") not in {"NOT_STARTED", "COMPLETED"}
            ):
                raise ValueError("Unknown lifecycle task schema")
            tasks.append(
                {
                    key: deepcopy(task.get(key))
                    for key in ("key", "status", "completed_at")
                }
            )
        if (
            len(tasks) != len(task_keys[row["kind"]])
            or {task["key"] for task in tasks} != task_keys[row["kind"]]
        ):
            raise ValueError("Lifecycle task set is incomplete or duplicated")
        body = {
            "person_id": row["person_id"],
            "kind": row["kind"],
            "effective_date": row["effective_date"].isoformat(),
            "status": row["status"],
            "version": row["version"],
            "tasks": tasks,
        }
        return project_owned_records(
            session, table, row, scope, person, {row["person_id"]: body}
        )
    if table == "planning_change_events":
        allowed = {"event_id", "case_id", "kind", "actor", "evidence", "created_at"}
        if set(document) != allowed or row["kind"] not in {
            "CREATED",
            "CONSENTED",
            "APPROVED",
        }:
            raise ValueError("Unknown change-event schema")
        from shift_scheduler.db.planning_models import PlanningChangeCase

        change_case = session.get(PlanningChangeCase, row["case_id"])
        if not change_case or change_case.scope_id != scope:
            raise ValueError("Change-event case provenance missing")
        return project_event(
            session,
            row,
            scope,
            person,
            _case_people(change_case.__dict__),
            {"kind": row["kind"]},
            source_schema=table,
        )
    if table == "staff_lifecycle_events":
        allowed = {
            "event_id",
            "case_id",
            "kind",
            "task_key",
            "actor",
            "evidence",
            "created_at",
        }
        if set(document) != allowed or row["kind"] not in {"CREATED", "TASK_COMPLETED"}:
            raise ValueError("Unknown lifecycle-event schema")
        from shift_scheduler.db.planning_models import StaffLifecycleCase

        lifecycle_case = session.get(StaffLifecycleCase, row["case_id"])
        if not lifecycle_case or lifecycle_case.scope_id != scope:
            raise ValueError("Lifecycle-event case provenance missing")
        lifecycle_event_task_keys = {task["key"] for task in lifecycle_case.tasks}
        if (row["kind"] == "CREATED" and row["task_key"] is not None) or (
            row["kind"] == "TASK_COMPLETED"
            and row["task_key"] not in lifecycle_event_task_keys
        ):
            raise ValueError("Lifecycle-event task provenance mismatch")
        return project_event(
            session,
            row,
            scope,
            person,
            [lifecycle_case.person_id],
            {"kind": row["kind"], "task_key": row["task_key"]},
            source_schema=table,
        )
    raise ValueError("Unreviewed workflow record schema")


# Exact current producer contracts. Prose, source IDs and joint totals are omitted
# explicitly; the surrounding preservation workflow still requires exact-hash review.
EVENT_FIELDS = {
    "job.cancel": {"job_id"},
    "schedule.cancelled": {"publication_id", "reason", "version", "person_ids"},
    "request.submit": {"request_id", "person_id"},
    "request.decision": {"request_id", "decision", "approved"},
    "request.withdraw": {"request_id", "person_id"},
    "leave.request": {"request_id", "person_id"},
    "leave.settled": {"event_id", "grant_id", "kind", "amount"},
    "privacy.request": {"case_id"},
    "privacy.decision": {"case_id", "status", "reason"},
    "actual.corrected": {"event_id", "person_id", "revalidation_required"},
    "actual.reviewed": {"event_id", "revision", "person_id", "reason"},
    "membership.linked": {"membership_id", "person_ids", "revision", "evidence"},
    "membership.deactivated": {"membership_id", "person_ids", "revision", "evidence"},
    "candidates.derived": {
        "input_hash",
        "input_revision",
        "source_input_hash",
        "evidence",
    },
    "change.absence.created": {"case_id", "person_ids", "publishable", "evidence"},
    "change.swap.created": {"case_id", "person_ids", "publishable", "evidence"},
    "change.swap.consented": {"case_id", "person_ids", "status", "evidence"},
    "change.approved": {
        "case_id",
        "publication_id",
        "version",
        "person_ids",
        "evidence",
    },
    "lifecycle.onboard.created": {"case_id", "person_ids", "evidence"},
    "lifecycle.offboard.created": {"case_id", "person_ids", "evidence"},
    "lifecycle.task.completed": {
        "case_id",
        "person_ids",
        "task_key",
        "status",
        "evidence",
    },
    # Control events whose subjects are fixed when the event is written: the
    # hold's person (never reassigned), the subjects recorded in the event, the
    # copy-erasure plan's person, the people of the (immutable) closed input.
    # Hashes and counts of joint content are not retained. Copy events that name
    # only a copy are not supported: its subjects are replaced on re-registration,
    # so the current subjects are not those of the event.
    "privacy.hold": {"hold_id", "revision", "active"},
    "copy.external_confirmed": {
        "copy_id",
        "revision",
        "content_hash",
        "person_ids",
        "local_physical_erasure_verified",
    },
    "copy.preview": {"plan_id"},
    "copy.erasure_queued": {"plan_id", "count"},
    "erasure.preview": {"plan_id", "blocked"},
}
# Facility-level rule changes name no person; only the actor account is personal.
NO_SUBJECT_EVENTS = {"retention.rule"}
CONTROL_EVENTS = {
    "privacy.hold",
    "copy.external_confirmed",
    "copy.preview",
    "copy.erasure_queued",
    "erasure.preview",
}


def project_linked_event(
    session: Session, row: Mapping[Any, Any], scope: str, person: str
) -> dict[str, Any]:
    """Resolve typed event references through their scoped authoritative producer."""
    from shift_scheduler.db.compliance_models import PrivacyCase
    from shift_scheduler.db.planning_models import (
        AccountMembership,
        ActualWorkEvent,
        LeaveBalance,
        LeaveEvent,
        PlanningChangeCase,
        PlanningInput,
        PlanningJob,
        PlanningPublication,
        PlanningRequest,
        StaffLifecycleCase,
    )

    kind, fields = row["kind"], row["payload"]
    if kind in NO_SUBJECT_EVENTS:
        raise ValueError(
            "Event concerns no subject; its actor account is erased with the account"
        )
    expected = (
        {"key", "revision"}
        if kind.startswith("compliance.")
        else EVENT_FIELDS.get(kind)
    )
    if expected is None or set(fields) != expected:
        raise ValueError("Unknown linked event schema")
    common: dict[str, Any] = {}
    parent: Any  # the producer row type differs per event kind
    if kind == "job.cancel":
        job = session.get(PlanningJob, fields["job_id"])
        parent = session.get(PlanningInput, job.input_hash) if job else None
        if not parent or parent.scope_id != scope:
            raise ValueError("Job event scoped provenance missing")
        people = [p["person_id"] for p in parent.payload["people"]]
    elif kind == "schedule.cancelled":
        parent = session.get(PlanningPublication, fields["publication_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Cancellation event scoped provenance missing")
        people = sorted(
            {p["person_id"] for p in parent.payload["assignments"]}
            | {p["person_id"] for p in parent.payload["leave_allocations"]}
        )
        if set(fields["person_ids"]) != set(people):
            raise ValueError("Cancellation event subjects disagree with publication")
        common = {"version": fields["version"]}
    elif kind in {
        "request.submit",
        "request.decision",
        "request.withdraw",
        "leave.request",
    }:
        parent = session.get(PlanningRequest, fields["request_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Request event scoped provenance missing")
        people = [parent.person_id]
        if fields.get("person_id", parent.person_id) != parent.person_id:
            raise ValueError("Request event subject disagrees with request")
        if kind == "request.decision":
            from shift_scheduler.domain.planning import Evidence

            Evidence.model_validate(fields["decision"])
            if not isinstance(fields["approved"], bool):
                raise ValueError("Request decision status is invalid")
            common = {"approved": fields["approved"]}
    elif kind == "leave.settled":
        event = session.get(LeaveEvent, fields["event_id"])
        grant = session.get(LeaveBalance, fields["grant_id"])
        parent = (
            session.get(PlanningPublication, event.publication_id) if event else None
        )
        if (
            not event
            or not grant
            or not parent
            or parent.scope_id != scope
            or (event.grant_id, event.kind, event.amount)
            != (fields["grant_id"], fields["kind"], fields["amount"])
        ):
            raise ValueError("Leave settlement event provenance mismatch")
        people = [grant.person_id]
        common = {"kind": event.kind, "amount": event.amount}
    elif kind.startswith("membership."):
        parent = session.get(AccountMembership, fields["membership_id"])
        revision = fields["revision"]
        if (
            not parent
            or parent.scope_id != scope
            or fields["person_ids"] != [parent.person_id]
            or not isinstance(revision, int)
            or isinstance(revision, bool)
            or not 1 <= revision <= parent.revision
        ):
            raise ValueError("Membership event provenance mismatch")
        people = [parent.person_id]
        common = {"revision": revision, "active": kind == "membership.linked"}
    elif kind == "candidates.derived":
        parent = session.get(PlanningInput, fields["input_hash"])
        source = session.get(PlanningInput, fields["source_input_hash"])
        if (
            not parent
            or not source
            or parent.scope_id != scope
            or source.scope_id != scope
            or fields["input_revision"] != parent.input_revision
        ):
            raise ValueError("Candidate derivation event provenance mismatch")
        people = [p["person_id"] for p in parent.payload["people"]]
        common = {"input_revision": parent.input_revision}
    elif kind.startswith("change."):
        parent = session.get(PlanningChangeCase, fields["case_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Change event case provenance missing")
        people = _case_people(parent.__dict__)
        if (
            not isinstance(fields["person_ids"], list)
            or any(not isinstance(value, str) for value in fields["person_ids"])
            or len(set(fields["person_ids"])) != len(fields["person_ids"])
        ):
            raise ValueError("Change event subjects are invalid")
        recorded_people = set(fields["person_ids"])
        if (
            kind == "change.swap.consented"
            and (len(recorded_people) != 1 or not recorded_people <= set(people))
        ) or (kind != "change.swap.consented" and recorded_people != set(people)):
            raise ValueError("Change event subjects disagree with its case")
        if kind == "change.swap.consented":
            people = sorted(recorded_people)
        if kind == "change.approved":
            publication = session.get(PlanningPublication, fields["publication_id"])
            if (
                not publication
                or publication.scope_id != scope
                or publication.version != fields["version"]
            ):
                raise ValueError("Change approval publication provenance mismatch")
            common = {"version": fields["version"]}
        elif kind.endswith(".created"):
            if not isinstance(fields["publishable"], bool):
                raise ValueError("Change event publishable flag is invalid")
            common = {"publishable": fields["publishable"]}
        else:
            common = {"status": fields["status"]}
    elif kind.startswith("lifecycle."):
        parent = session.get(StaffLifecycleCase, fields["case_id"])
        if (
            not parent
            or parent.scope_id != scope
            or fields["person_ids"] != [parent.person_id]
        ):
            raise ValueError("Lifecycle event provenance mismatch")
        people = [parent.person_id]
        common = (
            {"task_key": fields["task_key"], "status": fields["status"]}
            if kind == "lifecycle.task.completed"
            else {"kind": parent.kind}
        )
    elif kind == "privacy.hold":
        from shift_scheduler.db.compliance_models import LegalHold

        parent = session.get(LegalHold, fields["hold_id"])
        if not parent or parent.scope_id != scope or not parent.person_id:
            raise ValueError("Hold event subject or scoped provenance missing")
        revision = fields["revision"]
        if (
            not isinstance(fields["active"], bool)
            or not isinstance(revision, int)
            or isinstance(revision, bool)
            or not 1 <= revision <= parent.revision
        ):
            raise ValueError("Hold event disagrees with the hold record")
        people = [parent.person_id]
        common = {"revision": fields["revision"], "active": fields["active"]}
    elif kind == "copy.external_confirmed":
        from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy

        parent = session.get(ManagedCopy, fields["copy_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Copy event scoped provenance missing")
        people = (
            sorted(set(fields["person_ids"]))
            if isinstance(fields["person_ids"], list)
            else []
        )
        current = sorted(
            session.scalars(
                select(CopySubject.person_id).where(
                    CopySubject.copy_id == parent.copy_id
                )
            )
        )
        revision = fields["revision"]
        # The event records its subjects; they must still be the copy's subjects.
        if (
            not people
            or people != current
            or fields["local_physical_erasure_verified"] is not False
            or not isinstance(revision, int)
            or isinstance(revision, bool)
            or not 1 <= revision <= parent.revision
        ):
            raise ValueError("External copy event subjects disagree with the copy")
        common = {"revision": revision}
    elif kind in {"copy.preview", "copy.erasure_queued"}:
        from shift_scheduler.db.compliance_models import CopyErasure

        parent = session.get(CopyErasure, fields["plan_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Copy erasure plan scoped provenance missing")
        people = [parent.person_id]
    elif kind == "erasure.preview":
        from shift_scheduler.db.compliance_models import ErasurePlan

        plan = session.get(ErasurePlan, fields["plan_id"])
        parent = (
            session.get(PlanningInput, plan.payload.get("input_hash")) if plan else None
        )
        if not plan or plan.scope_id != scope or not parent or parent.scope_id != scope:
            raise ValueError("Erasure event scoped provenance missing")
        people = [p["person_id"] for p in parent.payload["people"]]
    elif kind.startswith("privacy."):
        parent = session.get(PrivacyCase, fields["case_id"])
        if not parent or parent.scope_id != scope:
            raise ValueError("Privacy event scoped provenance missing")
        people = [parent.person_id]
        if "status" in fields:
            common = {"status": fields["status"]}
    elif kind.startswith("actual."):
        parent = session.get(ActualWorkEvent, fields["event_id"])
        if (
            not parent
            or parent.scope_id != scope
            or parent.payload["person_id"] != fields["person_id"]
        ):
            raise ValueError("Actual event scoped provenance mismatch")
        people = [fields["person_id"]]
        common = {
            k: fields[k] for k in ("revision", "revalidation_required") if k in fields
        }
    else:
        parent = session.get(ComplianceEntity, fields["key"])
        if (
            not parent
            or parent.scope_id != scope
            or kind != "compliance." + parent.kind
            or not parent.person_id
        ):
            raise ValueError(
                "Administrative event subject or scoped provenance missing"
            )
        people = [parent.person_id]
        common = {"revision": fields["revision"]}
    from shift_scheduler.db.compliance_models import ErasedSubject

    # A subject erased earlier must not be reintroduced by a new reconstruction
    # of a control event (other kinds keep their reviewed behaviour).
    if (
        kind in CONTROL_EVENTS
        and session.scalars(
            select(ErasedSubject.person_id).where(
                ErasedSubject.facility_id == scope.split("/")[0],
                ErasedSubject.person_id.in_(people),
            )
        ).first()
    ):
        raise ValueError("Event names an already erased subject")
    result = project_event(session, row, scope, person, people, common)
    result["omitted_derived_fields"] += ["joint_prose", "source_event_references"]
    return result


def project_outbox(
    session: Session, row: Mapping[Any, Any], scope: str, person: str
) -> dict[str, Any]:
    """Outbox rows with a typed producer contract; the rest use the reviewed record path."""
    kind = row["kind"]
    if (
        kind in EVENT_FIELDS
        or kind in NO_SUBJECT_EVENTS
        or kind.startswith("compliance.")
    ):
        return project_linked_event(session, row, scope, person)
    return project_record(session, "planning_outbox", row, scope, person)
