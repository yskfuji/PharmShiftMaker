"""Public workflow adapter for the same fixed 25-month accounting subjects.

Publication, amendment and hold are real API operations; omitted erasure and
physical-restore operations remain explicit rather than being simulated.
"""

import json
from copy import deepcopy
from datetime import datetime
from hashlib import sha256

from scripts.long_integrated_api import Clock, LongApiDiagnostics
from scripts.long_integrated_scenario import month, project, scenario, stamp
from sqlalchemy import select

from shift_scheduler.db.planning_models import (
    ActualWorkEvent,
    PlanningPublication,
)


class LongWorkflowDiagnostics(LongApiDiagnostics):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.links = {}
        self.publications = []
        self.counterexamples = []
        self.holds = {}
        self.burden_checks = []
        self.applied_events = []

    def write(self, path, payload, key, expected=0):
        payload = deepcopy(payload)
        if path == "/records/contract":
            # The fixed synthetic scenario expressly includes NIGHT duties.
            # State their permission rather than relying on the DAY-only default.
            payload["allowed_kinds"] = ["DAY", "NIGHT"]
        if path == "/actual-events" and payload["external_id"] in self.links:
            publication, planned = self.links[payload["external_id"]]
            payload["work_terms"].update(
                planned_duty_id=planned, planned_publication_id=publication
            )
        return super().write(path, payload, key, expected)

    def apply(self, event):
        Clock.current = datetime.fromisoformat(event["recorded_at"])
        if event["kind"] == "publication":
            before = self.publication_count()
            # Fixed counterexample: the last month's retroactive grant reduction
            # produces a deficit independently of the API validator. Do not turn
            # arbitrary review/input failures into acceptable publication stops.
            expected_stop = event["event_id"] == "publication-24"
            if expected_stop:
                oracle = project(scenario(), event["recorded_at"], event["recorded_at"])
                assert any(
                    lot["lot"] == "p0-2026" and lot["unreserved"]["numerator"] < 0
                    for lot in oracle["lots"]
                )
            try:
                result = self.publish_month(event)
            except AssertionError as error:
                if (
                    not expected_stop
                    or "HTTP 422:" not in str(error)
                    or "Leave ledger did not reconcile" not in str(error)
                ):
                    raise
                result = {
                    "event_id": event["event_id"],
                    "accepted": False,
                    "expected_stop": "retroactive-grant-deficit",
                    "http_status": 422,
                    "message": str(error),
                }
                self.publications.append(result)
            assert result["accepted"] is (not expected_stop), result
            if expected_stop:
                assert self.publication_count() == before
            self.applied_events.append(event)
            return result
        if event["kind"] == "erasure_attempt":
            # Exercise the actual person-control entrypoint with a current
            # approved case. A missing case/auth/policy rejection is not proof
            # that preservation prevented this operation.
            person = self.person_prefix + event["person_id"]
            key = event["event_id"]
            case = self.require(
                self.api.request(
                    self.base + "/privacy/requests" + self.query,
                    {
                        "expected_revision": 0,
                        "idempotency_key": key + "-request",
                        "payload": {
                            "person_id": person,
                            "kind": "erase",
                            "reason": "Synthetic fixed preservation counterexample",
                        },
                    },
                )
            )
            for revision, status in ((1, "VERIFIED"), (2, "APPROVED")):
                case = self.require(
                    self.api.request(
                        self.base + "/privacy/cases/" + case["case_id"] + self.query,
                        {
                            "expected_revision": revision,
                            "idempotency_key": key + "-" + status,
                            "payload": {
                                "status": status,
                                "reason": "Synthetic independently specified identity and decision",
                                "identity_evidence": self.ev,
                            },
                        },
                    )
                )
            inventory = self.require(
                self.api.request(
                    self.base + "/copies" + self.query + "&person_id=" + person
                )
            )
            assert inventory["targets"] and all(
                "legal_hold" in t["blockers"] for t in inventory["targets"]
            )
            from scripts.long_integrated_restore import content

            from shift_scheduler.db.compliance_models import ErasedSubject

            before = content(self.factory)
            reply = self.api.request(
                self.base + "/subject-controls/" + person + self.query,
                {
                    "expected_revision": 0,
                    "idempotency_key": key + "-control",
                    "case_id": case["case_id"],
                    "case_revision": 3,
                    "reason": "Synthetic person erasure under active preservation",
                },
            )
            assert reply.status_code == 409, reply.text
            assert content(self.factory) == before
            with self.factory() as session:
                assert session.get(ErasedSubject, ("hospital", person)) is None
            result = {
                "event_id": key,
                "accepted": False,
                "http_status": 409,
                "approved_case_revision": 3,
                "active_hold_confirmed": True,
                "canonical_unchanged": True,
                "person_control_created": False,
            }
            self.counterexamples.append(result)
            self.applied_events.append(event)
            return result
        if event["kind"] == "hold":
            p = event["person_id"]
            identity = "long-hold-" + p
            active = event["payload"]["active"]
            preview = None
            if active:
                preview = self.require(
                    self.api.request(
                        self.base + "/copies/preview" + self.query,
                        {
                            "expected_revision": 0,
                            "idempotency_key": event["event_id"] + "-before-hold",
                            "payload": {"person_id": self.person_prefix + p},
                        },
                    )
                )
            result = self.require(
                self.api.request(
                    self.base + "/holds" + self.query,
                    {
                        "expected_revision": self.holds.get(p, 0),
                        "idempotency_key": event["event_id"] + "-workflow",
                        "payload": {
                            "hold_id": identity,
                            "person_id": self.person_prefix + p,
                            "active": active,
                            "reason": "Synthetic reviewed preservation",
                        },
                    },
                )
            )
            self.holds[p] = self.holds.get(p, 0) + 1
            if preview:
                from scripts.long_integrated_restore import content

                before = content(self.factory)
                refused = self.api.request(
                    self.base + "/copies/execute" + self.query,
                    {
                        "expected_revision": preview["revision"],
                        "idempotency_key": event["event_id"] + "-stale-plan",
                        "payload": {
                            "plan_id": preview["plan_id"],
                            "fingerprint": preview["fingerprint"],
                        },
                    },
                )
                assert refused.status_code == 409, refused.text
                assert content(self.factory) == before
                self.counterexamples.append(
                    {
                        "event_id": event["event_id"],
                        "late_hold_erase_status": 409,
                        "canonical_unchanged": True,
                    }
                )
            self.applied_events.append(event)
            return result
        result = super().apply(event)
        self.applied_events.append(event)
        return result

    def publish_month(self, event):
        target = event["payload"]["month"]
        index = (int(target[:4]) - 2026) * 12 + int(target[5:]) - 2
        current = self.require(self.api.request("/planning/inputs/latest" + self.query))
        self.require(
            self.api.request(
                "/planning/inputs/refresh" + self.query,
                {
                    "expected_revision": current["input_revision"],
                    "input_hash": current["input_hash"],
                },
            )
        )
        current = self.require(self.api.request("/planning/inputs/latest" + self.query))
        payload = deepcopy(current["snapshot"])
        payload.update(
            period={"start": stamp(month(index)), "end": stamp(month(index + 1))},
            source_revision=current["input_revision"] + 1,
            candidates=[],
            previous_duty_ids=[],
            replaces_publication_id=None,
            reservation_credits=[],
            demands=[],
        )
        payload["capabilities"] = [
            {
                "person_id": self.person_prefix + p,
                "task": "dispensing",
                "location": "main",
                "start": "2025-01-01T00:00:00+09:00",
                "end": "2029-01-01T00:00:00+09:00",
                "evidence": self.ev,
            }
            for p in ("p0", "p1")
        ]
        payload["catalogue_evidence"] = self.ev
        payload["fairness_history_evidence"] = self.ev
        payload["rule_reviews"] = [
            {
                "review_id": "long-workflow-rule-review",
                "rule_id": payload["rule_revision"],
                "start": "2025-01-01T00:00:00+09:00",
                "end": "2029-01-01T00:00:00+09:00",
                "source_url": "https://www.mhlw.go.jp/web/t_doc?dataId=73022000",
                "provision": "synthetic fixture general-regime review",
                "transitional_provision": "synthetic fixture no exception",
                "reviewed_on": "2025-01-01",
                "next_review_on": "2029-01-01",
                "evidence": self.ev,
            }
        ]
        actual = {d["duty_id"] for d in payload["history"] if d["source"] == "actual"}
        terms = {v["duty_id"]: v for v in payload["work_terms"]}
        for work in scenario():
            if (
                work["kind"] != "work"
                or work["revision"] != 1
                or work["effective_at"][:7] != target
                or work["event_id"] in actual
            ):
                continue
            p = work["person_id"]
            v = work["payload"]
            identity = work["event_id"]
            payload["candidates"].append(
                {
                    "duty_id": identity,
                    "person_id": self.person_prefix + p,
                    "relationship_id": "e" + p[1:],
                    "kind": "NIGHT",
                    "task": "dispensing",
                    "location": "main",
                    "start": v["start"],
                    "end": v["end"],
                    "work": [{"start": v["start"], "end": v["end"]}],
                }
            )
            terms[identity] = {
                "duty_id": identity,
                "employment_revision_id": f"employment-contract-{p}-{index}",
                "scheduled_work": [{"start": v["start"], "end": v["end"]}],
            }
        dates = sorted({d["start"][:10] for d in payload["candidates"]})
        payload["duty_templates"] = [
            {
                "template_id": "long-approved-night",
                "kind": "NIGHT",
                "task": "dispensing",
                "location": "main",
                "dates": dates,
                "start_second": 20 * 3600,
                "duration_seconds": 4 * 3600,
                "work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
                "scheduled_work": [{"start_seconds": 0, "end_seconds": 4 * 3600}],
            }
        ]
        payload["work_terms"] = [
            t
            for identity, t in terms.items()
            if identity
            in {d["duty_id"] for d in payload["history"] + payload["candidates"]}
        ]
        # Candidate generation is the system input builder, never the independent
        # accounting/assignment oracle below. Freeze expected people/dates separately.
        from shift_scheduler.domain.candidate_generation import generate_catalogue
        from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3

        catalog = generate_catalogue(SolverSnapshotV3.model_validate(payload))
        payload["candidates"] = catalog["candidates"]
        history_ids = {d["duty_id"] for d in payload["history"]}
        payload["work_terms"] = [
            t for t in payload["work_terms"] if t["duty_id"] in history_ids
        ] + catalog["work_terms"]
        registered = self.require(
            self.api.request(
                "/planning/inputs",
                {"snapshot": payload, "expected_revision": current["input_revision"]},
            )
        )
        self.require(
            self.api.request(
                "/planning/inputs/refresh" + self.query,
                {
                    "expected_revision": registered["input_revision"],
                    "input_hash": registered["input_hash"],
                },
            )
        )
        current = self.require(self.api.request("/planning/inputs/latest" + self.query))
        snapshot = current["snapshot"]
        # Several events share the declared timestamp. Only the committed prefix
        # has happened at this API boundary; future same-time events cannot leak
        # into the independent expected value.
        expected_work = project(
            self.applied_events, snapshot["period"]["start"], event["recorded_at"]
        )["work"]
        for burden in snapshot["burden_history"]:
            person = burden["person_id"].removeprefix(self.person_prefix)
            period = burden["period_start"][:7]
            reference = next(
                r
                for r in expected_work
                if r["person"] == person and r["month"] == period
            )
            expected_seconds = reference[
                "night_seconds" if burden["kind"] == "night" else "holiday_seconds"
            ]
            # Fixed scenario has exactly two approved four-hour duties/person,
            # 22:00--24:00 night exposure each, one Sunday 20:00--24:00 exposure.
            # Late actual +1 hour changes burden, never approved opportunity.
            assert burden["seconds"] == expected_seconds, (target, burden, reference)
            assert burden["eligible_seconds"] == 4 * 3600, (target, burden)
            self.burden_checks.append(
                {
                    "publication_event": event["event_id"],
                    "person": person,
                    "period": period,
                    "kind": burden["kind"],
                    "expected_seconds": expected_seconds,
                    "expected_opportunity_seconds": 4 * 3600,
                    "observed": burden,
                    "status": "PASSED",
                }
            )
        if event["payload"]["version"] == 1:
            expected = {
                (
                    self.person_prefix + e["person_id"],
                    e["payload"]["start"],
                    e["payload"]["end"],
                )
                for e in scenario()
                if e["kind"] == "work"
                and e["revision"] == 1
                and e["effective_at"][:7] == target
            }
            actual = {
                (d["person_id"], d["start"], d["end"]) for d in snapshot["candidates"]
            }
            assert actual == expected, (
                "Approved candidate enumeration differs from independent calendar",
                actual,
                expected,
            )
        key = event["event_id"] + "-workflow"
        draft = self.require(
            self.api.request(
                "/planning/drafts" + self.query,
                {
                    "input_hash": current["input_hash"],
                    "proposal": {
                        "duty_ids": [d["duty_id"] for d in snapshot["candidates"]],
                        "leave_ids": [],
                    },
                    "idempotency_key": key + "-draft",
                },
            )
        )
        review = self.require(
            self.api.request(
                f"/planning/drafts/{draft['draft_id']}/review" + self.query,
                {"version": 1, "idempotency_key": key + "-review"},
            )
        )
        if not review["publishable"]:
            self.publications.append(
                {"event_id": event["event_id"], "accepted": False, "review": review}
            )
            return self.publications[-1]
        path = f"/planning/drafts/{draft['draft_id']}/publish" + self.query
        body = {
            "version": 1,
            "expected_publication_version": event["payload"]["version"] - 1,
            "input_hash": current["input_hash"],
            "review_hash": review["review_hash"],
            "idempotency_key": key + "-publish",
        }
        stale = self.api.request(
            path,
            {
                **body,
                "review_hash": "stale-approval",
                "idempotency_key": key + "-stale",
            },
        )
        assert stale.status_code == 409, stale.text
        before = self.publication_count()
        reply = self.require(self.api.request(path, body))
        repeated = self.require(self.api.request(path, body))
        assert repeated == reply and self.publication_count() == before + 1
        with self.factory() as session:
            saved = session.get(PlanningPublication, reply["publication_id"])
            expected = {
                (
                    self.person_prefix + e["person_id"],
                    e["payload"]["start"],
                    e["payload"]["end"],
                )
                for e in scenario()
                if e["kind"] == "work"
                and e["revision"] == 1
                and e["effective_at"][:7] == target
            }
            assert {
                (d["person_id"], d["start"], d["end"])
                for d in saved.payload["assignments"]
            } == expected
            if event["payload"]["version"] > 1:
                original = session.get(PlanningPublication, saved.payload["replaces"])
                assert (
                    saved.payload["assignments"] == original.payload["assignments"]
                ), "Re-publication lost or rewrote immutable planned shifts"
                carried = saved.payload.get("carried_assignments", [])
                assert len(carried) == 4
                for link in carried:
                    assert link["source_publication_id"] == original.publication_id
                    actual = session.scalar(
                        select(ActualWorkEvent)
                        .where(
                            ActualWorkEvent.scope_id == self.scope,
                            ActualWorkEvent.external_id == link["actual_duty_id"],
                        )
                        .order_by(ActualWorkEvent.revision.desc())
                    )
                    assert actual is not None
                    assert (
                        link["actual_hash"]
                        == sha256(
                            json.dumps(
                                actual.payload,
                                sort_keys=True,
                                separators=(",", ":"),
                                ensure_ascii=False,
                            ).encode()
                        ).hexdigest()
                    )
                    if actual.external_id == "work-p0-6-night":
                        assert actual.revision == 2
                self.counterexamples.append(
                    {
                        "event_id": event["event_id"],
                        "original_assignments_retained": 4,
                        "actual_lineages_verified": 4,
                        "late_revision": 2,
                    }
                )
        for work in scenario():
            if (
                work["kind"] != "work"
                or work["revision"] != 1
                or work["effective_at"][:7] != target
            ):
                continue
            matches = [
                d
                for d in snapshot["candidates"]
                if d["person_id"] == self.person_prefix + work["person_id"]
                and d["start"] == work["payload"]["start"]
            ]
            if matches:
                self.links[work["event_id"]] = (
                    reply["publication_id"],
                    matches[0]["duty_id"],
                )
        self.counterexamples.append(
            {
                "event_id": event["event_id"],
                "stale_approval": stale.status_code,
                "repeat_equal": True,
                "publication_delta": 1,
            }
        )
        self.publications.append(
            {
                "event_id": event["event_id"],
                "accepted": True,
                "response": reply,
                "assigned_duties": [d["duty_id"] for d in snapshot["candidates"]],
            }
        )
        return self.publications[-1]

    def publication_count(self):
        with self.factory() as session:
            return len(
                list(
                    session.scalars(
                        select(PlanningPublication).where(
                            PlanningPublication.scope_id == self.scope
                        )
                    )
                )
            )
