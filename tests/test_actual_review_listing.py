"""The workflow context says whether a reconciliation note exists for each actual.

`reviewed` is compared with what POST /actual-reviews really did: it becomes true
only for the revision a note was accepted for, stays false after a refused note,
and is false again for the next revision of the same actual. Synthetic data only.
"""

from fastapi.testclient import TestClient
from scripts.remediation_fixture import snapshot

from shift_scheduler.api.main import app
from tests.test_compliance_api import BASE, QUERY, token
from tests.test_compliance_v3_api import prepare


def test_reviewed_follows_the_accepted_reconciliation_notes(sqlite_session_factory):
    prepare(sqlite_session_factory)
    duty = (
        snapshot()
        .candidates[0]
        .model_copy(update={"source": "actual"})
        .model_dump(mode="json")
    )
    with TestClient(app, base_url="https://localhost:8000") as client:
        admin = token(client)

        def record(external_id, revision):
            response = client.post(
                BASE + "/actual-events" + QUERY,
                headers=admin,
                json={
                    "expected_revision": revision - 1,
                    "idempotency_key": f"listing-{external_id}-{revision}",
                    "payload": {
                        "external_id": external_id,
                        "revision": revision,
                        "duty": duty,
                    },
                },
            )
            assert response.status_code == 200, response.text

        def note(external_id, expected, key, reason="独立した勤怠原本と照合"):
            return client.post(
                BASE + "/actual-reviews" + QUERY,
                headers=admin,
                json={
                    "expected_revision": expected,
                    "idempotency_key": key,
                    "payload": {"external_id": external_id, "reason": reason},
                },
            )

        def listed():
            response = client.get(BASE + "/workflow-context" + QUERY, headers=admin)
            assert response.status_code == 200, response.text
            return {
                row["external_id"]: (row["revision"], row["reviewed"])
                for row in response.json()["actuals"]
            }

        record("clock-a", 1)
        record("clock-b", 1)
        assert listed() == {"clock-a": (1, False), "clock-b": (1, False)}

        # A refused note records nothing: a stale revision, then an empty reason.
        assert note("clock-a", 2, "listing-note-stale").status_code == 409
        assert note("clock-a", 1, "listing-note-empty", " ").status_code == 422
        assert listed() == {"clock-a": (1, False), "clock-b": (1, False)}

        accepted = note("clock-a", 1, "listing-note-1")
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["reviewed"] is True
        assert listed() == {"clock-a": (1, True), "clock-b": (1, False)}
        # The same request again is answered from its receipt and changes nothing.
        assert note("clock-a", 1, "listing-note-1").json() == accepted.json()
        assert listed() == {"clock-a": (1, True), "clock-b": (1, False)}

        # The note was for revision 1: the next revision has none until one is accepted.
        record("clock-a", 2)
        assert listed() == {"clock-a": (2, False), "clock-b": (1, False)}
        assert note("clock-a", 1, "listing-note-old").status_code == 409
        assert listed() == {"clock-a": (2, False), "clock-b": (1, False)}
        assert note("clock-a", 2, "listing-note-2").status_code == 200
        assert listed() == {"clock-a": (2, True), "clock-b": (1, False)}
