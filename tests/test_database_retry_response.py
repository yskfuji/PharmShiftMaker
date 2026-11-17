import sqlite3

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from shift_scheduler.api.main import app
from tests.test_actual_file_import import document
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def test_busy_preview_is_explicit_and_same_original_can_be_retried(
    sqlite_session_factory, monkeypatch
):
    import json

    from shift_scheduler.application import actual_file

    prepare(sqlite_session_factory)
    original = actual_file.inspect_actual_file

    def busy(*args):
        cause = sqlite3.OperationalError("synthetic sensitive details")
        cause.sqlite_errorcode = sqlite3.SQLITE_BUSY
        raise OperationalError("synthetic SQL", {"secret": "must-not-leak"}, cause)

    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        headers = {**admin, "Origin": "https://localhost:3000"}
        monkeypatch.setattr(actual_file, "inspect_actual_file", busy)
        body = {"source_text": json.dumps(document())}
        response = client.post(
            BASE + "/actual-import/preview" + QUERY, headers=headers, json=body
        )
        assert response.status_code == 503, response.text
        assert response.headers["retry-after"] == "1"
        assert (
            response.headers["access-control-allow-origin"] == "https://localhost:3000"
        )
        assert response.json()["code"] == "database_retryable"
        assert "sensitive" not in response.text and "must-not-leak" not in response.text
        monkeypatch.setattr(actual_file, "inspect_actual_file", original)
        assert (
            client.post(
                BASE + "/actual-import/preview" + QUERY, headers=headers, json=body
            ).status_code
            == 200
        )
