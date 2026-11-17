"""Explicit synthetic V3 fixture shared by local UI and API evaluations."""

from tests.test_catalogue_v3 import data

from shift_scheduler.domain.candidate_generation import generate_catalogue
from shift_scheduler.domain.compliance import parse_snapshot


def snapshot(*, with_grant_series=False):
    original = data()
    payload = original.model_dump(mode="json")
    payload["people"].append(
        {"person_id": "p1", "name": "合成職員・長い氏名・薬剤部の画面評価"}
    )
    payload["contracts"].append(
        dict(
            payload["contracts"][0],
            person_id="p1",
            revision_id="c1",
            relationship_id="e1",
        )
    )
    payload["employments"].append(
        dict(
            payload["employments"][0],
            person_id="p1",
            revision_id="emp1",
            relationship_id="e1",
        )
    )
    payload["capabilities"].append(dict(payload["capabilities"][0], person_id="p1"))
    payload["demands"] = [
        d
        for d in payload["demands"]
        if d["start"][:10] not in payload["employments"][0]["statutory_holidays"]
    ]
    for i in range(2):
        payload["leave_accounts"].append(
            {
                "account_id": f"g{i}",
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "granted_on": "2026-01-01",
                "expires_on": "2028-01-01",
                "granted_days": 5,
                "statutory_days": 5,
                "evidence": payload["policy_evidence"],
            }
        )
        payload["leave_policies"].append(
            {
                "policy_id": f"lp{i}",
                "person_id": f"p{i}",
                "employer_id": "hospital",
                "start": "2026-01-01T00:00:00+09:00",
                "end": "2028-01-01T00:00:00+09:00",
                "hours_per_day": 4,
                "hourly_year_start": "2026-01-01",
                "evidence": payload["policy_evidence"],
            }
        )
        payload["ledger_recordings"].append(
            {
                "recording_id": f"hr-g{i}",
                "object_kind": "leave_account",
                "object_id": f"g{i}",
                "external_event_id": f"hr:g{i}",
                "external_revision": 1,
                "recorded_at": "2026-01-01T00:00:00+09:00",
                "evidence": payload["policy_evidence"],
            }
        )
    if with_grant_series:
        # A separate base date from p0's regular grant g0 (2026-01-01): two
        # independent statutory grants on one date are flagged as a duplicate.
        for account_id, days in (("split-first", 3), ("split-second", 4)):
            payload["leave_accounts"].append(
                {
                    "account_id": account_id,
                    "person_id": "p0",
                    "employer_id": "hospital",
                    "granted_on": "2026-01-02",
                    "expires_on": "2028-01-02",
                    "statutory_days": days,
                    "granted_days": days,
                    "grant_cycle_id": "split-series",
                    "evidence": payload["policy_evidence"],
                }
            )
            payload["ledger_recordings"].append(
                {
                    "recording_id": "hr-" + account_id,
                    "object_kind": "leave_account",
                    "object_id": account_id,
                    "external_event_id": "hr:" + account_id,
                    "external_revision": 1,
                    "recorded_at": "2026-01-02T00:00:00+09:00",
                    "evidence": payload["policy_evidence"],
                }
            )
    generated = generate_catalogue(parse_snapshot(payload))
    payload.update(
        candidates=generated["candidates"], work_terms=generated["work_terms"]
    )
    return parse_snapshot(payload)
