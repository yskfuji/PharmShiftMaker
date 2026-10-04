from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy
from shift_scheduler.db.planning_models import AccountMembership
from shift_scheduler.domain.planning import content_hash
from tests.test_compliance_api import QUERY, token
from tests.test_planning_lifecycle import publish, snapshot


def test_publication_download_is_registered_before_response(sqlite_session_factory):
    with sqlite_session_factory.begin() as session:
        session.autoflush = (
            True  # lifecycle helper reads new drafts in the same transaction
        )
        for name, role in (("admin", "ADMIN"), ("pharmacist", "PHARMACIST")):
            session.add(
                AccountMembership(
                    membership_id=name,
                    issuer="mock",
                    subject=name,
                    person_id="p0",
                    scope_id="hospital/pharmacy",
                    role=role,
                    active=True,
                )
            )
        result = publish(session, snapshot(1, 1))
    url = "/planning/publications/" + result["publication_id"] + "/export" + QUERY
    with TestClient(app, base_url="https://localhost:8000") as client:
        response = client.get(url, headers=token(client))
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        data = response.json()
        transfer = data.pop("transfer_id")
        with sqlite_session_factory() as session:
            row = session.get(ManagedCopy, transfer)
            assert row.content_hash == content_hash(data)
            assert row.medium == "external" and row.state == "PRESENT"
            assert row.locator["source_publication_id"] == result["publication_id"]
            assert row.locator["recipient"] == "admin"
            assert set(
                session.scalars(
                    select(CopySubject.person_id).where(CopySubject.copy_id == transfer)
                )
            ) == {d["person_id"] for d in data["assignments"]}
        denied = client.get(url, headers=token(client, "pharmacist"))
        assert denied.status_code == 403
        with sqlite_session_factory() as session:
            assert (
                len(
                    list(
                        session.scalars(
                            select(ManagedCopy).where(ManagedCopy.medium == "external")
                        )
                    )
                )
                == 1
            )
