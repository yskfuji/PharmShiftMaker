"""Real PostgreSQL public-API adapter for the publication/leave/hold projection.

The copy/restore projection is deliberately unavailable until its adapter is
connected. This module cannot mark the complete coupled model as accepted.
Each reset owns a transactionally truncated *random isolated test schema*;
production/public schemas are rejected. No API response is manufactured from
an expected model transition.
"""

import re
from datetime import datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from shift_scheduler.api.main import app
from shift_scheduler.db.base import Base
from shift_scheduler.db.planning_models import (
    AccountMembership,
    LeaveBalance,
    PlanningHead,
    PlanningPublication,
    PlanningScope,
)
from shift_scheduler.domain.planning import (
    ContractRevision,
    Evidence,
    Interval,
    LeaveAllocation,
    LeaveGrant,
    Person,
    SolverSnapshot,
)

JST = ZoneInfo("Asia/Tokyo")


class PublicApiProjection:
    def __init__(self, factory, *, isolate_database=True, allow_owned_database=False):
        self.factory = factory
        self.engine = factory.kw["bind"]
        self.isolate_database = isolate_database
        if self.engine.dialect.name != "postgresql":
            raise ValueError("Actual PostgreSQL required")
        with self.engine.connect() as conn:
            self.schema = conn.scalar(text("SELECT current_schema()"))
            database_name = conn.scalar(text("SELECT current_database()"))
        owned_public = (
            allow_owned_database
            and self.schema == "public"
            and re.fullmatch(r"pharmshift_audit_restore_[0-9a-f]{32}", database_name)
        )
        if not owned_public and (
            not self.schema.startswith("audit_") or not self.schema[6:].isalnum()
        ):
            raise ValueError("A new random audit_ schema is required")
        self.client = None
        self.previous_factory = None
        self.previous_engine = None
        self._bound = False
        self.calls = []
        self.published = {}
        self.request_bodies = {}
        self.settled = {}
        self.subject_requests = {}

    def reset(self, trace_id):
        self.close()
        if self.isolate_database:
            names = [
                f'"{self.schema}"."{table.name}"'
                for table in Base.metadata.sorted_tables
            ]
            with self.engine.begin() as conn:
                conn.execute(
                    text("TRUNCATE " + ",".join(names) + " RESTART IDENTITY CASCADE")
                )
        with self.factory.begin() as session:
            for p, department in enumerate(("a", "b")):
                session.add(
                    AccountMembership(
                        membership_id=f"fixture-{p}",
                        issuer="mock",
                        subject="admin",
                        person_id="privacy-operator",
                        scope_id="hospital/" + department,
                        role="ADMIN",
                        active=True,
                    )
                )
        self.attach_existing()
        self.calls = []
        self.published = {}
        self.request_bodies = {}
        self.settled = {}
        self.subject_requests = {}
        # Baseline grants are imported through the real API, not inserted as balances.
        for person in range(2):
            self._register(person, 0)
        return {
            "backend": "postgresql",
            "schema": self.schema,
            "trace_id": trace_id,
            "connected_projection": ["publication_versions", "lots", "holds"],
            "missing_projection": [
                "operational_copies",
                "backups",
                "restore",
                "control_generation",
            ],
        }

    def attach_existing(self):
        """Bind API to an already migrated isolated database without resetting it."""
        import shift_scheduler.db.session as database

        self.previous_factory = database._SessionFactory
        self.previous_engine = database._ENGINE
        database._SessionFactory = self.factory
        database._ENGINE = self.engine
        self._bound = True
        self.client = TestClient(app, base_url="https://localhost:8000")
        self.client.__enter__()
        self.client.cookies.clear()
        reply = self.client.post(
            "/auth/login", json={"username": "admin", "password": "pass-admin"}
        )
        reply.raise_for_status()
        self.auth = {"Authorization": "Bearer " + reply.json()["access_token"]}

    def request(self, path, body=None, *, method="POST"):
        response = (
            self.client.request(method, path, json=body, headers=self.auth)
            if body is not None
            else self.client.get(path, headers=self.auth)
        )
        self.calls.append(
            {
                "path": path,
                "status": response.status_code,
                "method": method if body is not None else "GET",
            }
        )
        return response

    def _scope(self, p):
        return "hospital/" + ("a" if p == 0 else "b")

    def _query(self, p):
        return "?scope_id=" + quote(self._scope(p), safe="")

    def _register(self, p, m):
        start = datetime(2026, 2 + m, 1, tzinfo=JST)
        end = datetime(2026, 3 + m, 1, tzinfo=JST)
        ev = Evidence(
            reference="synthetic-coupled-acceptance",
            status="verified",
            verified_by="independent-fixture",
        )
        with self.factory() as session:
            balance = session.get(LeaveBalance, f"lot-p{p}")
            consumed, reserved = (
                (balance.consumed, balance.reserved) if balance else (0, 0)
            )
            scope = session.get(PlanningScope, self._scope(p))
            revision = scope.input_revision if scope else 0
            heads = list(
                session.scalars(
                    select(PlanningHead)
                    .join(
                        PlanningPublication,
                        PlanningHead.publication_id
                        == PlanningPublication.publication_id,
                    )
                    .where(PlanningPublication.scope_id == self._scope(p))
                )
            )
            former = next(
                (
                    session.get(PlanningPublication, h.publication_id)
                    for h in heads
                    if session.get(
                        PlanningPublication, h.publication_id
                    ).period_key.startswith(start.date().isoformat())
                ),
                None,
            )
            credits = (
                [
                    LeaveAllocation.model_validate(a)
                    for a in former.payload["leave_allocations"]
                ]
                if former
                else []
            )
            former_id = former.publication_id if former else None
        allocation = LeaveAllocation(
            allocation_id=f"leave-{p}-{m}",
            grant_id=f"lot-p{p}",
            person_id=f"p{p}",
            amount=1,
            start=start + timedelta(days=14),
            end=start + timedelta(days=15),
            decision=ev,
        )
        data = SolverSnapshot(
            source_revision=revision,
            facility_id="hospital",
            department_id="a" if p == 0 else "b",
            period=Interval(start=start, end=end),
            context=Interval(
                start=datetime(2025, 1, 1, tzinfo=JST),
                end=datetime(2027, 1, 1, tzinfo=JST),
            ),
            rule_revision="coupled-acceptance-v1",
            policy_evidence=ev,
            history_complete=True,
            candidate_catalog_complete=True,
            people=(Person(person_id=f"p{p}", name=f"Synthetic {p}"),),
            contracts=(
                ContractRevision(
                    revision_id=f"contract-p{p}",
                    relationship_id=f"e{p}",
                    person_id=f"p{p}",
                    employer_id="hospital",
                    facility_id="hospital",
                    department_id="a" if p == 0 else "b",
                    start=datetime(2025, 1, 1, tzinfo=JST),
                    end=datetime(2027, 1, 1, tzinfo=JST),
                    evidence=ev,
                    regime_evidence=ev,
                    external_work_confirmed=True,
                    period_max_seconds=160 * 3600,
                    contractual_week_seconds=40 * 3600,
                ),
            ),
            capabilities=(),
            candidates=(),
            demands=(),
            lookahead_days=0,
            grants=(
                LeaveGrant(
                    grant_id=f"lot-p{p}",
                    person_id=f"p{p}",
                    employer_id="hospital",
                    granted_on=datetime(2026, 2, 1).date(),
                    expires_on=datetime(2027, 2, 1).date(),
                    amount=2,
                    consumed=consumed,
                    reserved=reserved,
                    evidence=ev,
                ),
            ),
            leaves=(allocation,),
            replaces_publication_id=former_id,
            reservation_credits=tuple(credits),
        )
        reply = self.request(
            "/planning/inputs",
            {"snapshot": data.model_dump(mode="json"), "expected_revision": revision},
        )
        return reply, data

    def apply(self, action):
        p = action.get("person", 0)
        op = action["op"]
        q = self._query(p)
        if op == "publish":
            m = action["month"]
            version = action["version"]
            variant = action["variant"]
            key = (p, m, version, variant)
            if key not in self.request_bodies:
                registered, data = self._register(p, m)
                if registered.status_code >= 400:
                    return self.result(registered)
                draft = self.request(
                    "/planning/drafts" + q,
                    {
                        "input_hash": data.input_hash,
                        "proposal": {"duty_ids": [], "leave_ids": [f"leave-{p}-{m}"]},
                        "idempotency_key": f"draft-{p}-{m}-{version}-{variant}-{data.input_hash[:12]}",
                    },
                )
                if draft.status_code >= 400:
                    return self.result(draft)
                d = draft.json()
                review = self.request(
                    f"/planning/drafts/{d['draft_id']}/review" + q,
                    {
                        "version": 1,
                        "idempotency_key": f"review-{p}-{m}-{version}-{variant}-{data.input_hash[:12]}",
                    },
                )
                if review.status_code >= 400:
                    return self.result(review)
                body = {
                    "version": 1,
                    "expected_publication_version": version - 1,
                    "input_hash": data.input_hash,
                    "review_hash": (
                        "stale-review"
                        if variant == "stale_approval"
                        else review.json()["review_hash"]
                    ),
                    "idempotency_key": f"publish-{p}-{m}-{version}-{variant}",
                }
                # The same actor has two legitimate scopes. A third unauthorized scope tests
                # the API membership gate rather than a client-side permission decision.
                target = (
                    q
                    if variant != "wrong_department"
                    else "?scope_id=hospital%2Funauthorized"
                )
                self.request_bodies[key] = (
                    f"/planning/drafts/{d['draft_id']}/publish" + target,
                    body,
                )
            path, body = self.request_bodies[key]
            reply = self.request(path, body)
            if reply.status_code < 400:
                self.published[(p, m)] = reply.json()
            elif variant == "normal":
                self.request_bodies.pop(key, None)
        elif op in ("consume", "duplicate_consume"):
            m = action["month"]
            key = (p, m)
            if op == "duplicate_consume" and key in self.settled:
                path, body = self.settled[key]
            else:
                with self.factory() as session:
                    balance = session.get(LeaveBalance, f"lot-p{p}")
                    revision = balance.revision
                path = f"/planning/leave-balances/lot-p{p}/settle" + q
                body = {
                    "expected_revision": revision,
                    "event_id": f"consume-{p}-{m}"
                    + ("-repeat-new" if key in self.settled else ""),
                    "kind": "consume",
                    "amount": 1,
                    "publication_id": self.published.get(key, {}).get(
                        "publication_id", "unknown-publication"
                    ),
                }
                if op == "duplicate_consume":
                    body["publication_id"] = "unknown-publication"
            reply = self.request(path, body)
            if reply.status_code < 400 and op == "consume":
                self.settled[key] = (path, body)
        elif op == "erase":
            reply = self._subject_control(p)
        elif op == "hold":
            active = action["active"]
            reply = self.request(
                "/planning/compliance/holds" + q,
                {
                    "expected_revision": 0 if active else 1,
                    "idempotency_key": f"hold-{p}-{active}",
                    "payload": {
                        "hold_id": f"hold-{p}",
                        "person_id": f"p{p}",
                        "active": active,
                        "reason": "Synthetic reviewed preservation",
                    },
                },
            )
        else:
            raise NotImplementedError("Real copy/restore adapter not connected: " + op)
        return self.result(reply)

    def _subject_control(self, p):
        """Real person barrier only: remaining-copy erasure is explicitly not projected."""
        q = self._query(p)
        base = "/planning/compliance"
        if p not in self.subject_requests:
            evidence = {
                "reference": "synthetic-coupled-officer-review",
                "status": "verified",
                "verified_by": "independent-fixture",
            }
            policy = {
                "category": "control",
                "purpose": "prevent identity reintroduction",
                "anchor": "case_closed",
                "retention_days": 365,
                "legal_minimum_days": 0,
                "effective_from": "2025-01-01",
                "effective_until": "2030-01-01",
                "evidence": evidence,
                "owner": "privacy-operator",
                "next_review": "2029-12-31",
            }

            def mutate(path, payload, key, revision=0):
                return self.request(
                    base + path + q,
                    {
                        "expected_revision": revision,
                        "idempotency_key": key,
                        "payload": payload,
                    },
                )

            result = mutate("/retention-rules", policy, f"control-policy-{p}")
            if result.status_code >= 400:
                return result
            case = mutate(
                "/privacy/requests",
                {
                    "person_id": f"p{p}",
                    "kind": "erase",
                    "reason": "Synthetic reviewed person request",
                },
                f"person-request-{p}",
            )
            if case.status_code >= 400:
                return case
            record = case.json()
            for status in ("VERIFIED", "APPROVED"):
                decision = mutate(
                    "/privacy/cases/" + record["case_id"],
                    {
                        "status": status,
                        "identity_evidence": evidence,
                        "reason": "Synthetic independently reviewed decision",
                    },
                    f"person-decision-{p}-{status}",
                    record["revision"],
                )
                if decision.status_code >= 400:
                    return decision
                record = decision.json()
            self.subject_requests[p] = {
                "expected_revision": 0,
                "idempotency_key": f"person-control-{p}",
                "case_id": record["case_id"],
                "case_revision": record["revision"],
                "reason": "Reviewed stable identity restriction",
            }
        return self.request(
            base + f"/subject-controls/p{p}" + q, self.subject_requests[p]
        )

    def result(self, response):
        return {
            "accepted": response.status_code < 400,
            "http_status": response.status_code,
            "body": response.json(),
            "observation": self.observe(),
            "projection_complete": False,
            "calls": list(self.calls),
        }

    def observe(self):
        versions = [0] * 4
        lots = []
        holds = []
        from shift_scheduler.db.compliance_models import LegalHold

        with self.factory() as session:
            for head in session.scalars(select(PlanningHead)):
                row = session.get(PlanningPublication, head.publication_id)
                if row.scope_id not in ("hospital/a", "hospital/b"):
                    continue
                p = 0 if row.scope_id == "hospital/a" else 1
                m = int(row.period_key[5:7]) - 2
                if 0 <= m < 2:
                    versions[p * 2 + m] = row.version
            for p in range(2):
                row = session.get(LeaveBalance, f"lot-p{p}")
                lots.append(
                    {
                        "lot": row.grant_id,
                        "available": row.amount - row.consumed - row.reserved,
                        "reserved": row.reserved,
                        "consumed": row.consumed,
                    }
                )
                hold = session.get(LegalHold, f"hold-{p}")
                holds.append(hold.revision if hold else 0)
        from shift_scheduler.db.compliance_models import ErasedSubject

        with self.factory() as session:
            controlled = [
                p for p in range(2) if session.get(ErasedSubject, ("hospital", f"p{p}"))
            ]
        return {
            "publication_versions": versions,
            "lots": lots,
            "holds": holds,
            "subject_controls": controlled,
            "operational_copy_projection_complete": False,
        }

    def close(self):
        if self.client:
            self.client.__exit__(None, None, None)
            self.client = None
        if self._bound:
            import shift_scheduler.db.session as database

            database._SessionFactory = self.previous_factory
            database._ENGINE = self.previous_engine
            self._bound = False
