"""Person-erasure events against the existing 25-month canonical API and copies.

No new successful-copy fixtures and no blanket review of unknown canonical rows.
An accepted event is not an assertion that all requested copies were erased.
"""

import json
from contextlib import ExitStack
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from time import monotonic
from unittest.mock import patch

from scripts.long_integrated_api import Clock
from sqlalchemy import select

from shift_scheduler.application import copies
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ManagedCopy,
    PreservedArchive,
    RetentionRule,
)


def apply_subject_event(adapter, event, managed_root):
    if event["kind"] != "erasure" or event["person_id"] not in {"p0", "p1"}:
        raise ValueError("Only fixed canonical person-erasure events are supported")
    wall_started = datetime.now(UTC).isoformat()
    started = monotonic()
    Clock.current = datetime.fromisoformat(event["recorded_at"])
    person = adapter.person_prefix + event["person_id"]
    key = event["event_id"]
    root = Path(managed_root).resolve(strict=True)
    with ExitStack() as stack:
        stack.enter_context(
            patch.dict("os.environ", {"PHARMSHIFT_MANAGED_STORAGE": str(root)})
        )
        for module in ("subject_controls", "copies", "privacy"):
            stack.enter_context(
                patch("shift_scheduler.application." + module + ".datetime", Clock)
            )
        # Inventory and joint-review routes read their own clock; without this the
        # retention expiry would be judged at wall time rather than the event time.
        stack.enter_context(
            patch("shift_scheduler.api.routers.compliance.datetime", Clock)
        )
        # These policies are explicit fixture decisions, not assertions about
        # actual hospital retention. Other categories remain unconfirmed.
        # From protocol v6 the registered reviewer owns them (same values) and
        # registers them before the control; the observer then creates none.
        reviewer = getattr(adapter, "reviewer", None)
        protocol_rules = (
            {r["category"] for r in reviewer.protocol["retention_rules"]}
            if reviewer
            else set()
        )
        if {"control", "exports"} <= protocol_rules:
            reviewer.ensure_retention_rules(adapter, key + "-rules", Clock.current)
        for category, days, purpose in (
            ()
            if {"control", "exports"} <= protocol_rules
            else (
                (
                    "control",
                    3650,
                    "Synthetic protocol: retain approved recreation prevention",
                ),
                (
                    "exports",
                    1,
                    "Synthetic protocol: temporary scheduler export retention",
                ),
            )
        ):
            with adapter.factory() as s:
                previous = s.scalar(
                    select(RetentionRule)
                    .where(
                        RetentionRule.scope_id == adapter.scope,
                        RetentionRule.category == category,
                    )
                    .order_by(RetentionRule.revision.desc())
                    .limit(1)
                )
            if previous is None:
                adapter.write(
                    "/retention-rules",
                    {
                        "category": category,
                        "purpose": purpose,
                        "anchor": (
                            "case_closed" if category == "control" else "last_activity"
                        ),
                        "retention_days": days,
                        "legal_minimum_days": 0,
                        "effective_from": "2026-01-01",
                        "effective_until": "2029-01-01",
                        "evidence": adapter.ev,
                        "owner": "synthetic-fixture-officer",
                        "next_review": "2029-01-01",
                    },
                    "long-subject-policy-" + category,
                )
        # Independently hash extant files which also belong to somebody else.
        shared = []
        with adapter.factory() as s:
            for row in s.scalars(
                select(ManagedCopy).where(
                    ManagedCopy.scope_id == adapter.scope,
                    ManagedCopy.medium == "file",
                    ManagedCopy.state == "PRESENT",
                )
            ):
                people = set(
                    s.scalars(
                        select(CopySubject.person_id).where(
                            CopySubject.copy_id == row.copy_id
                        )
                    )
                )
                if person in people and people - {person}:
                    path = root / row.locator["relative_path"]
                    shared.append(
                        (
                            row.copy_id,
                            path,
                            sha256(path.read_bytes()).hexdigest(),
                            sorted(people - {person}),
                            path.read_bytes(),
                        )
                    )
        case = adapter.require(
            adapter.api.request(
                adapter.base + "/privacy/requests" + adapter.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": key + "-request",
                    "payload": {
                        "person_id": person,
                        "kind": "erase",
                        "reason": "Synthetic fixed 25-month reviewed erasure",
                    },
                },
            )
        )
        for revision, state in ((1, "VERIFIED"), (2, "APPROVED")):
            case = adapter.require(
                adapter.api.request(
                    adapter.base + "/privacy/cases/" + case["case_id"] + adapter.query,
                    {
                        "expected_revision": revision,
                        "idempotency_key": key + "-" + state,
                        "payload": {
                            "status": state,
                            "reason": "Synthetic approved identity and request",
                            "identity_evidence": adapter.ev,
                        },
                    },
                )
            )
        path = adapter.base + "/subject-controls/" + person
        control = adapter.require(
            adapter.api.request(
                path + adapter.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": key + "-control",
                    "case_id": case["case_id"],
                    "case_revision": 3,
                    "reason": "Synthetic preservation released, eligible erasure only",
                },
            )
        )
        # Explicit decisions come only from the separately registered reviewer, and
        # before planning because every review advances the copy revision.
        reviewer = getattr(adapter, "reviewer", None)
        review_summary = (
            reviewer.review_person(adapter, person, key) if reviewer else None
        )
        plan = adapter.require(
            adapter.api.request(
                path + "/plans" + adapter.query,
                {"expected_revision": 1, "idempotency_key": key + "-copy-plan"},
            )
        )
        before_inventory = adapter.require(
            adapter.api.request(
                adapter.base + "/copies" + adapter.query + "&person_id=" + person
            )
        )
        body = {
            "expected_revision": 1,
            "idempotency_key": key + "-execute",
            "plan_id": plan["plan_id"],
            "plan_revision": plan["revision"],
            "fingerprint": plan["fingerprint"],
        }
        executed = adapter.require(
            adapter.api.request(path + "/execute" + adapter.query, body)
        )
        assert (
            adapter.require(
                adapter.api.request(path + "/execute" + adapter.query, body)
            )
            == executed
        )
        # Read before the file worker, which replaces the plan payload with the remainder.
        profile = erased_profile(adapter, executed["plan_id"])
        tasks = 0
        while copies.process_one(adapter.factory, Clock.current):
            tasks += 1
            if tasks > 10000:
                raise AssertionError("Copy task bound exceeded; not complete")
        remaining = adapter.require(
            adapter.api.request(
                adapter.base + "/copies" + adapter.query + "&person_id=" + person
            )
        )
        shared_checks = []
        for copy_id, path, digest, other_people, original_bytes in shared:
            if path.is_file():
                assert sha256(path.read_bytes()).hexdigest() == digest
                shared_checks.append(
                    {
                        "copy_id": copy_id,
                        "other_people": other_people,
                        "state": "original_remaining",
                        "unchanged_hash": digest,
                    }
                )
                continue
            # Accept reconstruction only after an independently supplied explicit
            # review. This observer never writes/approves review evidence.
            with adapter.factory() as s:
                source = s.get(ManagedCopy, copy_id)
                joint = source.evidence.get("joint_erasure_review")
                if source.evidence.get("joint_erasure_intent_hash"):
                    # Whole-copy erasure is valid only when every owner is erased
                    # under the recorded unanimous review; nobody is recreated.
                    assert (
                        source.state == "ERASED"
                        and joint
                        and joint.get("shared_text_reviewed")
                    )
                    assert "preserved_archive_id" not in source.evidence
                    assert sorted(joint["context"]["owners"]) == sorted(
                        [person, *other_people]
                    )
                    assert joint["context"]["source_hash"] == digest
                    shared_checks.append(
                        {
                            "copy_id": copy_id,
                            "other_people": other_people,
                            "state": "joint_erased_all_owners_reviewed",
                            "source_hash": digest,
                            "joint_intent_hash": source.evidence[
                                "joint_erasure_intent_hash"
                            ],
                        }
                    )
                    continue
                review = source.evidence.get("preservation_review", {})
                archive = s.get(
                    PreservedArchive, source.evidence.get("preserved_archive_id")
                )
                assert (
                    source.state == "ERASED"
                    and archive
                    and archive.source_digest == digest
                )
                assert (
                    review.get("person_id") == person
                    and review.get("source_digest") == digest
                )
                assert review.get(
                    "projection_hash"
                ) == archive.payload_hash and review.get("shared_text_reviewed")
                assert (
                    archive.payload["replayable"] is False
                    and archive.payload["publishable"] is False
                )
                retained = archive.payload["retained"]
                assert (
                    sorted(p["person_id"] for p in retained["people"]) == other_people
                )
                original = json.loads(original_bytes)
                # Independent local ownership check for every explicitly
                # person-labelled collection; no application projection function.
                for name, values in original.items():
                    if isinstance(values, list):
                        expected = [
                            v
                            for v in values
                            if isinstance(v, dict)
                            and v.get("person_id") in other_people
                        ]
                        if expected:
                            observed = [
                                v
                                for v in retained.get(name, [])
                                if isinstance(v, dict)
                                and v.get("person_id") in other_people
                            ]
                            assert observed == expected, (copy_id, name)
                shared_checks.append(
                    {
                        "copy_id": copy_id,
                        "other_people": other_people,
                        "state": "reviewed_partial_history",
                        "source_hash": digest,
                        "archive_id": archive.archive_id,
                        "payload_hash": archive.payload_hash,
                    }
                )
        actual_count = executed["erased_database_count"]
        residual_reasons = {}
        for target in remaining["targets"]:
            for reason in target["blockers"] or ["no_blocker_recorded"]:
                residual_reasons[reason] = residual_reasons.get(reason, 0) + 1
        with adapter.factory() as s:
            file_erased = sum(
                1
                for target in before_inventory["targets"]
                if (row := s.get(ManagedCopy, target["copy_id"]))
                and row.medium in {"file", "backup"}
                and row.state == "ERASED"
            )
        result = {
            "event_id": key,
            "person_id": person,
            "control": control,
            "execution": executed,
            "erased_profile": profile,
            "worker_steps": tasks,
            "shared_others_preserved": shared_checks,
            "remaining": remaining,
            "review": review_summary,
            "residual_count": len(remaining["targets"]),
            "residual_reasons_overlapping": residual_reasons,
            "preserved_archive_count": executed["preserved_archive_count"],
            "completed_api_sequence": True,
            "all_copies_erased": False,
            "full_erasure_passed": False,
            "actual_database_erased_count": actual_count,
            "actual_file_erased_count": file_erased,
            "synthetic_recorded_at": event["recorded_at"],
            "wall_started_at": wall_started,
            "wall_finished_at": datetime.now(UTC).isoformat(),
            "elapsed_seconds": monotonic() - started,
        }
        adapter.applied_events.append(event)
        return result


def erased_profile(adapter, plan_id):
    """Tables of the rows this plan erased, and how many had a wall-clock anchor.

    Tables without created_at/updated_at are anchored by the database clock, not
    the synthetic clock; such erasures are reported, never silently counted.
    """
    from shift_scheduler.db.compliance_models import CopyErasure

    window = getattr(adapter, "wall_window", None)
    by_table, wall = {}, {}
    with adapter.factory() as s:
        plan = s.get(CopyErasure, plan_id)
        for identity in (plan.payload or {}).get("erased_database_copy_ids", []):
            row = s.get(ManagedCopy, identity)
            table = row.locator.get("table")
            by_table[table] = by_table.get(table, 0) + 1
            anchor = (
                row.anchor_at
                if row.anchor_at.tzinfo
                else row.anchor_at.replace(tzinfo=UTC)
            )
            if window and window[0] <= anchor <= datetime.now(UTC):
                wall[table] = wall.get(table, 0) + 1
    return {
        "erased_by_table": by_table,
        "wall_clock_anchor_erased_by_table": wall,
        "wall_clock_anchor_erased": sum(wall.values()),
        "wall_window_start": window[0].isoformat() if window else None,
    }


def deferred_time(protocol, processed):
    """Pre-registered post-expiry time: last event + longest target retention + 1 day."""
    from datetime import timedelta

    rule = protocol["deferred_expiry"]
    excluded = set(rule.get("exclude_categories", []))
    days = max(
        r["retention_days"]
        for r in protocol["retention_rules"]
        if r["category"] not in excluded
    )
    return max(datetime.fromisoformat(e["recorded_at"]) for e in processed) + timedelta(
        days=days + 1
    )


def apply_deferred_expiry(
    adapter, person_id, at, managed_root, label="deferred-expiry"
):
    """Re-plan an already controlled person later, once more retention periods end.

    The approved case stays APPROVED and the stable control is reused. Only the
    separately registered reviewer records decisions; this observer does not.
    """
    started = monotonic()
    Clock.current = at
    person = adapter.person_prefix + person_id
    key = f"{label}-{person_id}"
    root = Path(managed_root).resolve(strict=True)
    with ExitStack() as stack:
        stack.enter_context(
            patch.dict("os.environ", {"PHARMSHIFT_MANAGED_STORAGE": str(root)})
        )
        for module in ("subject_controls", "copies", "privacy"):
            stack.enter_context(
                patch("shift_scheduler.application." + module + ".datetime", Clock)
            )
        stack.enter_context(
            patch("shift_scheduler.api.routers.compliance.datetime", Clock)
        )
        before = adapter.require(
            adapter.api.request(
                adapter.base + "/copies" + adapter.query + "&person_id=" + person
            )
        )
        reviewer = getattr(adapter, "reviewer", None)
        review_summary = (
            reviewer.review_person(adapter, person, key, at) if reviewer else None
        )
        path = adapter.base + "/subject-controls/" + person
        plan = adapter.require(
            adapter.api.request(
                path + "/plans" + adapter.query,
                {"expected_revision": 1, "idempotency_key": key + "-copy-plan"},
            )
        )
        body = {
            "expected_revision": 1,
            "idempotency_key": key + "-execute",
            "plan_id": plan["plan_id"],
            "plan_revision": plan["revision"],
            "fingerprint": plan["fingerprint"],
        }
        executed = adapter.require(
            adapter.api.request(path + "/execute" + adapter.query, body)
        )
        assert (
            adapter.require(
                adapter.api.request(path + "/execute" + adapter.query, body)
            )
            == executed
        )
        # Read before the file worker, which replaces the plan payload with the remainder.
        profile = erased_profile(adapter, executed["plan_id"])
        tasks = 0
        while copies.process_one(adapter.factory, Clock.current):
            tasks += 1
            if tasks > 10000:
                raise AssertionError("Copy task bound exceeded; not complete")
        remaining = adapter.require(
            adapter.api.request(
                adapter.base + "/copies" + adapter.query + "&person_id=" + person
            )
        )
    residual_reasons = {}
    for target in remaining["targets"]:
        for reason in target["blockers"] or ["no_blocker_recorded"]:
            residual_reasons[reason] = residual_reasons.get(reason, 0) + 1
    return {
        "person_id": person,
        "synthetic_at": at.isoformat(),
        "targets_before": len(before["targets"]),
        "erased_profile": profile,
        "review": review_summary,
        "execution": executed,
        "worker_steps": tasks,
        "actual_database_erased_count": executed["erased_database_count"],
        "preserved_archive_count": executed["preserved_archive_count"],
        "residual_count": len(remaining["targets"]),
        "residual_reasons_overlapping": residual_reasons,
        "remaining": remaining,
        "all_copies_erased": False,
        "elapsed_seconds": monotonic() - started,
    }
