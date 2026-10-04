"""Real API hold/erase/retry chain over shared histories; known residuals remain."""

from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import (
    CopySubject,
    ManagedCopy,
    PreservedArchive,
)
from shift_scheduler.db.planning_models import AccountMembership, PlanningInput
from tests.test_compliance_api import token
from tests.test_database_erasure_postgres import AT, EVIDENCE, SCOPE
from tests.test_shared_projection import prepare


class FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return AT.astimezone(tz) if tz else AT.replace(tzinfo=None)


@pytest.mark.parametrize("order", [("p0", "p1"), ("p1", "p0")])
def test_shared_history_hold_recheck_erasure_and_successor_via_api(
    pg, monkeypatch, order
):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    data, copy_id, _ = prepare(pg, people=2)
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="privacy-operator",
                issuer="mock",
                subject="admin",
                person_id="operator-only",
                scope_id=SCOPE,
                role="ADMIN",
                active=True,
            )
        )
    q = "?scope_id=hospital%2Fpharmacy"
    base = "/planning/compliance"
    with (
        patch("shift_scheduler.application.copies.datetime", FixedClock),
        patch("shift_scheduler.api.routers.compliance.datetime", FixedClock),
        TestClient(app, base_url="https://localhost:8000") as client,
    ):
        auth = token(client)

        def write(operation, payload, key, revision=0):
            return client.post(
                base + operation + q,
                headers=auth,
                json={
                    "expected_revision": revision,
                    "idempotency_key": key,
                    "payload": payload,
                },
            )

        def review(person, only_archives=False):
            with pg() as session:
                rows = []
                for row in session.scalars(select(ManagedCopy)):
                    if row.state != "PRESENT":
                        continue
                    if (
                        only_archives
                        and row.locator.get("table") != "preserved_archives"
                    ):
                        continue
                    if (
                        not only_archives
                        and row.copy_id != copy_id
                        and not row.evidence.get("preservation_review")
                    ):
                        continue
                    subjects = list(
                        session.scalars(
                            select(CopySubject.person_id).where(
                                CopySubject.copy_id == row.copy_id
                            )
                        )
                    )
                    if person in subjects:
                        rows.append(
                            (row.copy_id, row.content_hash, row.revision, subjects)
                        )
            for identity, hash_, version, subjects in rows:
                checked = write(
                    "/copies/review-database",
                    {
                        "copy_id": identity,
                        "content_hash": hash_,
                        "person_ids": subjects,
                        "evidence": EVIDENCE.model_dump(mode="json"),
                    },
                    f"db-review-{person}-{identity}",
                    version,
                )
                assert checked.status_code == 200, checked.text
                if len(subjects) == 1:
                    continue  # Dedicated erasure, no shared successor is needed.
                projection = client.get(
                    base
                    + f"/copies/{identity}/projection"
                    + q
                    + "&person_id="
                    + person,
                    headers=auth,
                )
                assert projection.status_code == 200, projection.text
                value = projection.json()
                kept = write(
                    "/copies/review-preservation",
                    {
                        "copy_id": identity,
                        "person_id": person,
                        "content_hash": hash_,
                        "projection_hash": value["payload_hash"],
                        "shared_text_reviewed": True,
                        "evidence": EVIDENCE.model_dump(mode="json"),
                    },
                    f"projection-{person}-{identity}",
                    value["revision"],
                )
                assert kept.status_code == 200, kept.text

        first, second = order
        review(first)
        preview = write(
            "/copies/preview", {"person_id": first}, "pre-hold-preview"
        ).json()
        hold = {
            "hold_id": "late-hold",
            "person_id": first,
            "active": True,
            "reason": "synthetic late preservation",
        }
        assert write("/holds", hold, "late-hold-add").status_code == 200
        stale = write(
            "/copies/execute",
            {"plan_id": preview["plan_id"], "fingerprint": preview["fingerprint"]},
            "stale-held-execute",
            preview["revision"],
        )
        assert stale.status_code == 409
        with pg() as session:
            assert session.get(PlanningInput, data.input_hash) is not None
        assert (
            write(
                "/holds", {**hold, "active": False}, "late-hold-release", 1
            ).status_code
            == 200
        )
        fresh = write(
            "/copies/preview", {"person_id": first}, "post-hold-preview"
        ).json()
        result = write(
            "/copies/execute",
            {"plan_id": fresh["plan_id"], "fingerprint": fresh["fingerprint"]},
            "erase-first-person",
            fresh["revision"],
        )
        assert result.status_code == 200, result.text
        assert (
            result.json()["preserved_archive_ids"]
            and not result.json()["all_copies_complete"]
        )
        repeated = write(
            "/copies/execute",
            {"plan_id": fresh["plan_id"], "fingerprint": fresh["fingerprint"]},
            "erase-first-person",
            fresh["revision"],
        )
        assert repeated.json() == result.json()
        with pg() as session:
            archives = list(session.scalars(select(PreservedArchive)))
            assert any(
                [p["person_id"] for p in row.payload["retained"]["people"]] == [second]
                for row in archives
            )
            assert all(
                not row.payload["publishable"] and not row.payload["replayable"]
                for row in archives
            )
        review(second, only_archives=True)
        plan = write(
            "/copies/preview", {"person_id": second}, "second-person-preview"
        ).json()
        outcome = write(
            "/copies/execute",
            {"plan_id": plan["plan_id"], "fingerprint": plan["fingerprint"]},
            "erase-second-person",
            plan["revision"],
        )
        assert outcome.status_code == 200, outcome.text
        assert not outcome.json()[
            "all_copies_complete"
        ]  # Current source/control remnants are truthful.
