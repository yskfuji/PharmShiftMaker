"""Disposable E2E backend + worker. Never reads or resets application data."""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

# The reusable virtualenv is an editable install owned by the original checkout.
# Make this disposable server import the isolated worktree under test instead of
# silently exercising that other checkout.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPOSITORY_ROOT / "src"
for local_path in (str(SOURCE_ROOT), str(REPOSITORY_ROOT)):
    if local_path in sys.path:
        sys.path.remove(local_path)
    sys.path.insert(0, local_path)


def seed_historical_flex_adoptions(environ: dict[str, str]) -> bool:
    """Return whether the deep U22 fixture needs already-started adoptions.

    The legacy flag-OFF flex E2E uses ``PHARMSHIFT_E2E_FLEX`` only to add an
    independent administrator.  Seeding historical adoptions there changes the
    product state under test, so the seed is restricted to the deep use-case
    matrix explicitly.
    """
    return (
        environ.get("PHARMSHIFT_E2E_FLEX") == "1"
        and environ.get("PHARMSHIFT_E2E_DEEP") == "1"
    )


BASE_MEMBERSHIPS = (
    ("admin", "p0", "ADMIN"),
    ("pharmacist", "p1", "PHARMACIST"),
    ("leader", "p0", "LEADER"),
)
INDEPENDENT_APPROVER = ("developer", "p-reviewer", "ADMIN")
INDEPENDENT_APPROVER_FLAGS = (
    "PHARMSHIFT_E2E_DEEP",
    "PHARMSHIFT_E2E_FLEX",
    # Adds the second administrator and nothing else (no data, no hook, no clock).
    "PHARMSHIFT_E2E_INDEPENDENT_APPROVER",
)


def fixture_memberships(environ: dict[str, str]) -> list[tuple[str, str, str]]:
    """The account links of the fixture: (subject, person, role) in hospital/pharmacy.

    ``admin`` and ``leader`` are both Person 0, so a case that changes Person 0's duty
    has nobody independent to approve it. Destructive decisions, related-person cases
    and the legacy flex flow need a second administrator who is neither person on the
    schedule: ``developer``. It exists only when a journey asks for it, so unrelated
    legacy and flag-OFF fixtures keep exactly the three links they always had.
    """
    memberships = list(BASE_MEMBERSHIPS)
    if any(environ.get(flag) == "1" for flag in INDEPENDENT_APPROVER_FLAGS):
        memberships.append(INDEPENDENT_APPROVER)
    return memberships


def require_synthetic_fixture(environ: dict[str, str], what: str) -> None:
    """Refuse a test-only behaviour outside the mock, development synthetic server."""
    if (
        environ.get("AUTH_MODE") != "mock"
        or environ.get("PHARMSHIFT_ENV") != "development"
    ):
        raise RuntimeError(what + " is allowed only in synthetic mock fixtures")


def seed_expired_input(environ: dict[str, str]) -> bool:
    """Return whether the deep U29 fixture registers superseded planning inputs.

    They add periods and a retention rule to the scope, so they exist only for the
    journey that erases one of them: every other journey and every flag-OFF spec
    keeps the single registered input.
    """
    return (
        environ.get("PHARMSHIFT_E2E_EXPIRED_INPUT") == "1"
        and environ.get("PHARMSHIFT_E2E_DEEP") == "1"
    )


def capture_input_erasure(database_url: str, input_hash: str) -> dict[str, object]:
    """Observe one planning input in the disposable schema, before and after its
    erasure (U29): the input, the drafts and jobs that depend on it, and the markers.

    Exposed only by the synthetic deep-E2E factory. It reads counts and writes nothing.
    """
    from sqlalchemy import create_engine, text

    if not re.fullmatch(r"[a-f0-9]{64}", input_hash):
        raise ValueError("A planning input is named by its SHA-256")
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:

            def count(statement: str) -> int:
                return int(connection.scalar(text(statement), {"h": input_hash}) or 0)

            return {
                "input_hash": input_hash,
                "remaining_inputs": count(
                    "SELECT count(*) FROM planning_inputs WHERE input_hash = :h"
                ),
                "remaining_drafts": count(
                    "SELECT count(*) FROM planning_drafts WHERE input_hash = :h"
                ),
                "remaining_jobs": count(
                    "SELECT count(*) FROM planning_jobs WHERE input_hash = :h"
                ),
                "unfinished_jobs": count("""SELECT count(*) FROM planning_jobs
                    WHERE input_hash = :h AND status IN ('QUEUED', 'RUNNING')"""),
                "input_tombstones": count("""SELECT count(*) FROM erasure_markers
                    WHERE table_name = 'planning_inputs' AND object_key = :h"""),
                "executed_plans": count(
                    """SELECT count(*) FROM erasure_plans WHERE status = 'EXECUTED'
                    AND plan_id IN (SELECT plan_id FROM erasure_markers
                      WHERE table_name = 'planning_inputs' AND object_key = :h)"""
                ),
                "plan_tombstones": count(
                    """SELECT count(*) FROM erasure_markers WHERE plan_id IN
                    (SELECT plan_id FROM erasure_markers
                      WHERE table_name = 'planning_inputs' AND object_key = :h)"""
                ),
                "other_inputs": count(
                    "SELECT count(*) FROM planning_inputs WHERE input_hash <> :h"
                ),
                "database": "disposable schema",
            }
    finally:
        engine.dispose()


def capture_erasure_receipt(
    database_url: str, receipt_path: str | None = None
) -> dict[str, object]:
    """Observe U25 in its disposable schema and prove raw revival is rejected.

    This helper is exposed only by the synthetic deep-E2E factory.  Capturing it
    before Playwright stops the web server avoids relying on subprocess shutdown
    timing for the acceptance evidence.
    """
    from sqlalchemy import create_engine, text

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            entity_count = connection.scalar(
                text(
                    "SELECT count(*) FROM compliance_entities WHERE person_id = 'p-erasure'"
                )
            )
            revision_count = connection.scalar(
                text(
                    "SELECT count(*) FROM compliance_revisions WHERE payload->>'person_id' = 'p-erasure'"
                )
            )
            control_count = connection.scalar(
                text(
                    "SELECT count(*) FROM erased_subjects WHERE person_id = 'p-erasure'"
                )
            )
            tombstone_count = connection.scalar(
                text(
                    """SELECT count(*) FROM managed_copies
                WHERE state = 'ERASED'
                  AND locator->>'table' IN ('compliance_entities','compliance_revisions')"""
                )
            )
        non_revival_blocked = False
        try:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        """INSERT INTO compliance_entities
                    (key,scope_id,kind,entity_id,person_id,revision,payload,created_at)
                    VALUES ('e2e-revival','hospital/pharmacy','contract','revival','p-erasure',1,'{}',now())"""
                    )
                )
        except Exception:
            non_revival_blocked = True
        result: dict[str, object] = {
            "person_id": "p-erasure",
            "remaining_entities": entity_count,
            "remaining_revisions": revision_count,
            "subject_control_count": control_count,
            "database_erasure_tombstone_count": tombstone_count,
            "reintroduction_blocked": non_revival_blocked,
            "database": "disposable PostgreSQL schema",
        }
        if receipt_path:
            destination = Path(receipt_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        return result
    finally:
        engine.dispose()


@contextmanager
def isolated_database(directory):
    configured = os.getenv("PHARMSHIFT_E2E_PG_URL")
    if not configured:
        yield "sqlite:///" + str(Path(directory) / "isolated.db")
        return
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    parsed = make_url(configured)
    owned = (
        parsed.port == 55443
        and re.fullmatch(r"pharmshift_audit(?:_[a-z0-9_]+)?", parsed.database or "")
    ) or (
        parsed.port == 55449
        and parsed.database == "pharmshift_audit_uiux"
        and parsed.username == "audit"
    )
    if (
        parsed.get_backend_name() != "postgresql"
        or parsed.host != "127.0.0.1"
        or not owned
        or parsed.query
    ):
        raise ValueError(
            "E2E only accepts the owned loopback storage-closure audit database"
        )
    schema = "audit_browser_" + uuid4().hex
    admin = create_engine(configured)
    scoped = None
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped = parsed.update_query_dict({"options": "-csearch_path=" + schema})
        print("E2E PostgreSQL schema: " + schema, flush=True)
        yield scoped.render_as_string(hide_password=False)
    finally:
        receipt_path = os.environ.get("PHARMSHIFT_E2E_ERASURE_RECEIPT")
        if receipt_path and scoped is not None:
            capture_erasure_receipt(
                scoped.render_as_string(hide_password=False), receipt_path
            )
        if scoped is not None:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def synthetic_app():
    """Fixture-only ASGI factory; never used by the production startup command."""
    from shift_scheduler.api.main import app

    fixed = os.environ.get("PHARMSHIFT_E2E_OBSERVATION_TIME")
    if fixed:
        from shift_scheduler.api.routers.planning import dashboard_observation_time
        from shift_scheduler.application import flex_adoption

        require_synthetic_fixture(os.environ, "A fixed presentation clock")
        value = datetime.fromisoformat(fixed)
        if value.tzinfo is None:
            raise ValueError("The synthetic observation clock must include a timezone")
        app.dependency_overrides[dashboard_observation_time] = lambda: value
        # Deep browser acceptance must be repeatable across calendar dates. This
        # override exists only in this mock-development ASGI factory; production
        # imports and startup never replace the domain clock.
        flex_adoption.now = lambda: value.astimezone(UTC)
    if os.environ.get("PHARMSHIFT_E2E_DEEP") == "1":
        # The stand-in control authority, the /__e2e/* routes and the read-fault
        # middleware exist for the deep browser journeys only. Checked before anything
        # is replaced or registered.
        require_synthetic_fixture(
            os.environ, "The deep E2E hooks (/__e2e/* and the read fault)"
        )
        from types import SimpleNamespace

        from shift_scheduler.application import subject_controls
        from shift_scheduler.control import transaction

        authority = SimpleNamespace(
            client_id="synthetic-e2e-authority",
            require_access=lambda: {"allowed": True, "generation": 1},
            request=lambda *_args, **_kwargs: {},
        )
        subject_controls.configured_client = lambda: authority
        transaction.configured_client = lambda: authority
        if not any(
            getattr(route, "path", None) == "/__e2e/erasure-receipt"
            for route in app.routes
        ):

            def erasure_receipt() -> dict[str, object]:
                return capture_erasure_receipt(
                    os.environ["DATABASE_URL"],
                    os.environ.get("PHARMSHIFT_E2E_ERASURE_RECEIPT"),
                )

            app.add_api_route(
                "/__e2e/erasure-receipt",
                erasure_receipt,
                methods=["POST"],
                include_in_schema=False,
            )
        if not any(
            getattr(route, "path", None) == "/__e2e/input-erasure-receipt"
            for route in app.routes
        ):

            def input_erasure_receipt(body: dict[str, object]) -> dict[str, object]:
                return capture_input_erasure(
                    os.environ["DATABASE_URL"], str(body.get("input_hash", ""))
                )

            app.add_api_route(
                "/__e2e/input-erasure-receipt",
                input_erasure_receipt,
                methods=["POST"],
                include_in_schema=False,
            )
        if not any(
            getattr(route, "path", None) == "/__e2e/fail-next-read"
            for route in app.routes
        ):
            from fastapi.responses import JSONResponse

            fault = ReadFault()

            def fail_next_read(body: dict[str, object]) -> dict[str, object]:
                fault.arm(str(body.get("path", "")))
                return {"armed": True}

            app.add_api_route(
                "/__e2e/fail-next-read",
                fail_next_read,
                methods=["POST"],
                include_in_schema=False,
            )

            @app.middleware("http")
            async def one_shot_read_failure(request, call_next):
                if fault.take(request.method, request.url.path):
                    return JSONResponse({"detail": ReadFault.DETAIL}, status_code=503)
                return await call_next(request)

    return app


class ReadFault:
    """One synthetic 503 for the next read of an allowed path (deep browser journeys only).

    The workspace reads its context on the server, so a browser-side route interception
    cannot make that read fail. Only a listed read can be failed, only once, and only
    with a 503; nothing is written and no other request is affected.
    """

    ALLOWED = frozenset({"/planning/notifications"})
    DETAIL = "合成の通知読取り障害"

    def __init__(self) -> None:
        self._armed: str | None = None

    def arm(self, path: str) -> None:
        if path not in self.ALLOWED:
            raise ValueError("Only a listed synthetic read can be failed")
        self._armed = path

    def take(self, method: str, path: str) -> bool:
        if method != "GET" or self._armed != path:
            return False
        self._armed = None
        return True


def main():
    with (
        tempfile.TemporaryDirectory(prefix="pharmshift-remediation-e2e-") as directory,
        isolated_database(directory) as url,
    ):
        os.environ.update(
            DATABASE_URL=url,
            SHIFT_SCHEDULER_DB_URL=url,
            AUTH_MODE="mock",
            PHARMSHIFT_ENV="development",
            AUTH_JWT_SECRET="isolated-e2e-only-not-for-deployment",
            SHIFT_SCHEDULER_DATA_BACKEND="db",
            # The production-like proxy check (tests/proxy-e2e) serves the page from
            # another origin; the formal browser acceptance keeps the default.
            API_CORS_ALLOW_ORIGINS=os.environ.get(
                "PHARMSHIFT_E2E_FRONTEND_ORIGIN", "https://127.0.0.1:18511"
            ),
            PHARMSHIFT_MANAGED_STORAGE=directory,
            FRONTEND_BASE_URL=os.environ.get(
                "PHARMSHIFT_E2E_FRONTEND_ORIGIN", "https://127.0.0.1:18511"
            ),
        )
        from scripts.remediation_fixture import snapshot

        from shift_scheduler.application.planning import register_input
        from shift_scheduler.db.base import Base
        from shift_scheduler.db.planning_models import AccountMembership, PlanningOutbox
        from shift_scheduler.db.session import (
            configure_session_factory,
            get_engine,
            get_session_factory,
        )

        configure_session_factory(url)
        if url.startswith("postgresql"):
            from alembic import command
            from alembic.config import Config

            command.upgrade(Config("alembic.ini"), "head")
        else:
            Base.metadata.create_all(get_engine())
        with get_session_factory().begin() as session:
            flex = os.environ.get("PHARMSHIFT_E2E_FLEX") == "1"
            for subject, person, role in fixture_memberships(dict(os.environ)):
                session.add(
                    AccountMembership(
                        membership_id=subject,
                        issuer="mock",
                        subject=subject,
                        person_id=person,
                        scope_id="hospital/pharmacy",
                        role=role,
                        active=True,
                    )
                )
            data = snapshot(
                with_grant_series=os.environ.get("PHARMSHIFT_E2E_GRANT_SERIES") == "1",
                # Only the journey that claims half-day and hourly leave sets this.
                with_partial_day_leave=os.environ.get(
                    "PHARMSHIFT_E2E_PARTIAL_DAY_LEAVE"
                )
                == "1",
            )
            if seed_historical_flex_adoptions(os.environ):
                # U22 needs to exercise the distinct "end an adoption that has
                # already started" path.  Seed the historical adoption before the
                # planning input is registered so the fixture does not invalidate
                # the input between draft creation and review.
                from shift_scheduler.application import compliance as compliance_service
                from shift_scheduler.domain.compliance_v3 import FlexAdoption

                for engine in ("chromium", "firefox", "webkit"):
                    for viewport in (320, 768, 1440):
                        identity = f"flex-end-{engine}-{viewport}"
                        compliance_service.save_entity(
                            session,
                            "hospital/pharmacy",
                            "flex_adoption",
                            FlexAdoption(
                                adoption_id=identity,
                                employer_id="hospital",
                                establishment_id="site-hospital",
                                start="2026-01-01T00:00:00+09:00",
                                end="2026-12-01T00:00:00+09:00",
                                target_scope=f"終了確認 {engine} {viewport}",
                                settlement_months=1,
                                settlement_anchor="2026-01-01",
                                total_hours_rule="statutory_frame",
                                agreed_total_description="清算期間の暦日数 ÷ 7 × 40時間",
                                standard_day_seconds=8 * 3600,
                                work_rules_evidence={
                                    "reference": "合成就業規則",
                                    "status": "verified",
                                    "verified_by": "synthetic-reviewer",
                                },
                                agreement_evidence={
                                    "reference": "合成労使協定",
                                    "status": "verified",
                                    "verified_by": "synthetic-reviewer",
                                },
                                status="confirmed",
                                created_by="admin",
                                created_at="2025-12-01T09:00:00+09:00",
                                reviewed_by="developer",
                                reviewed_at="2025-12-02T09:00:00+09:00",
                            ).model_dump(mode="json"),
                            0,
                            "synthetic-fixture",
                        )
            # Only the journey that erases a superseded input registers any: they
            # come first, so the fixture's own input stays the newest of the scope.
            earlier_inputs = 0
            if seed_expired_input(os.environ):
                from scripts.remediation_fixture import seed_retention_trial

                earlier_inputs = seed_retention_trial(session)
            register_input(session, data, "fixture", earlier_inputs)
            if os.environ.get("PHARMSHIFT_E2E_DEEP") == "1":
                from sqlalchemy import select

                from shift_scheduler.application import compliance as compliance_service
                from shift_scheduler.application import copies
                from shift_scheduler.db.compliance_models import (
                    ComplianceEntity,
                    ComplianceRevision,
                    CopySubject,
                    ManagedCopy,
                    RetentionRule,
                )
                from shift_scheduler.domain.copies import DatabaseCopyReview
                from shift_scheduler.domain.planning import Evidence, content_hash

                policy = {
                    "purpose": "synthetic browser erasure acceptance",
                    "anchor": "last_activity",
                    "retention_days": 1,
                    "legal_minimum_days": 0,
                    "effective_from": "2025-01-01",
                    "effective_until": "2027-01-01",
                    "evidence": {
                        "reference": "isolated E2E approval",
                        "status": "verified",
                        "verified_by": "synthetic-reviewer",
                    },
                    "owner": "synthetic-reviewer",
                    "next_review": "2026-12-31",
                }
                session.add(
                    RetentionRule(
                        key="e2e-compliance",
                        scope_id="hospital/pharmacy",
                        category="compliance",
                        revision=1,
                        payload={**policy, "category": "compliance"},
                    )
                )
                session.add(
                    RetentionRule(
                        key="e2e-control",
                        scope_id="hospital/pharmacy",
                        category="control",
                        revision=1,
                        payload={
                            **policy,
                            "category": "control",
                            "anchor": "case_closed",
                            "retention_days": 365,
                        },
                    )
                )
                # This dedicated U25 subject must be covered by managed-copy
                # erasure without being interpreted as a solver contract by the
                # unrelated planning journeys that share this fixture builder.
                session.add(
                    ComplianceEntity(
                        key="e2e-erasure-person",
                        scope_id="hospital/pharmacy",
                        kind="synthetic_erasure_probe",
                        entity_id="e2e-erasure-person",
                        person_id="p-erasure",
                        revision=1,
                        payload={"person_id": "p-erasure", "synthetic": True},
                        created_at=datetime(2020, 1, 1, tzinfo=UTC),
                    )
                )
                session.flush()
                session.add(
                    ComplianceRevision(
                        key="e2e-erasure-revision",
                        entity_key="e2e-erasure-person",
                        revision=1,
                        payload={"person_id": "p-erasure", "synthetic": True},
                        actor="synthetic-reviewer",
                        created_at=datetime(2020, 1, 1, tzinfo=UTC),
                    )
                )
                for person_id, name in (
                    ("p-erasure", "合成消去対象"),
                    ("p-unlinked", "合成未紐付け職員"),
                    ("p-offboard", "合成退職確認職員"),
                ):
                    key = compliance_service.entity_key(
                        "hospital/pharmacy", "person", person_id
                    )
                    payload = {"person_id": person_id, "name": name}
                    session.add(
                        ComplianceEntity(
                            key=key,
                            scope_id="hospital/pharmacy",
                            kind="person",
                            entity_id=person_id,
                            person_id=person_id,
                            revision=1,
                            payload=payload,
                            created_at=datetime(2020, 1, 1, tzinfo=UTC),
                        )
                    )
                    session.flush()
                    session.add(
                        ComplianceRevision(
                            key=content_hash([key, 1]),
                            entity_key=key,
                            revision=1,
                            payload=payload,
                            actor="synthetic-reviewer",
                            created_at=datetime(2020, 1, 1, tzinfo=UTC),
                        )
                    )
                # U12 uses a dedicated subject whose authoritative records already
                # establish the system-backed offboarding tasks: the contract has
                # ended, no active membership exists, and the immutable planning
                # input has no candidate for this person.  Only the balance review
                # remains an administrator attestation in the browser journey.
                contract_key = compliance_service.entity_key(
                    "hospital/pharmacy", "contract", "e2e-offboard-contract"
                )
                contract_payload = {
                    **data.contracts[0].model_dump(mode="json"),
                    "revision_id": "e2e-offboard-contract",
                    "relationship_id": "e2e-offboard-relationship",
                    "person_id": "p-offboard",
                    "start": "2025-01-01T00:00:00+09:00",
                    "end": "2025-12-31T23:59:59+09:00",
                }
                session.add(
                    ComplianceEntity(
                        key=contract_key,
                        scope_id="hospital/pharmacy",
                        kind="contract",
                        entity_id="e2e-offboard-contract",
                        person_id="p-offboard",
                        revision=1,
                        payload=contract_payload,
                        created_at=datetime(2020, 1, 1, tzinfo=UTC),
                    )
                )
                session.flush()
                session.add(
                    ComplianceRevision(
                        key=content_hash([contract_key, 1]),
                        entity_key=contract_key,
                        revision=1,
                        payload=contract_payload,
                        actor="synthetic-reviewer",
                        created_at=datetime(2020, 1, 1, tzinfo=UTC),
                    )
                )
                session.flush()
                evidence = Evidence(
                    reference="isolated E2E database-copy review",
                    status="verified",
                    verified_by="synthetic-reviewer",
                )
                fixed_observation = os.environ.get("PHARMSHIFT_E2E_OBSERVATION_TIME")
                observed = (
                    datetime.fromisoformat(fixed_observation)
                    if fixed_observation
                    else datetime.now().astimezone()
                )
                for copy in session.scalars(
                    select(ManagedCopy).where(ManagedCopy.category == "compliance")
                ):
                    people = tuple(
                        session.scalars(
                            select(CopySubject.person_id).where(
                                CopySubject.copy_id == copy.copy_id
                            )
                        )
                    )
                    if "p-erasure" in people:
                        copies.review_database_copy(
                            session,
                            "hospital/pharmacy",
                            DatabaseCopyReview(
                                copy_id=copy.copy_id,
                                content_hash=copy.content_hash,
                                person_ids=people,
                                evidence=evidence,
                            ),
                            copy.revision,
                            "synthetic-reviewer",
                            observed,
                        )
            if os.environ.get("PHARMSHIFT_E2E_PUBLICATION") == "1":
                from shift_scheduler.application import planning, rule_impact
                from shift_scheduler.optimizer.planning import solve

                # The synthetic fixture is published at the start of its own period;
                # its rule review is due before today's real date.
                rule_impact.today = lambda _timezone: data.period.start.date()
                source = planning.require_input(
                    session, data.input_hash, "hospital/pharmacy"
                )
                solved = solve(data, 10)
                if solved.proposal is None:
                    raise ValueError(
                        "Synthetic export fixture did not produce a feasible publication"
                    )
                # The self-service journeys require one real assignment owned by
                # the pharmacist account. The optimizer's deterministic optimum
                # gives every equivalent duty to p0, so replace one duty with the
                # otherwise identical p1 candidate in this synthetic fixture.
                proposal = solved.proposal
                candidates = {d.duty_id: d for d in data.candidates}
                if not any(
                    candidates[duty_id].person_id == "p1"
                    for duty_id in proposal.duty_ids
                ):
                    duty_ids = list(proposal.duty_ids)
                    original = candidates[duty_ids[0]]
                    replacement = next(
                        candidate
                        for candidate in data.candidates
                        if candidate.person_id == "p1"
                        and (
                            candidate.start,
                            candidate.end,
                            candidate.task,
                            candidate.location,
                        )
                        == (
                            original.start,
                            original.end,
                            original.task,
                            original.location,
                        )
                    )
                    duty_ids[0] = replacement.duty_id
                    proposal = proposal.model_copy(update={"duty_ids": tuple(duty_ids)})
                draft = planning.new_draft(session, source, proposal, "admin")
                session.flush()
                review = planning.review_draft(
                    session, draft.draft_id, "hospital/pharmacy", 1, "admin"
                )
                planning.publish(
                    session,
                    draft.draft_id,
                    "hospital/pharmacy",
                    "admin",
                    1,
                    0,
                    data.input_hash,
                    review["review_hash"],
                    "synthetic-export-publication",
                )
            if flex:
                # The synthetic site runs into the future, so an adoption can start
                # on a coming settlement period (no adoption is created here).
                from shift_scheduler.application import compliance as service

                site = dict(
                    data.establishments[0].model_dump(mode="json"),
                    end="2029-01-01T00:00:00+09:00",
                )
                stored = service.entity_key(
                    "hospital/pharmacy", "establishment", site["establishment_id"]
                )
                from shift_scheduler.db.compliance_models import ComplianceEntity

                existing = session.get(ComplianceEntity, stored)
                service.save_entity(
                    session,
                    "hospital/pharmacy",
                    "establishment",
                    site,
                    existing.revision if existing else 0,
                    "fixture",
                )
            if os.environ.get("PHARMSHIFT_E2E_ACTUAL") == "1":
                from shift_scheduler.application.planning import import_actual

                import_actual(
                    session,
                    "hospital/pharmacy",
                    "fixture",
                    "synthetic-clock",
                    1,
                    data.candidates[0].model_copy(update={"source": "actual"}),
                    expected_revision=0,
                )
            # The fixture clock is also the source of truth for the initial audit
            # timeline.  Browser-clock emulation cannot change timestamps that the
            # backend already persisted, and UUID ordering is deliberately random.
            # Preserve the real creation order while assigning deterministic times
            # only in this explicitly synthetic, fixed-clock process.
            fixed = os.environ.get("PHARMSHIFT_E2E_OBSERVATION_TIME")
            if fixed:
                from sqlalchemy import select

                origin = datetime.fromisoformat(fixed)
                session.flush()
                seeded_events = session.scalars(
                    select(PlanningOutbox).order_by(
                        PlanningOutbox.created_at, PlanningOutbox.event_id
                    )
                ).all()
                for offset, event in enumerate(seeded_events):
                    event.created_at = origin + timedelta(microseconds=offset)
        worker_command = [sys.executable, "-m", "shift_scheduler.application.worker"]
        worker_delay = float(os.environ.get("PHARMSHIFT_E2E_WORKER_DELAY_SECONDS", "0"))
        if worker_delay < 0 or worker_delay > 10:
            raise ValueError(
                "The synthetic worker delay must be between 0 and 10 seconds"
            )
        if worker_delay:
            worker_command = [
                sys.executable,
                "-c",
                (
                    "import time; time.sleep(" + repr(worker_delay) + "); "
                    "from shift_scheduler.application.worker import main; main()"
                ),
            ]
        worker = subprocess.Popen(
            worker_command,
            env=os.environ.copy(),
        )
        api = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "scripts.remediation_test_server:synthetic_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                (
                    "18540"
                    if os.environ.get("PHARMSHIFT_E2E_PORT") == "18540"
                    else "18510"
                ),
                "--ssl-certfile",
                os.environ.get("PHARMSHIFT_E2E_TLS_CERT", "certs/localhost-cert.pem"),
                "--ssl-keyfile",
                os.environ.get("PHARMSHIFT_E2E_TLS_KEY", "certs/localhost-key.pem"),
            ],
            env=os.environ.copy(),
        )

        def stop(*_):
            api.terminate()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        try:
            api.wait()
        finally:
            worker.terminate()
            worker.wait(timeout=10)
            if api.poll() is None:
                api.terminate()
                api.wait(timeout=10)


if __name__ == "__main__":
    main()
