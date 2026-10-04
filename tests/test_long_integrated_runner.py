"""Harness safety tests with explicit fake transport; not PostgreSQL evidence."""

import json

from scripts.long_integrated_runner import digest, journal, run


def protocol():
    events = [
        {
            "event_id": str(i),
            "kind": "work",
            "revision": 1,
            "recorded_at": f"2026-02-0{i+1}T12:00:00+09:00",
        }
        for i in range(2)
    ]
    return {
        "events": events,
        "months": 1,
        "end_exclusive": "2026-03-01",
        "monthly_expected": [
            {
                "month": "2026-02",
                "clock": "2026-02-28T23:59:59+09:00",
                "as_known": {"total": 2},
                "restated": {"total": 2},
            }
        ],
    }


class Fake:
    def __init__(self):
        self.receipts = {}
        self.fail_once = True
        self.calls = 0

    def attach(self):
        return {
            "backend": "postgresql",
            "database_instance_id": "unit-test-fake-not-acceptance",
        }

    def advance_clock(self, t):
        pass

    def lookup(self, key):
        return self.receipts.get(key)

    def apply(self, event, key):
        self.calls += 1
        value = {
            "accepted": True,
            "committed": True,
            "public_api_evidence": {"fake": True},
            "event_digest": digest(event),
        }
        self.receipts[key] = value
        if self.fail_once:
            self.fail_once = False
            raise ConnectionError("lost response after commit")
        return value

    def observe(self, *a):
        return {"total": 2}


def test_response_loss_resume_and_no_first_failure_replacement(tmp_path):
    p = protocol()
    path = tmp_path / "journal.sqlite"
    adapter = Fake()
    with journal(path, p) as db:
        first = run(db, adapter)
        assert first["attempt_statuses"] == {"FAILED": 1}
        assert not first["25_month_event_acceptance_complete"]
    with journal(path, p, resume=True) as db:
        second = run(db, adapter)
        assert second["25_month_event_acceptance_complete"]
        assert second["attempt_statuses"] == {"FAILED": 1, "PASSED": 2}
        assert adapter.calls == 2
        recovered = json.loads(
            db.execute("SELECT evidence FROM attempts WHERE id=2").fetchone()[0]
        )
        assert recovered["recovered"]


def test_missing_adapter_stays_pending_and_cannot_pass(tmp_path):
    class Missing(Fake):
        def apply(self, event, key):
            raise NotImplementedError("contract adapter missing")

    with journal(tmp_path / "journal.sqlite", protocol()) as db:
        result = run(db, Missing())
        assert result["event_states"] == {"PENDING": 2}
        assert result["attempt_statuses"] == {"BLOCKED": 1}
        assert result["monthly_checks_passed"] == {"AS_KNOWN": 0, "RESTATED": 0}
