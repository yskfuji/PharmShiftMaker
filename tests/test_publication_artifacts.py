import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.compliance_models import ErasedSubject, ManagedCopy
from shift_scheduler.db.planning_models import AccountMembership
from tests.test_compliance_api import QUERY, token
from tests.test_planning_lifecycle import publish, snapshot


def setup(factory, root, monkeypatch):
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    with factory.begin() as session:
        session.autoflush = True
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
        return publish(session, snapshot(1, 1))


@pytest.mark.parametrize("format", ["json", "csv", "csv-wide"])
def test_registered_bytes_and_external_handoff_are_idempotent(
    sqlite_session_factory, tmp_path, monkeypatch, format
):
    publication = setup(sqlite_session_factory, tmp_path, monkeypatch)
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        url = (
            "/planning/publications/"
            + publication["publication_id"]
            + "/artifacts"
            + QUERY
        )
        body = {
            "expected_revision": 1,
            "idempotency_key": "registered-output",
            "format": format,
        }
        response = client.post(url, headers=auth, json=body)
        assert response.status_code == 200, response.text
        first = response.json()
        again = client.post(url, headers=auth, json=body)
        assert again.status_code == 200, again.text
        artifact = again.json()
        assert first["copy_id"] == artifact["copy_id"]
        changed = {**body, "format": "csv" if format == "json" else "json"}
        assert client.post(url, headers=auth, json=changed).status_code == 409
        url = "/planning/artifacts/" + artifact["copy_id"] + "/download" + QUERY
        body = {
            "expected_revision": artifact["revision"],
            "idempotency_key": "download-request",
            "destination": "synthetic-test-recipient",
        }
        download = client.post(url, headers=auth, json=body)
        assert download.status_code == 200, download.text
        retry = client.post(url, headers=auth, json=body)
        assert retry.content == download.content
        assert retry.headers["X-Transfer-ID"] == download.headers["X-Transfer-ID"]
        assert download.headers["cache-control"] == "no-store"
        assert hashlib.sha256(download.content).hexdigest() == artifact["content_hash"]
        assert (tmp_path / artifact["copy_id"]).read_bytes() == download.content
        assert (
            client.post(url, headers=token(client, "pharmacist"), json=body).status_code
            == 403
        )
    with sqlite_session_factory() as session:
        copies = list(session.scalars(select(ManagedCopy)))
        assert len([c for c in copies if c.medium == "external"]) == 1
        handoff = next(c for c in copies if c.medium == "external")
        assert handoff.locator["confirmation"] == "UNCONFIRMED"


def test_failed_write_remains_reserved_and_tamper_erasure_and_scope_prevent_download(
    sqlite_session_factory, tmp_path, monkeypatch
):
    from shift_scheduler.ops import managed_writer

    publication = setup(sqlite_session_factory, tmp_path, monkeypatch)
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        url = (
            "/planning/publications/"
            + publication["publication_id"]
            + "/artifacts"
            + QUERY
        )
        body = {
            "expected_revision": 1,
            "idempotency_key": "crashed-output",
            "format": "json",
        }
        original = managed_writer.publish_bytes

        def fail(*args):
            raise OSError("synthetic disk full")

        monkeypatch.setattr(managed_writer, "publish_bytes", fail)
        assert client.post(url, headers=auth, json=body).status_code == 503
        with sqlite_session_factory() as session:
            row = session.scalar(
                select(ManagedCopy).where(ManagedCopy.medium == "file")
            )
            identity = row.copy_id
            assert row.state == "RESERVED"
        monkeypatch.setattr(managed_writer, "publish_bytes", original)
        result = client.post(url, headers=auth, json=body)
        assert result.status_code == 200, result.text
        assert result.json()["copy_id"] == identity
        download = "/planning/artifacts/" + identity + "/download" + QUERY
        request = {
            "expected_revision": result.json()["revision"],
            "idempotency_key": "retry-download",
            "destination": "synthetic",
        }
        original_bytes = (tmp_path / identity).read_bytes()
        (tmp_path / identity).write_bytes(b"changed")
        assert client.post(download, headers=auth, json=request).status_code == 409
        (tmp_path / identity).write_bytes(original_bytes)
        assert (
            client.post(
                download.replace("pharmacy", "other"), headers=auth, json=request
            ).status_code
            == 403
        )
        with sqlite_session_factory.begin() as session:
            session.add(
                ErasedSubject(
                    facility_id="hospital",
                    person_id="p0",
                    plan_id="synthetic",
                    evidence={},
                )
            )
        assert client.post(download, headers=auth, json=request).status_code == 409


def test_cli_uses_real_registered_api_and_refuses_overwrite(
    sqlite_session_factory, tmp_path, monkeypatch
):
    from shift_scheduler.ops import exporter

    root = tmp_path / "managed"
    root.mkdir()
    setup(sqlite_session_factory, root, monkeypatch)
    monkeypatch.setattr(
        exporter.httpx,
        "Client",
        lambda **kwargs: TestClient(app, base_url="https://localhost:8000"),
    )
    data = snapshot(1, 1)
    options = exporter.ExportOptions(
        base_url="https://localhost:8000",
        username="admin",
        password="pass-admin",
        year=data.period.start.year,
        month=data.period.start.month,
        output_dir=tmp_path / "client",
    )
    result = exporter.export_schedule(options)
    with sqlite_session_factory() as session:
        transfers = list(
            session.scalars(select(ManagedCopy).where(ManagedCopy.medium == "external"))
        )
        assert len(transfers) == 3
        for row in transfers:
            from pathlib import Path

            assert (
                hashlib.sha256(
                    Path(row.locator["destination"]).read_bytes()
                ).hexdigest()
                == row.content_hash
            )
    assert result.trial_mode is False and result.total_assignments == 1
    # A rerun (e.g. another process after a crash) resends the same keys: completed
    # outputs matching the registered hash are kept and no transfer is added.
    exporter.export_schedule(options)
    with sqlite_session_factory() as session:
        assert (
            len(
                list(
                    session.scalars(
                        select(ManagedCopy).where(ManagedCopy.medium == "external")
                    )
                )
            )
            == 3
        )
    result.json_path.write_bytes(b"changed by someone")
    with pytest.raises(exporter.ExporterError, match="上書き"):
        exporter.export_schedule(options)
    options.generate = True
    with pytest.raises(exporter.ExporterError, match="迂回"):
        exporter.export_schedule(options)


def test_registered_artifact_api_with_real_postgres(pg, tmp_path, monkeypatch):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    test_registered_bytes_and_external_handoff_are_idempotent(
        pg, tmp_path, monkeypatch, "json"
    )
