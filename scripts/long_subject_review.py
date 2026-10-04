"""Pre-registered synthetic reviewer for the 25-month person-erasure events.

Separate from the observer in scripts/long_subject_events.py. Every decision is
made against a registered ops/synthetic-review-protocol-v*.json (hash-bound) by reading the
current source row/file and extracting person references independently; the
database trigger's pharmshift_structured_people() is deliberately not reused.
All approvals go through the public API with expected revisions and idempotency
keys; this module never writes review state to the database directly. Rejected
or deferred copies stay in place with their reason recorded.
"""

import json
import os
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import select, text

from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ErasedSubject,
    LegalHold,
    ManagedCopy,
    PrivacyCase,
)

PROTOCOLS = {f"synthetic-review-protocol-v{n}" for n in (1, 2, 3, 4, 5, 6, 7)}
STRUCTURED_KEYS = {"person_id", "person_ids"}


def protocol_digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


class SyntheticReviewer:
    def __init__(self, protocol_path, expected_hash, log_path):
        self.protocol_path = Path(protocol_path)
        self.expected_hash = expected_hash
        self.protocol = json.loads(self.protocol_path.read_bytes())
        if self.protocol.get("protocol") not in PROTOCOLS:
            raise ValueError("Unknown review protocol")
        # v2 completes extraction with the typed relations of the registration
        # schema; v1 behaviour stays reproducible for its retained result.
        self.typed = self.protocol["database_subject_review"].get(
            "typed_actor_accounts"
        )
        # v3 tightens exemptions and trust after independent review (stricter only).
        self.strict = (
            "verified_status_trust" in self.protocol["database_subject_review"]
        )
        self.log_path = Path(log_path)
        self.check_protocol()

    def check_protocol(self):
        # Refuse to decide under a protocol that changed after registration.
        if protocol_digest(self.protocol_path) != self.expected_hash:
            raise ValueError("Review protocol changed after registration")

    def evidence(self, key):
        return {
            "reference": f'{self.protocol["protocol"]}:{self.expected_hash[:16]}:{key}',
            "status": "verified",
            "verified_by": self.protocol["reviewer"]["actor"],
        }

    def log(self, decision):
        with self.log_path.open("a") as stream:
            stream.write(
                json.dumps(decision, ensure_ascii=False, sort_keys=True, default=str)
                + "\n"
            )

    # -- public API calls -------------------------------------------------
    @staticmethod
    def call(adapter, path, body=None):
        response = adapter.api.request(adapter.base + path, body)
        try:
            payload = response.json()
        except ValueError:
            payload = {"text": response.text}
        return response.status_code, payload

    def ensure_retention_rules(self, adapter, event_key, at):
        from datetime import timedelta

        from shift_scheduler.application.privacy import applicable_rule

        created = []
        common = self.protocol["retention_rule_common"]
        reconfirm = self.protocol.get("retention_rule_reconfirmation")
        for rule in self.protocol["retention_rules"]:
            with adapter.factory() as s:
                existing = applicable_rule(
                    s, adapter.scope, rule["category"], rule["anchor"]
                )
                current = (
                    (existing.revision, dict(existing.payload)) if existing else None
                )
            label = rule["category"] + (
                "" if rule["anchor"] == "last_activity" else "-" + rule["anchor"]
            )
            payload = {
                **{
                    k: rule[k]
                    for k in (
                        "category",
                        "purpose",
                        "anchor",
                        "retention_days",
                        "legal_minimum_days",
                    )
                },
                **{
                    k: common[k]
                    for k in (
                        "effective_from",
                        "effective_until",
                        "owner",
                        "next_review",
                    )
                },
                "evidence": self.evidence("retention-" + label),
            }
            if current is None:
                expected, key = 0, f"{event_key}-protocol-rule-{label}"
            elif reconfirm and current[1]["next_review"] < at.date().isoformat():
                # Pre-registered re-confirmation, next review in a year. v5+: only an
                # unchanged rule is carried forward, with its existing values.
                if reconfirm.get("precondition"):
                    ignore = {"next_review", "evidence"}
                    if {k: v for k, v in current[1].items() if k not in ignore} != {
                        k: v for k, v in payload.items() if k not in ignore
                    }:
                        created.append(f"{label}:rule_differs_from_protocol")
                        continue
                    payload = {**current[1]}
                expected, key = (
                    current[0],
                    f"{event_key}-protocol-rule-{label}-r{current[0] + 1}",
                )
                payload["next_review"] = (at.date() + timedelta(days=365)).isoformat()
                payload["evidence"] = self.evidence(
                    f"retention-{label}-reconfirmed-r{current[0] + 1}"
                )
            else:
                continue
            status, body = self.call(
                adapter,
                "/retention-rules" + adapter.query,
                {
                    "expected_revision": expected,
                    "idempotency_key": key,
                    "payload": payload,
                },
            )
            if status >= 400:
                raise AssertionError(
                    f"Protocol retention rule refused: HTTP {status}: {body}"
                )
            created.append(label if expected == 0 else f"{label}:reconfirmed")
        return created

    # -- independent reading ------------------------------------------------
    @staticmethod
    def source_row(session, copy):
        table = Base.metadata.tables.get(copy.locator.get("table"))
        keys = copy.locator.get("pk")
        if table is None or not isinstance(keys, dict) or not keys:
            return None, None
        quote_name = session.bind.dialect.identifier_preparer.quote
        conditions = " AND ".join(
            f'(to_jsonb(t)->{":k" + str(i)}) = CAST(:v{i} AS jsonb)'
            for i in range(len(keys))
        )
        params = {}
        for i, (name, value) in enumerate(sorted(keys.items())):
            params["k" + str(i)] = name
            params["v" + str(i)] = json.dumps(value)
        session.execute(text("SET LOCAL TIME ZONE 'UTC'"))
        row = session.execute(
            text(
                f"SELECT to_jsonb(t) AS doc, encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS digest "
                f"FROM {quote_name(table.name)} AS t WHERE {conditions}"
            ),
            params,
        ).first()
        return (row.doc, row.digest) if row else (None, None)

    @staticmethod
    def structured(document):
        people = set()
        if isinstance(document, dict):
            for key, value in document.items():
                if key == "person_id" and isinstance(value, str):
                    people.add(value)
                elif key == "person_ids" and isinstance(value, list):
                    people.update(v for v in value if isinstance(v, str))
                else:
                    people |= SyntheticReviewer.structured(value)
        elif isinstance(document, list):
            for value in document:
                people |= SyntheticReviewer.structured(value)
        return people

    @staticmethod
    def parent_document(session, table, document, typed=False):
        """Return (parent document, parent scope, extra typed owners)."""

        def one(sql, value):
            row = session.execute(text(sql), {"v": value}).first()
            return (row[0], row[1]) if row else (None, None)

        parent, scope, extra = None, None, set()
        if "input_hash" in document and table != "planning_inputs":
            parent, scope = one(
                "SELECT payload::jsonb, scope_id FROM planning_inputs WHERE input_hash=:v",
                document["input_hash"],
            )
        elif "draft_id" in document and table != "planning_drafts":
            parent, scope = one(
                "SELECT p.payload::jsonb, p.scope_id FROM planning_drafts d JOIN planning_inputs p "
                "ON p.input_hash=d.input_hash WHERE d.draft_id=:v",
                document["draft_id"],
            )
        elif "entity_key" in document:
            parent, scope = one(
                "SELECT payload::jsonb, scope_id FROM compliance_entities WHERE key=:v",
                document["entity_key"],
            )
        elif "event_id" in document and table == "planning_notification_reads":
            parent, scope = one(
                "SELECT payload::jsonb, scope_id FROM planning_outbox WHERE event_id=:v",
                document["event_id"],
            )
        if not typed:
            return parent, scope, extra
        payload = (
            document.get("payload") if isinstance(document.get("payload"), dict) else {}
        )
        kind = document.get("kind") or ""
        if table == "planning_leave_events":
            parent, scope = one(
                "SELECT payload::jsonb, scope_id FROM planning_publications WHERE publication_id=:v",
                document.get("publication_id"),
            )
            owner = session.execute(
                text("SELECT person_id FROM planning_leave_balances WHERE grant_id=:v"),
                {"v": document.get("grant_id")},
            ).scalar()
            extra |= {owner} if owner else set()
        elif table == "planning_outbox":
            # A matching typed event relation replaces the generic parent, even
            # when its referenced row is absent.
            if kind.startswith("compliance."):
                row = session.execute(
                    text(
                        "SELECT payload::jsonb, scope_id FROM compliance_entities "
                        "WHERE key=:v AND 'compliance.'||kind=:k"
                    ),
                    {"v": payload.get("key"), "k": kind},
                ).first()
                parent, scope = (row[0], row[1]) if row else (None, None)
            elif kind in (
                "request.submit",
                "request.decision",
                "request.withdraw",
                "leave.request",
            ):
                parent, scope = one(
                    "SELECT to_jsonb(r), r.scope_id FROM planning_requests r WHERE r.request_id=:v",
                    payload.get("request_id"),
                )
            elif kind in ("privacy.request", "privacy.decision"):
                parent, scope = one(
                    "SELECT to_jsonb(r), r.scope_id FROM privacy_cases r WHERE r.case_id=:v",
                    payload.get("case_id"),
                )
            elif kind == "leave.settled":
                parent, scope = one(
                    "SELECT to_jsonb(b), p.scope_id FROM planning_leave_events e "
                    "JOIN planning_leave_balances b ON b.grant_id=e.grant_id "
                    "JOIN planning_publications p ON p.publication_id=e.publication_id WHERE e.event_id=:v",
                    payload.get("event_id"),
                )
            elif kind == "job.cancel":
                parent, scope = one(
                    "SELECT p.payload::jsonb, p.scope_id FROM planning_jobs j JOIN planning_inputs p "
                    "ON p.input_hash=j.input_hash WHERE j.job_id=:v",
                    payload.get("job_id"),
                )
            elif "input_hash" in payload:
                parent, scope = one(
                    "SELECT payload::jsonb, scope_id FROM planning_inputs WHERE input_hash=:v",
                    payload["input_hash"],
                )
            elif "draft_id" in payload:
                parent, scope = one(
                    "SELECT p.payload::jsonb, p.scope_id FROM planning_drafts d JOIN planning_inputs p "
                    "ON p.input_hash=d.input_hash WHERE d.draft_id=:v",
                    payload["draft_id"],
                )
        return parent, scope, extra

    def actor_people(self, session, document, scope, path=(), resolved=None):
        """Typed actor fields resolved to membership persons (v2+). Values that
        resolved are added to ``resolved`` as (path, key, value)."""
        people = set()
        if isinstance(document, dict):
            for key, value in document.items():
                decision = (
                    key == "verified_by"
                    and list(path) in self.typed["decision_verified_by_paths"]
                )
                if (key in self.typed["keys"] or decision) and isinstance(value, str):
                    sql = "SELECT DISTINCT person_id FROM account_memberships WHERE subject=:s"
                    params = {"s": value}
                    if scope not in (None, "__unclassified__"):
                        sql += " AND scope_id=:scope"
                        params["scope"] = scope
                    if "issuer" in document:
                        sql += " AND issuer=:issuer"
                        params["issuer"] = document["issuer"]
                    matched = set(session.execute(text(sql), params).scalars())
                    if matched and resolved is not None:
                        resolved.add((tuple(path), key, value))
                    people |= matched
                else:
                    people |= self.actor_people(
                        session, value, scope, (*path, key), resolved
                    )
        elif isinstance(document, list):
            for index, value in enumerate(document):
                people |= self.actor_people(
                    session, value, scope, (*path, str(index)), resolved
                )
        return people

    def typed_keys(self, path, key):
        if not self.typed:
            return False
        return key in self.typed["keys"] or (
            key == "verified_by"
            and list(path) in self.typed["decision_verified_by_paths"]
        )

    def unstructured_hits(
        self, document, tokens, path=(), *, resolved=frozenset(), names=None
    ):
        """Known identifiers/names occurring outside structured subject fields."""
        hits = []
        if isinstance(document, dict):
            owned = "person_id" in document
            for key, value in document.items():
                if key in STRUCTURED_KEYS:
                    continue
                # v3: only an actor value that resolved to a membership is structured.
                if (
                    isinstance(value, str)
                    and self.typed_keys(path, key)
                    and (not self.strict or (tuple(path), key, value) in resolved)
                ):
                    continue
                # v3: only the registered name of that same structured person.
                if (
                    key == "name"
                    and owned
                    and isinstance(value, str)
                    and (
                        not self.strict
                        or value in (names or {}).get(document["person_id"], ())
                    )
                ):
                    continue
                hits += self.unstructured_hits(
                    value, tokens, (*path, key), resolved=resolved, names=names
                )
        elif isinstance(document, list):
            for index, value in enumerate(document):
                hits += self.unstructured_hits(
                    value, tokens, (*path, str(index)), resolved=resolved, names=names
                )
        elif isinstance(document, str):
            hits += [t for t in tokens if t in document]
        return hits

    @staticmethod
    def known_tokens(session, scope):
        """Map each registered person identifier to itself plus registered names."""
        facility = scope.split("/")[0] + "/"
        tokens = {
            p: {p}
            for p in session.scalars(
                select(CopySubject.person_id)
                .join(ManagedCopy, ManagedCopy.copy_id == CopySubject.copy_id)
                .where(ManagedCopy.scope_id.startswith(facility))
            )
        }
        for payload in session.execute(
            text("SELECT payload::jsonb FROM planning_inputs WHERE scope_id LIKE :f"),
            {"f": facility + "%"},
        ).scalars():
            for entry in (payload or {}).get("people", []) or []:
                if (
                    isinstance(entry, dict)
                    and isinstance(entry.get("name"), str)
                    and isinstance(entry.get("person_id"), str)
                ):
                    tokens.setdefault(entry["person_id"], {entry["person_id"]}).add(
                        entry["name"]
                    )
        return tokens

    # -- decisions ------------------------------------------------------------
    def review_person(self, adapter, person, event_key, at=None):
        """Record explicit protocol decisions for one person's current copies."""
        from scripts.long_integrated_api import Clock

        self.check_protocol()
        summary = {
            "protocol_hash": self.expected_hash,
            "person_id": person,
            "retention_rules_created": self.ensure_retention_rules(
                adapter, event_key, at or Clock.current
            ),
            "database_subject": {"approved": 0, "already_verified": 0, "rejected": {}},
            "preservation": {"approved": 0, "rejected": {}},
            "joint_file": {"approved": 0, "rejected": {}},
            "joint_database": {"approved": 0, "rejected": {}},
        }
        status, inventory = self.call(
            adapter, "/copies" + adapter.query + "&person_id=" + quote(person, safe="")
        )
        if status >= 400:
            raise AssertionError(f"Inventory unavailable: HTTP {status}")
        with adapter.factory() as s:
            tokens = self.known_tokens(s, adapter.scope)
        for target in inventory["targets"]:
            if target["medium"] == "database":
                self.review_database(
                    adapter, person, event_key, target, tokens, summary
                )
            elif target["medium"] == "file":
                self.review_joint_file(adapter, person, event_key, target, summary)
        return summary

    def reject(self, summary, section, copy_id, person, reason, **detail):
        bucket = summary[section]["rejected"]
        bucket[reason] = bucket.get(reason, 0) + 1
        self.log(
            {
                "section": section,
                "copy_id": copy_id,
                "person_id": person,
                "decision": "REJECTED",
                "reason": reason,
                **detail,
            }
        )

    def review_database(self, adapter, person, event_key, target, tokens, summary):
        copy_id = target["copy_id"]
        with adapter.factory() as s:
            copy = s.get(ManagedCopy, copy_id)
            if copy is None:
                return self.reject(
                    summary, "database_subject", copy_id, person, "copy_missing"
                )
            owners = set(
                s.scalars(
                    select(CopySubject.person_id).where(CopySubject.copy_id == copy_id)
                )
            )
            if copy.scope_id != adapter.scope:
                return self.reject(
                    summary, "database_subject", copy_id, person, "unclassified_scope"
                )
            if copy.subject_status != "VERIFIED" or (
                self.strict and not self.own_verification(copy)
            ):
                document, digest = self.source_row(s, copy)
                if document is None or digest != copy.content_hash:
                    s.rollback()
                    return self.reject(
                        summary,
                        "database_subject",
                        copy_id,
                        person,
                        "source_missing_or_hash_changed",
                    )
                parent, parent_scope, extra = self.parent_document(
                    s, copy.locator["table"], document, bool(self.typed)
                )
                extracted = (
                    self.structured(document)
                    | (self.structured(parent) if parent else set())
                    | extra
                )
                resolved = set()
                if self.typed:
                    row_scope = (
                        document.get("scope_id") or parent_scope or "__unclassified__"
                    )
                    extracted |= self.actor_people(
                        s, document, row_scope, resolved=resolved
                    )
                s.rollback()
                if extracted != owners or person not in extracted:
                    return self.reject(
                        summary,
                        "database_subject",
                        copy_id,
                        person,
                        "subject_set_mismatch",
                        extracted=sorted(extracted),
                        registered=sorted(owners),
                    )
                hits = self.unstructured_hits(
                    document,
                    sorted(set().union(*tokens.values())),
                    resolved=resolved,
                    names=tokens,
                )
                if hits:
                    return self.reject(
                        summary,
                        "database_subject",
                        copy_id,
                        person,
                        "person_reference_in_unstructured_text",
                        tokens=sorted(set(hits)),
                    )
                revision, content = copy.revision, copy.content_hash
            else:
                revision = None
        if revision is not None:
            status, body = self.call(
                adapter,
                "/copies/review-database" + adapter.query,
                {
                    "expected_revision": revision,
                    "idempotency_key": f"{event_key}-rdb-{copy_id[:40]}-{revision}",
                    "payload": {
                        "copy_id": copy_id,
                        "content_hash": content,
                        "person_ids": sorted(owners),
                        "evidence": self.evidence("subject-" + copy_id),
                    },
                },
            )
            if status >= 400:
                return self.reject(
                    summary,
                    "database_subject",
                    copy_id,
                    person,
                    "api_refused",
                    http=status,
                )
            summary["database_subject"]["approved"] += 1
            self.log(
                {
                    "section": "database_subject",
                    "copy_id": copy_id,
                    "person_id": person,
                    "decision": "APPROVED",
                    "content_hash": content,
                    "person_ids": sorted(owners),
                    "revision_after": body.get("revision"),
                }
            )
        else:
            summary["database_subject"]["already_verified"] += 1
        if owners != {person}:
            self.review_preservation(
                adapter, person, event_key, copy_id, owners, tokens, summary
            )

    def own_verification(self, copy):
        """VERIFIED set by this protocol's reviewer for the current content only."""
        evidence = copy.evidence or {}
        return (
            str(evidence.get("reference", "")).startswith(
                f'{self.protocol["protocol"]}:{self.expected_hash[:16]}:'
            )
            and evidence.get("verified_by") == self.protocol["reviewer"]["actor"]
            and evidence.get("reviewed_content_hash") == copy.content_hash
        )

    def review_preservation(
        self, adapter, person, event_key, copy_id, owners, tokens, summary
    ):
        facility = adapter.scope.split("/")[0]
        with adapter.factory() as s:
            held = s.scalar(
                select(LegalHold.hold_id)
                .where(
                    LegalHold.scope_id.startswith(facility + "/"),
                    LegalHold.active.is_(True),
                )
                .where(
                    (LegalHold.person_id.is_(None)) | LegalHold.person_id.in_(owners)
                )
                .limit(1)
            )
            controlled = sorted(
                p for p in owners - {person} if s.get(ErasedSubject, (facility, p))
            )
            copy = s.get(ManagedCopy, copy_id)
            revision, content = copy.revision, copy.content_hash
        if held:
            return self.reject(
                summary, "preservation", copy_id, person, "owner_under_legal_hold"
            )
        if controlled:
            if self.protocol.get("joint_database_review"):
                return self.review_joint_database(
                    adapter, person, event_key, copy_id, owners, tokens, summary
                )
            return self.reject(
                summary,
                "preservation",
                copy_id,
                person,
                "other_owner_already_controlled_joint_review_required",
                controlled=controlled,
            )
        status, projected = self.call(
            adapter,
            f"/copies/{copy_id}/projection"
            + adapter.query
            + "&person_id="
            + quote(person, safe=""),
        )
        if status >= 400 or projected.get("adapter") != "partial-planning-history-v1":
            return self.reject(
                summary,
                "preservation",
                copy_id,
                person,
                "projection_unavailable",
                http=status,
            )
        payload = projected["payload"]
        rendered = json.dumps(payload, ensure_ascii=False)
        if person in self.structured(payload) or any(
            t in rendered for t in tokens.get(person, {person})
        ):
            return self.reject(
                summary,
                "preservation",
                copy_id,
                person,
                "projection_retains_subject_reference",
            )
        status, body = self.call(
            adapter,
            "/copies/review-preservation" + adapter.query,
            {
                "expected_revision": revision,
                "idempotency_key": f"{event_key}-rpv-{copy_id[:40]}-{revision}",
                "payload": {
                    "copy_id": copy_id,
                    "person_id": person,
                    "content_hash": content,
                    "projection_hash": projected["payload_hash"],
                    "shared_text_reviewed": True,
                    "evidence": self.evidence("preservation-" + copy_id),
                },
            },
        )
        if status >= 400:
            return self.reject(
                summary, "preservation", copy_id, person, "api_refused", http=status
            )
        summary["preservation"]["approved"] += 1
        self.log(
            {
                "section": "preservation",
                "copy_id": copy_id,
                "person_id": person,
                "decision": "APPROVED",
                "projection_hash": projected["payload_hash"],
                "revision_after": body.get("revision"),
            }
        )

    def review_joint_database(
        self, adapter, person, event_key, copy_id, owners, tokens, summary
    ):
        """v4: all controlled owners removed together; uncontrolled owners kept."""
        status, context = self.call(
            adapter, f"/copies/{copy_id}/joint-review" + adapter.query
        )
        if status >= 400:
            detail = context.get("detail") if isinstance(context, dict) else None
            return self.reject(
                summary,
                "joint_database",
                copy_id,
                person,
                "joint_context_unavailable",
                http=status,
                detail=detail,
            )
        facility = adapter.scope.split("/")[0]
        controlled = sorted(p["person_id"] for p in context["context"]["participants"])
        with adapter.factory() as s:
            copy = s.get(ManagedCopy, copy_id)
            own = self.own_verification(copy)
            independent = "independent_checks" in self.protocol["joint_database_review"]
            for participant in controlled:
                control = s.get(ErasedSubject, (facility, participant))
                case = s.get(PrivacyCase, control.plan_id) if control else None
                if (
                    not case
                    or case.person_id != participant
                    or case.status != "APPROVED"
                    or case.revision != control.evidence.get("case_revision")
                    or (
                        independent
                        and (case.scope_id != adapter.scope or case.kind != "erase")
                    )
                ):
                    return self.reject(
                        summary,
                        "joint_database",
                        copy_id,
                        person,
                        "participant_control_or_case_mismatch",
                        participant=participant,
                    )
            if independent:
                # v5: retained owners must really be uncontrolled, and account
                # subjects of controlled people count as their identifiers too.
                if any(
                    s.get(ErasedSubject, (facility, p))
                    for p in owners - set(controlled)
                ):
                    return self.reject(
                        summary,
                        "joint_database",
                        copy_id,
                        person,
                        "retained_owner_controlled",
                    )
                from shift_scheduler.db.planning_models import AccountMembership

                for account in s.scalars(
                    select(AccountMembership).where(
                        AccountMembership.person_id.in_(controlled)
                    )
                ):
                    tokens = {
                        **tokens,
                        account.person_id: set(
                            tokens.get(account.person_id, {account.person_id})
                        )
                        | {account.subject},
                    }
        if not own:
            return self.reject(
                summary, "joint_database", copy_id, person, "subject_review_not_own"
            )
        retained = sorted(owners - set(controlled))
        if (
            person not in controlled
            or retained != context["context"]["retained_owners"]
        ):
            return self.reject(
                summary,
                "joint_database",
                copy_id,
                person,
                "retained_owner_mismatch",
                retained=retained,
            )
        projection = context.get("projection")
        if retained:
            payload = (projection or {}).get("payload")
            rendered = json.dumps(payload, ensure_ascii=False)
            named = self.structured(payload) if payload is not None else set()
            leaked = sorted(
                t for p in controlled for t in tokens.get(p, {p}) if t in rendered
            )
            if (
                payload is None
                or named - set(retained)
                or leaked
                or sorted(projection.get("retained_owners", [])) != retained
            ):
                return self.reject(
                    summary,
                    "joint_database",
                    copy_id,
                    person,
                    "projection_names_controlled_person",
                    leaked=leaked,
                )
        status, body = self.call(
            adapter,
            f"/copies/{copy_id}/joint-review" + adapter.query,
            {
                "shared_text_reviewed": True,
                "expected_revision": context["revision"],
                "idempotency_key": f'{event_key}-jointdb-{copy_id[:40]}-{context["revision"]}',
                "source_hash": context["source_hash"],
                "context_hash": context["context_hash"],
                "projection_hash": projection["payload_hash"] if retained else None,
                "reason": "Synthetic protocol reviewer: every controlled owner removed together; retained owners checked",
                "evidence": self.evidence("jointdb-" + copy_id),
            },
        )
        if status >= 400:
            return self.reject(
                summary,
                "joint_database",
                copy_id,
                person,
                "api_refused",
                http=status,
                detail=body.get("detail") if isinstance(body, dict) else None,
            )
        summary["joint_database"]["approved"] += 1
        self.log(
            {
                "section": "joint_database",
                "copy_id": copy_id,
                "person_id": person,
                "decision": "APPROVED",
                "controlled": controlled,
                "retained": retained,
                "context_hash": context["context_hash"],
                "projection_hash": projection["payload_hash"] if retained else None,
            }
        )

    def review_joint_file(self, adapter, person, event_key, target, summary):
        copy_id = target["copy_id"]
        with adapter.factory() as s:
            owners = set(
                s.scalars(
                    select(CopySubject.person_id).where(CopySubject.copy_id == copy_id)
                )
            )
        if len(owners) < 2:
            return
        status, context = self.call(
            adapter, f"/copies/{copy_id}/joint-review" + adapter.query
        )
        if status >= 400:
            detail = context.get("detail") if isinstance(context, dict) else None
            return self.reject(
                summary,
                "joint_file",
                copy_id,
                person,
                "joint_context_unavailable",
                http=status,
                detail=detail,
            )
        with adapter.factory() as s:
            copy = s.get(ManagedCopy, copy_id)
            relative = copy.locator["relative_path"]
        path = Path(os.environ["PHARMSHIFT_MANAGED_STORAGE"]) / relative
        if (
            not path.is_file()
            or path.is_symlink()
            or sha256(path.read_bytes()).hexdigest() != context["source_hash"]
        ):
            return self.reject(
                summary, "joint_file", copy_id, person, "file_hash_differs_from_context"
            )
        raw = path.read_bytes()
        snapshot = json.loads(raw)  # whole shared text read and parsed by the reviewer
        if self.strict:
            listed = (
                {
                    p.get("person_id")
                    for p in snapshot.get("people", [])
                    if isinstance(p, dict)
                }
                if isinstance(snapshot, dict)
                and isinstance(snapshot.get("people"), list)
                else None
            )
            if listed != owners or set(context["context"]["owners"]) != owners:
                return self.reject(
                    summary,
                    "joint_file",
                    copy_id,
                    person,
                    "snapshot_people_differ_from_owners",
                    listed=sorted(p for p in (listed or ()) if p),
                    owners=sorted(owners),
                )
            facility = adapter.scope.split("/")[0]
            with adapter.factory() as s:
                uncontrolled = sorted(
                    p for p in owners if not s.get(ErasedSubject, (facility, p))
                )
                tokens = self.known_tokens(s, adapter.scope)
            if uncontrolled:
                return self.reject(
                    summary,
                    "joint_file",
                    copy_id,
                    person,
                    "owner_without_approved_control",
                    uncontrolled=uncontrolled,
                )
            text_value = raw.decode("utf-8")
            foreign = sorted(
                t
                for p, values in tokens.items()
                if p not in owners
                for t in values
                if t in text_value
                and not any(t in own for o in owners for own in tokens.get(o, ()))
            )
            if foreign:
                return self.reject(
                    summary,
                    "joint_file",
                    copy_id,
                    person,
                    "unregistered_person_reference",
                    tokens=foreign,
                )
        status, body = self.call(
            adapter,
            f"/copies/{copy_id}/joint-review" + adapter.query,
            {
                "shared_text_reviewed": True,
                "expected_revision": context["revision"],
                "idempotency_key": f'{event_key}-joint-{copy_id[:40]}-{context["revision"]}',
                "source_hash": context["source_hash"],
                "context_hash": context["context_hash"],
                "reason": "Synthetic protocol reviewer read the whole shared snapshot; all owners approved and controlled",
                "evidence": self.evidence("joint-" + copy_id),
            },
        )
        if status >= 400:
            return self.reject(
                summary, "joint_file", copy_id, person, "api_refused", http=status
            )
        summary["joint_file"]["approved"] += 1
        self.log(
            {
                "section": "joint_file",
                "copy_id": copy_id,
                "person_id": person,
                "decision": "APPROVED",
                "source_hash": context["source_hash"],
                "context_hash": context["context_hash"],
                "owners": sorted(owners),
                "review_hash": body.get("review_hash"),
            }
        )
