"""Runner + public API + worker, with receipt loss before input replacement."""

from fastapi.testclient import TestClient
from scripts.benchmark_journal import Journal
from scripts.benchmark_runner import measure_case
from sqlalchemy import func, select

from shift_scheduler.api.main import app
from shift_scheduler.application.worker import run_once
from shift_scheduler.db.planning_models import AccountMembership, PlanningJob
from tests.test_compliance_api import token
from tests.test_reviewed_planning import snapshot


def test_lost_receipt_then_new_input_resumes_real_job_on_postgres(
    pg, monkeypatch, tmp_path
):
    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "_SessionFactory", pg)
    monkeypatch.setattr(database, "_ENGINE", pg.kw["bind"])
    with pg.begin() as session:
        session.add(
            AccountMembership(
                membership_id="admin",
                issuer="mock",
                subject="admin",
                person_id="p0",
                scope_id="hospital/pharmacy",
                role="ADMIN",
                active=True,
            )
        )
    data = snapshot()
    with TestClient(app, base_url="https://localhost:8000") as client:
        auth = token(client)
        paths = []

        def request(path, body=None):
            paths.append((path, body is not None))
            reply = (
                client.post(path, headers=auth, json=body)
                if body is not None
                else client.get(path, headers=auth)
            )
            if reply.status_code >= 400:
                raise ValueError(str(reply.status_code) + ": " + reply.text)
            return reply.json()

        def interrupted(path, body=None):
            reply = request(path, body)
            if path.startswith("/planning/jobs?"):
                raise ConnectionError("Injected response loss after public API commit")
            return reply

        j = Journal(tmp_path / "run.sqlite", {"frozen": "synthetic"})
        first = j.start("case", {"case": 0})
        failure, revision = measure_case(
            interrupted,
            data,
            revision=0,
            budget=20,
            request_key="runner-recovery-key",
            require_commit_telemetry=True,
            journal=j,
            case_key="case",
        )
        assert (
            not failure["success"] and failure["phase"] == "job_acceptance"
        ), failure.get("error")
        j.finish(first, "case", failure)
        j.close()
        assert run_once(pg)
        other = data.model_copy(update={"source_revision": data.source_revision + 1})
        moved = request(
            "/planning/inputs",
            {"snapshot": other.model_dump(mode="json"), "expected_revision": revision},
        )
        assert moved["input_revision"] == 2
        j = Journal(tmp_path / "run.sqlite", {"frozen": "synthetic"}, resume=True)
        second = j.start("case", {"case": 0})
        paths.clear()
        recovered, _ = measure_case(
            request,
            data,
            revision=2,
            budget=20,
            request_key="runner-recovery-key",
            require_commit_telemetry=True,
            journal=j,
            case_key="case",
        )
        j.finish(second, "case", recovered)
        assert recovered.get("functional_success"), recovered
        assert (
            not recovered["success"]
            and recovered["observed_end_to_end_seconds"] is None
        )
        assert all(not write for _, write in paths)
        assert "by-key" in paths[0][0]
        assert j.case_state("case")["phase"] == "OBSERVED"
        assert j.db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4
        assert (
            j.db.execute(
                "SELECT COUNT(*) FROM events WHERE kind='RESULT' AND payload LIKE '%ConnectionError%'"
            ).fetchone()[0]
            == 1
        )
        j.close()
    with pg() as session:
        assert session.scalar(select(func.count()).select_from(PlanningJob)) == 1
