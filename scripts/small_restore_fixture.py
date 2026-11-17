"""Fixed synthetic small-fixture review; NOT a generic copy approval utility.

Called explicitly before backup, never from the read-only restore observer.
Only the owned UUID restore DB and exact expected two-person protocol are valid.
"""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Text, cast, func, select, text

from shift_scheduler.application import copies
from shift_scheduler.application.copy_graph import normalized
from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy, RetentionRule
from shift_scheduler.db.planning_models import (
    AccountMembership,
)
from shift_scheduler.domain.copies import DatabaseCopyReview
from shift_scheduler.domain.planning import Evidence, content_hash

EXPECTED = Path(__file__).with_name("small_restore_fixture_expected.json")
EXPECTED_SHA256 = "567f6cd2cde6388fe7851cc12b92ed660772f51dae8aefb1c7c772a7d98fec18"
SCOPE = "hospital/pharmacy"
EVIDENCE = Evidence(
    reference="fixed-synthetic-small-restore-producer-review-v1",
    status="verified",
    verified_by="officer",
)


def expected():
    raw = EXPECTED.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED_SHA256:
        raise ValueError("Fixed expectation artifact changed")
    value = json.loads(raw)
    if value["format"] != "synthetic-small-restore-expectations-v1":
        raise ValueError("Unknown synthetic expected format")
    if [content_hash(p) for p in value["inputs"]] != value["input_hashes"]:
        raise ValueError("Expectation hash differs")
    return value


def guard(factory):
    url = factory.kw["bind"].url
    if (
        url.host != "127.0.0.1"
        or url.port != 55443
        or url.username != "audit_full_20260923"
        or not re.fullmatch(
            r"pharmshift_audit_restore_[a-f0-9]{32}", url.database or ""
        )
    ):
        raise ValueError(
            "Only a fresh explicitly owned restore UUID database is allowed"
        )


def enroll(factory, _output):
    guard(factory)
    value = expected()
    with factory.begin() as session:
        if list(session.scalars(select(AccountMembership))):
            raise ValueError("Enrollment requires empty synthetic identities")
        # fixture-actor is separately created by the existing producer fixture.
        for row in value["memberships"]:
            if row["subject"] != "fixture":
                session.add(AccountMembership(**row))
    return {
        "subjects": ["admin", "test", "officer"],
        "person_id": value["operator_person"],
        "expected_sha256": hashlib.sha256(EXPECTED.read_bytes()).hexdigest(),
    }


def rule_expected(category):
    known = {
        "planning_history": ("closed history", "period_end", "officer"),
        "audit": ("expired event", "last_activity", "officer"),
        "exports": ("synthetic restore", "last_activity", "test"),
    }
    if category not in known:
        raise ValueError("Unexpected retention category")
    purpose, anchor, owner = known[category]
    payload = {
        "category": category,
        "purpose": purpose,
        "anchor": anchor,
        "retention_days": 1,
        "legal_minimum_days": 0,
        "effective_from": "2030-01-01",
        "effective_until": "2040-01-01",
        "evidence": {
            "reference": "synthetic independent review",
            "status": "verified",
            "verified_by": "officer",
            "valid_until": None,
        },
        "owner": owner,
        "next_review": "2036-01-01",
    }
    return {
        "key": content_hash([SCOPE, category, 1]),
        "scope_id": SCOPE,
        "category": category,
        "revision": 1,
        "payload": payload,
    }


def timestamp(value):
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Unexpected naive producer timestamp")
    # A dynamic creation timestamp is accepted only as a timezone-aware current
    # run observation; its exact bytes still enter the full-row digest below.
    if not 0 <= (datetime.now(UTC) - parsed).total_seconds() < 3600:
        raise ValueError("Stale producer timestamp")


def classify(table, row, expect):
    """Independent fixed-field expectations; never return the registry people."""
    if table == "account_memberships":
        if row not in expect["memberships"]:
            raise ValueError("Unknown identity tuple")
        return (row["person_id"],)
    if table == "planning_inputs":
        if set(row) != {
            "input_hash",
            "scope_id",
            "input_revision",
            "data_revision",
            "payload",
            "created_by",
            "created_at",
        }:
            raise ValueError("Unknown input columns")
        index = expect["input_hashes"].index(row["input_hash"])
        if (
            row["payload"] != expect["inputs"][index]
            or row["scope_id"] != SCOPE
            or row["input_revision"] != index + 1
            or row["data_revision"] != 1
            or row["created_by"] != "fixture"
        ):
            raise ValueError("Input differs from fixed synthetic protocol")
        timestamp(row["created_at"])
        return ("p0", "p1")
    if table == "planning_input_heads":
        period = "2026-01-05T00:00:00+09:00|2026-01-06T00:00:00+09:00"
        if row != {
            "key": content_hash([SCOPE, period]),
            "scope_id": SCOPE,
            "input_hash": expect["input_hashes"][1],
        }:
            raise ValueError("Head is not the expected latest input")
        return ("p0", "p1")
    if table == "planning_outbox":
        if (
            set(row)
            != {
                "event_id",
                "kind",
                "scope_id",
                "actor",
                "payload",
                "created_at",
                "delivered_at",
            }
            or row["scope_id"] != SCOPE
        ):
            raise ValueError("Unknown event shape or scope")
        if (
            not re.fullmatch(r"[a-f0-9]{32}", row["event_id"])
            or row["delivered_at"] is not None
        ):
            raise ValueError("Unexpected event identity or delivery state")
        timestamp(row["created_at"])
        if row["kind"] == "input.register":
            if row["actor"] != "fixture" or row["payload"] not in [
                {"input_hash": h, "revision": i + 1}
                for i, h in enumerate(expect["input_hashes"])
            ]:
                raise ValueError("Unknown input registration event")
            return ("p0", "p1")
        if row["kind"] == "retention.rule":
            choices = [
                (rule_expected(c)["key"], "test" if c == "exports" else "admin")
                for c in ["planning_history", "audit", "exports"]
            ]
            if (row["payload"].get("key"), row["actor"]) not in choices or row[
                "payload"
            ] != {"key": row["payload"]["key"], "revision": 1}:
                raise ValueError("Unknown retention event")
            return ("restore-operator",)
        raise ValueError("Unknown non-control outbox event")
    raise ValueError("Unknown product copy type")


def review(factory, output):
    guard(factory)
    expect = expected()
    records = []
    with factory.begin() as session:
        session.execute(text("SET LOCAL TIME ZONE 'UTC'"))
        policies = [
            normalized(dict(r))
            for r in session.execute(select(RetentionRule.__table__)).mappings()
        ]
        if sorted(policies, key=lambda x: x["key"]) != sorted(
            [rule_expected(c) for c in ["planning_history", "audit", "exports"]],
            key=lambda x: x["key"],
        ):
            raise ValueError(
                "Retention rules differ from the fixed original producer inputs"
            )
        required = {
            "account_memberships": 4,
            "planning_inputs": 2,
            "planning_input_heads": 1,
            "planning_outbox": 5,
        }
        proposals = []
        for name, count in required.items():
            table = Base.metadata.tables[name]
            query = select(
                table,
                cast(func.to_jsonb(table.table_valued()), Text).label(
                    "_canonical_json"
                ),
            )
            if name == "planning_outbox":
                query = query.where(
                    ~table.c.kind.startswith("copy."),
                    ~table.c.kind.startswith("erasure."),
                )
            rows = list(session.execute(query).mappings())
            if len(rows) != count:
                raise ValueError("Unexpected producer record count: " + name)
            for item in rows:
                row = normalized(dict(item))
                canonical = row.pop("_canonical_json")
                persons = classify(name, row, expect)
                digest = hashlib.sha256(canonical.encode()).hexdigest()
                pk = {c.name: row[c.name] for c in table.primary_key}
                matches = [
                    c
                    for c in session.scalars(
                        select(ManagedCopy).where(ManagedCopy.medium == "database")
                    )
                    if c.locator.get("table") == name and c.locator.get("pk") == pk
                ]
                if len(matches) != 1:
                    raise ValueError("Producer registration missing or duplicate")
                copy = matches[0]
                if (
                    copy.content_hash != digest
                    or copy.state != "PRESENT"
                    or copy.scope_id != SCOPE
                ):
                    raise ValueError("Exact producer row hash/state changed")
                registered = set(
                    session.scalars(
                        select(CopySubject.person_id).where(
                            CopySubject.copy_id == copy.copy_id
                        )
                    )
                )
                if registered != set(persons):
                    raise ValueError(
                        "Producer reference graph differs from fixed expected people"
                    )
                proposals.append((copy, persons, digest, name, pk))
        # Validate every record before any review. This callback is never allowed
        # to recover an unknown schema by inspecting and accepting its registry.
        for copy, people, digest, name, pk in proposals:
            prior = copy.subject_status
            if prior == "VERIFIED":
                if copy.evidence.get("reviewed_content_hash") != digest:
                    raise ValueError("Existing exact-hash review stale")
            else:
                copies.review_database_copy(
                    session,
                    SCOPE,
                    DatabaseCopyReview(
                        copy_id=copy.copy_id,
                        content_hash=digest,
                        person_ids=people,
                        evidence=EVIDENCE,
                    ),
                    copy.revision,
                    "officer",
                )
            records.append(
                {
                    "table": name,
                    "pk": pk,
                    "copy_id": copy.copy_id,
                    "full_row_hash": digest,
                    "independently_expected_people": list(people),
                    "prior_status": prior,
                    "reviewed": prior != "VERIFIED",
                }
            )
    result = {
        "format": "fixed-synthetic-small-restore-review-v1",
        "expected_sha256": hashlib.sha256(EXPECTED.read_bytes()).hexdigest(),
        "records": records,
        "review_count": sum(r["reviewed"] for r in records),
        "declares_all_paths_complete": False,
    }
    with (output / "source-review.json").open("x") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    return result
