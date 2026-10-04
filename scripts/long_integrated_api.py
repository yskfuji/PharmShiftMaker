"""Actual API diagnostics for the fixed 25-month event protocol.

Uses one isolated PostgreSQL schema and a declared test clock. Unsupported
publication/copy/restore events are retained as gaps; importing accounting
projections cannot certify the complete combined lifecycle.
"""

from contextlib import ExitStack
from datetime import datetime, timedelta
from fractions import Fraction
from unittest.mock import patch
from urllib.parse import quote

from scripts.coupled_acceptance_api import JST, PublicApiProjection
from scripts.long_integrated_scenario import month, stamp
from sqlalchemy import select

from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import ActualWorkEvent
from shift_scheduler.domain.compliance_v3 import SolverSnapshotV3


class Clock(datetime):
    current = datetime(2026, 2, 1, 12, tzinfo=JST)

    @classmethod
    def now(cls, tz=None):
        return cls.current.astimezone(tz) if tz else cls.current.replace(tzinfo=None)


class LongApiDiagnostics:
    def __init__(self, factory, *, allow_owned_database=False, person_prefix=""):
        self.api = PublicApiProjection(
            factory, allow_owned_database=allow_owned_database
        )
        self.factory = factory
        self.stack = ExitStack()
        self.person_prefix = person_prefix
        self.ev = {
            "reference": "synthetic-25-month-fixed-protocol",
            "status": "verified",
            "verified_by": "independent-fixture",
        }
        self.scope = "hospital/a"
        self.query = "?scope_id=hospital%2Fa"
        self.responses = []
        self.mapping = {}
        self.grants = {}
        self.records = {}
        self.base = "/planning/compliance"

    def subjects(self, value):
        if isinstance(value, dict):
            return {k: self.subjects(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.subjects(v) for v in value]
        return (
            self.person_prefix + value
            if isinstance(value, str) and value in ("p0", "p1")
            else value
        )

    def patch_clock(self):
        # Model created_at defaults feed the copy trigger's retention anchor; they
        # must follow the synthetic event time, not the wall clock of the run.
        for name in (
            "shift_scheduler.application.compliance.datetime",
            "shift_scheduler.api.routers.compliance.datetime",
            "shift_scheduler.db.compliance_models.datetime",
            "shift_scheduler.db.planning_models.datetime",
        ):
            self.stack.enter_context(patch(name, Clock))

    def setup(self):
        fixture = self.api.reset("25-month-same-canonical-database")
        if self.person_prefix:
            from shift_scheduler.db.planning_models import AccountMembership

            with self.factory.begin() as session:
                for membership in session.scalars(select(AccountMembership)):
                    membership.person_id = self.person_prefix + "operator"
        self.patch_clock()
        # Replace the initial legacy fixture in scope a with a V3 input. The
        # two legacy test lots are excluded from this V3 accounting projection.
        data = SolverSnapshotV3.model_validate(
            {
                "schema_version": 3,
                "source_revision": 2,
                "facility_id": "hospital",
                "department_id": "a",
                "period": {"start": stamp(month(0)), "end": stamp(month(1))},
                "context": {
                    "start": "2025-01-01T00:00:00+09:00",
                    "end": "2029-01-01T00:00:00+09:00",
                },
                "rule_revision": "synthetic-25-month-v3",
                "policy_evidence": self.ev,
                "history_complete": True,
                "candidate_catalog_complete": True,
                "people": [
                    {"person_id": p, "name": "Synthetic " + p} for p in ("p0", "p1")
                ],
                "employments": [],
                "work_terms": [],
                "contracts": [],
                "capabilities": [],
                "candidates": [],
                "demands": [],
                "lookahead_days": 0,
                "establishments": [
                    {
                        "establishment_id": site,
                        "employer_id": "hospital",
                        "start": "2025-01-01T00:00:00+09:00",
                        "end": "2029-01-01T00:00:00+09:00",
                        "evidence": self.ev,
                    }
                    for site in ("site-a", "site-b")
                ],
                "leave_policies": [
                    {
                        "policy_id": f"policy-{p}-{year}",
                        "person_id": p,
                        "employer_id": "hospital",
                        "start": f"{year}-01-01T00:00:00+09:00",
                        "end": (
                            "2026-10-01T00:00:00+09:00"
                            if year == 2026
                            else f"{year+1}-01-01T00:00:00+09:00"
                        ),
                        "hours_per_day": 4 if year == 2026 else 6,
                        "hourly_enabled": True,
                        "half_day_enabled": True,
                        "hourly_year_start": f"{year}-01-01",
                        "evidence": self.ev,
                    }
                    for p in ("p0", "p1")
                    for year in (2026, 2027, 2028)
                ],
            }
        )
        payload = data.model_dump(mode="json")
        payload["leave_policies"] += [
            dict(
                policy,
                policy_id=policy["policy_id"] + "-converted",
                start="2026-10-01T00:00:00+09:00",
                end="2027-01-01T00:00:00+09:00",
                hours_per_day=6,
            )
            for policy in payload["leave_policies"]
            if policy["policy_id"].endswith("-2026")
        ]
        data = SolverSnapshotV3.model_validate(payload)
        response = self.api.request(
            "/planning/inputs",
            {
                "snapshot": self.subjects(data.model_dump(mode="json")),
                "expected_revision": 1,
            },
        )
        self.require(response)
        return fixture

    def require(self, response):
        self.responses.append({"status": response.status_code, "body": response.json()})
        if response.status_code >= 400:
            raise AssertionError(f"HTTP {response.status_code}: {response.text}")
        return response.json()

    def write(self, path, payload, key, expected=0):
        return self.require(
            self.api.request(
                self.base + path + self.query,
                {
                    "expected_revision": expected,
                    "idempotency_key": key,
                    "payload": self.subjects(payload),
                },
            )
        )

    def revision(self, kind, identity):
        with self.factory() as session:
            row = session.scalar(
                select(ComplianceEntity).where(
                    ComplianceEntity.scope_id == self.scope,
                    ComplianceEntity.kind == kind,
                    ComplianceEntity.entity_id == identity,
                )
            )
            return row.revision if row else 0

    def recording(self, kind, identity, recorded, key):
        self.write(
            "/records/ledger_recording",
            {
                "recording_id": f"{kind}:{identity}",
                "object_kind": kind,
                "object_id": identity,
                "external_event_id": "hr:" + identity,
                "external_revision": 1,
                "recorded_at": recorded,
                "evidence": self.ev,
            },
            key + "-recording",
        )

    def apply(self, event):
        Clock.current = datetime.fromisoformat(event["recorded_at"])
        p = event["person_id"]
        v = event["payload"]
        kind = event["kind"]
        identity = event["event_id"]
        key = f"long-{identity}-{event['revision']}"
        day = event["effective_at"][:10]
        if kind == "contract":
            index = (int(day[:4]) - 2026) * 12 + int(day[5:7]) - 2
            end = stamp(month(index + 1))
            start = event["effective_at"]
            self.write(
                "/records/contract",
                {
                    "revision_id": identity,
                    "relationship_id": "e" + p[1:],
                    "person_id": p,
                    "employer_id": "hospital",
                    "facility_id": "hospital",
                    "department_id": "a",
                    "start": start,
                    "end": end,
                    "period_max_seconds": (
                        datetime.fromisoformat(end) - datetime.fromisoformat(start)
                    ).days
                    * v["scheduled_day_seconds"],
                    "contractual_week_seconds": v["scheduled_days_per_week"]
                    * v["scheduled_day_seconds"],
                    "external_work_confirmed": True,
                    "evidence": self.ev,
                    "regime_evidence": self.ev,
                },
                key + "-contract",
            )
            group = (index // 6) * 6
            agreement_id = (
                f'agreement-{p}-{v["agreement_revision"]}-{v["establishment"]}'
            )
            group_start = max(group, 15) if v["establishment"] == "site-b" else group
            group_end = (
                min(group + 6, 15) if v["establishment"] == "site-a" else group + 6
            )
            self.write(
                "/records/agreement",
                {
                    "agreement_id": agreement_id,
                    "employer_id": "hospital",
                    "establishment_id": v["establishment"],
                    "start": stamp(month(group_start)),
                    "end": stamp(month(group_end)),
                    "year_start": str(month(0)),
                    "month_anchor": str(month(0)),
                    "daily_limit_seconds": 8 * 3600,
                    "monthly_limit_seconds": 45 * 3600,
                    "annual_limit_seconds": 360 * 3600,
                    "holiday_work_permitted": True,
                    "evidence": self.ev,
                },
                "declare-" + agreement_id,
            )
            holidays = [
                (datetime.fromisoformat(start) + timedelta(days=d)).date().isoformat()
                for d in range(
                    (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
                )
                if (datetime.fromisoformat(start) + timedelta(days=d)).weekday() == 6
            ]
            self.write(
                "/records/employment",
                {
                    "revision_id": "employment-" + identity,
                    "relationship_id": "e" + p[1:],
                    "person_id": p,
                    "employer_id": "hospital",
                    "establishment_id": v["establishment"],
                    "contract_order": 1,
                    "start": start,
                    "end": end,
                    "method": (
                        "management" if v["method"] == "management" else "standard"
                    ),
                    "week_start": v["week_start"],
                    "calendar_confirmed": True,
                    "statutory_holidays": holidays,
                    "agreement_id": agreement_id,
                    "declaration": self.ev,
                },
                key + "-employment",
            )
            if index and ((p == "p1" and index == 6) or (p == "p0" and index == 12)):
                self.write(
                    "/records/accounting_transition",
                    {
                        "transition_id": f"transition-{p}-{index}",
                        "before_revision_id": f"employment-contract-{p}-{index-1}",
                        "after_revision_id": "employment-" + identity,
                        "calculation_basis": (
                            "preserve_overlapping_full_weeks"
                            if p == "p1"
                            else "effective_calendar_windows"
                        ),
                        "evidence": self.ev,
                    },
                    key + "-transition",
                )
            if v["method"] == "management":
                self.write(
                    "/records/establishment",
                    {
                        "establishment_id": "outside-site",
                        "employer_id": "outside",
                        "start": stamp(month(12)),
                        "end": stamp(month(25)),
                        "evidence": self.ev,
                    },
                    "management-outside-site",
                )
                self.write(
                    "/records/employment",
                    {
                        "revision_id": "outside-employment-" + identity,
                        "relationship_id": "outside-" + p,
                        "person_id": p,
                        "employer_id": "outside",
                        "establishment_id": "outside-site",
                        "contract_order": 2,
                        "start": start,
                        "end": end,
                        "method": "management",
                        "week_start": 0,
                        "calendar_confirmed": True,
                        "statutory_holidays": holidays,
                        "declaration": self.ev,
                    },
                    key + "-outside-employment",
                )
                self.write(
                    "/records/management_model",
                    {
                        "model_id": "management-" + p,
                        "person_id": p,
                        "first_employer": "hospital",
                        "second_employer": "outside",
                        "start": stamp(month(12)),
                        "end": stamp(month(25)),
                        "month_anchor": str(month(12)),
                        "first_month_limit_seconds": 10 * 3600,
                        "second_month_limit_seconds": 10 * 3600,
                        "first_consent": self.ev,
                        "second_consent": self.ev,
                        "notification": self.ev,
                    },
                    "management-pair-" + p,
                )
        elif kind == "grant":
            # Split installments retain distinct HR original IDs. Aggregation into
            # the oracle lot is explicit and does not mutate the first installment.
            account = identity.removeprefix("grant-")
            self.mapping[account] = v["lot"]
            if event["revision"] == 1:
                value = {
                    "account_id": account,
                    "person_id": p,
                    "employer_id": "hospital",
                    "granted_on": day,
                    "expires_on": v["expires_on"],
                    "statutory_days": v["days"][0],
                    "granted_days": v["days"][0],
                    "grant_cycle_id": v.get("series", v["lot"]),
                    "evidence": self.ev,
                }
                self.write("/records/leave_account", value, key)
                self.grants[account] = value
                self.recording("leave_account", account, event["recorded_at"], key)
                cycle = [a for a, lot in self.mapping.items() if lot == v["lot"]]
                if sum(self.grants[a]["statutory_days"] for a in cycle) >= 10:
                    basis = v["baseline"]
                    year = int(basis[:4])
                    self.write(
                        "/records/leave_obligation",
                        {
                            "obligation_id": "obligation-" + v["lot"],
                            "person_id": p,
                            "employer_id": "hospital",
                            "start": basis,
                            "end": str(year + 1) + basis[4:],
                            "required_half_days": 10,
                            "qualifying_grant_ids": cycle,
                            "method": "split_advance" if len(cycle) > 1 else "separate",
                            "rounding_unit": "half_day",
                            "half_day_request_evidence": self.ev,
                            "evidence": self.ev,
                        },
                        key + "-obligation",
                    )
            else:
                self.write(
                    "/grant-amendments",
                    {
                        "amendment_id": key,
                        "person_id": p,
                        "account_id": account,
                        "external_event_id": "hr:" + account,
                        "external_revision": event["revision"],
                        "supersedes_revision": event["revision"] - 1,
                        "effective_on": day,
                        "recorded_at": event["recorded_at"],
                        "granted_days": v["days"][0],
                        "statutory_days": v["days"][0],
                        "reason": v["reason"],
                        "evidence": self.ev,
                    },
                    key,
                )
                self.grants[account] = {
                    **self.grants[account],
                    "granted_days": v["days"][0],
                }
        elif kind in ("reservation", "leave"):
            accounts = [
                account for account, lot in self.mapping.items() if lot == v["lot"]
            ]
            if not accounts:
                raise AssertionError("Grant must precede reservation")
            # First five-day split installment supplies ten half-days; then use
            # the second source lot. The arithmetic is independent of app totals.
            account = accounts[0]
            counts = sum(
                row["account_id"] == account and row["kind"] == "take"
                for row in self.records.values()
            )
            if len(accounts) > 1 and counts >= 10:
                account = accounts[1]
            effective = v.get("leave_on", day)
            year = effective[:4]
            related = (
                "reserve-" + identity.removeprefix("leave-")
                if kind == "leave"
                else None
            )
            if related in self.records:
                account = self.records[related]["account_id"]
            payload = {
                "event_id": identity,
                "account_id": account,
                "kind": "reserve" if kind == "reservation" else "take",
                "unit": "half_day",
                "quantity": 1,
                "effective_on": effective,
                "interval": {
                    "start": effective + "T09:00:00+09:00",
                    "end": effective + "T11:00:00+09:00",
                },
                "policy_id": f"policy-{p}-{year}"
                + ("-converted" if "2026-10-01" <= effective < "2027-01-01" else ""),
                "evidence": self.ev,
            }
            if related:
                payload["related_event_id"] = related
            self.write(
                "/leave-events", payload, key, self.revision("leave_account", account)
            )
            self.records[identity] = payload
            self.recording("leave_record", identity, event["recorded_at"], key)
        elif kind == "conversion":
            account = next(a for a, lot in self.mapping.items() if lot == v["lot"])
            payload = {
                "event_id": identity,
                "account_id": account,
                "kind": "conversion",
                "unit": "hour",
                "quantity": v["converted_hours"],
                "effective_on": day,
                "policy_id": f"policy-{p}-2026-converted",
                "evidence": self.ev,
                "conversion_old_hours": v["old_hours"],
                "conversion_new_hours": v["new_hours"],
            }
            self.write(
                "/leave-events", payload, key, self.revision("leave_account", account)
            )
            self.records[identity] = payload
            self.recording("leave_record", identity, event["recorded_at"], key)
        elif kind == "hourly_leave":
            account = next(a for a, lot in self.mapping.items() if lot == v["lot"])
            hours = v["hours"][0]
            payload = {
                "event_id": identity,
                "account_id": account,
                "kind": "take",
                "unit": "hour",
                "quantity": hours,
                "effective_on": day,
                "policy_id": f"policy-{p}-{day[:4]}",
                "evidence": self.ev,
                "interval": {
                    "start": day + "T09:00:00+09:00",
                    "end": day + f"T{9+hours:02}:00:00+09:00",
                },
            }
            self.write(
                "/leave-events", payload, key, self.revision("leave_account", account)
            )
            self.records[identity] = payload
            self.recording("leave_record", identity, event["recorded_at"], key)
        elif kind == "work":
            index = (int(day[:4]) - 2026) * 12 + int(day[5:7]) - 2
            payload = {
                "external_id": identity,
                "revision": event["revision"],
                "duty": {
                    "duty_id": identity,
                    "person_id": p,
                    "relationship_id": "e" + p[1:],
                    "kind": "NIGHT",
                    "location": "main",
                    "task": "dispensing",
                    "start": v["start"],
                    "end": v["end"],
                    "work": [{"start": v["start"], "end": v["end"]}],
                    "source": "actual",
                },
                "work_terms": {
                    "duty_id": identity,
                    "employment_revision_id": f"employment-contract-{p}-{index}",
                    "scheduled_work": [
                        {
                            "start": v["start"],
                            "end": (
                                datetime.fromisoformat(v["start"]) + timedelta(hours=4)
                            ).isoformat(),
                        }
                    ],
                },
                "expected_work_terms_revision": self.revision("work_terms", identity),
            }
            self.write("/actual-events", payload, key, event["revision"] - 1)
        else:
            raise NotImplementedError("Combined event adapter missing: " + kind)
        return {
            "accepted": True,
            "committed": True,
            "event": identity,
            "api_calls": len(self.responses),
        }

    def balances(self, effective_at, known_at):
        query = (
            self.query
            + "&effective_at="
            + effective_at[:10]
            + "&known_at="
            + quote(known_at, safe="")
        )
        result = self.require(self.api.request(self.base + "/leave-report" + query))
        lots = {}
        for row in result["balances"]:
            account = row["account_id"]
            lot = self.mapping[account]
            entry = lots.setdefault(
                lot,
                {
                    "remaining": Fraction(0),
                    "reserved": Fraction(0),
                    "unreserved": Fraction(0),
                },
            )
            for key, field in [
                ("remaining", "remaining_days"),
                ("reserved", "reserved_days"),
                ("unreserved", "unreserved_days"),
            ]:
                value = row[field]
                entry[key] += Fraction(value["numerator"], value["denominator"])
        return lots, result

    def work_accounting(self):
        """System-under-test calculation, fed only persisted API records.

        This is not an expected-value generator. Expected seconds come from the
        separate protocol oracle; no work-accounting helper enters that oracle.
        """
        from shift_scheduler.application.compliance import overlay
        from shift_scheduler.db.planning_models import PlanningInput
        from shift_scheduler.domain.compliance import parse_snapshot
        from shift_scheduler.domain.planning import Duty
        from shift_scheduler.validation.work_accounting import account_work

        with self.factory() as session:
            original = session.scalar(
                select(PlanningInput)
                .where(PlanningInput.scope_id == self.scope)
                .order_by(PlanningInput.input_revision.desc())
            )
            latest = {}
            for row in session.scalars(
                select(ActualWorkEvent).where(ActualWorkEvent.scope_id == self.scope)
            ):
                if (
                    row.external_id not in latest
                    or row.revision > latest[row.external_id].revision
                ):
                    latest[row.external_id] = row
            payload = {
                **original.payload,
                "history": [row.payload for row in latest.values()],
            }
            snapshot = parse_snapshot(overlay(session, self.scope, payload))
            result = account_work(
                snapshot, [Duty.model_validate(row.payload) for row in latest.values()]
            )
        result["findings"] = [f.model_dump(mode="json") for f in result["findings"]]
        if self.person_prefix:
            for row in result["trace"]:
                row["person_id"] = row["person_id"].removeprefix(self.person_prefix)
        return result

    def close(self):
        self.stack.close()
        self.api.close()
