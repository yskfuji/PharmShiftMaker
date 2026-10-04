import json
from copy import deepcopy

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot
from sqlalchemy import select

from shift_scheduler.api.main import app
from shift_scheduler.db.planning_models import ActualWorkEvent
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def document():
    data = snapshot()
    duty = data.candidates[0].model_copy(update={"source": "actual"})
    terms = next(t for t in data.work_terms if t.duty_id == duty.duty_id)
    return {
        "format": "pharmshift-actuals-v1",
        "events": [
            {
                "external_id": "file-clock",
                "revision": 1,
                "duty": duty.model_dump(mode="json"),
                "work_terms": terms.model_dump(mode="json"),
            }
        ],
    }


def test_preview_is_read_only_and_atomic_import_is_idempotent(sqlite_session_factory):
    prepare(sqlite_session_factory)
    source = json.dumps(document())
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        preview = client.post(
            BASE + "/actual-import/preview" + QUERY,
            headers=admin,
            json={"source_text": source},
        )
        assert preview.status_code == 200, preview.text
        with sqlite_session_factory() as s:
            assert not list(s.scalars(select(ActualWorkEvent)))
        body = {
            "expected_revision": 0,
            "idempotency_key": "same-import-retry",
            "payload": {
                "source_text": source,
                "preview_hash": preview.json()["preview_hash"],
            },
        }
        response = client.post(
            BASE + "/actual-import/commit" + QUERY, headers=admin, json=body
        )
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 1
        assert (
            client.post(
                BASE + "/actual-import/commit" + QUERY, headers=admin, json=body
            ).json()
            == response.json()
        )
        stale = {**body, "idempotency_key": "stale-second-import"}
        assert (
            client.post(
                BASE + "/actual-import/commit" + QUERY, headers=admin, json=stale
            ).status_code
            == 409
        )
        staff = token(client, "pharmacist")
        assert (
            client.post(
                BASE + "/actual-import/preview" + QUERY,
                headers=staff,
                json={"source_text": source},
            ).status_code
            == 403
        )
    with sqlite_session_factory() as s:
        assert len(list(s.scalars(select(ActualWorkEvent)))) == 1


def test_bad_row_rejects_whole_preview_and_changed_source_rejects_commit(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    good = document()
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)
        source = json.dumps(good)
        preview = client.post(
            BASE + "/actual-import/preview" + QUERY,
            headers=admin,
            json={"source_text": source},
        )
        assert preview.status_code == 200
        altered = source + " "
        response = client.post(
            BASE + "/actual-import/commit" + QUERY,
            headers=admin,
            json={
                "expected_revision": 0,
                "idempotency_key": "changed-source-file",
                "payload": {
                    "source_text": altered,
                    "preview_hash": preview.json()["preview_hash"],
                },
            },
        )
        assert response.status_code == 409
        bad = document()
        bad["events"].append({**bad["events"][0], "external_id": "other"})
        assert (
            client.post(
                BASE + "/actual-import/preview" + QUERY,
                headers=admin,
                json={"source_text": json.dumps(bad)},
            ).status_code
            == 422
        )
    with sqlite_session_factory() as s:
        assert not list(s.scalars(select(ActualWorkEvent)))


def test_all_structural_errors_return_row_numbers_without_echoing_private_values(
    sqlite_session_factory,
):
    prepare(sqlite_session_factory)
    doc = document()
    bad = deepcopy(doc["events"][0])
    bad["duty"]["start"] = "private invalid text"
    mismatch = deepcopy(doc["events"][0])
    mismatch["external_id"] = "new"
    mismatch["duty"]["duty_id"] = "another"
    doc["events"] += [
        {"secret": "do not echo"},
        bad,
        mismatch,
        deepcopy(doc["events"][0]),
    ]
    with TestClient(app, base_url="https://localhost:8000") as client:
        response = client.post(
            BASE + "/actual-import/preview" + QUERY,
            headers=token(client),
            json={"source_text": json.dumps(doc)},
        )
        assert response.status_code == 422, response.text
        errors = response.json()["detail"]["row_errors"]
        assert {e["row"] for e in errors} == {2, 3, 4, 5}
        assert {e["code"] for e in errors} == {
            "shape",
            "validation",
            "mapping",
            "duplicate",
        }
        assert (
            "private invalid text" not in response.text
            and "do not echo" not in response.text
        )
    with sqlite_session_factory() as s:
        assert not list(s.scalars(select(ActualWorkEvent)))
