"""Fixed 25-month event protocol and independent integer/Fraction projection.

No scheduler/accounting functions are imported. This oracle covers event balance,
record/effective time, work intervals and burden; legal applicability decisions
remain separate acceptance assertions, never inferred from these totals.
"""

import argparse
import hashlib
import json
from datetime import date, datetime, timedelta
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")
START = (2026, 2)
COPY_TYPES = (
    "planning",
    "contract",
    "regime",
    "leave",
    "actual",
    "compliance",
    "privacy",
    "audit",
    "notification",
    "exports",
    "temporary",
    "backup",
    "control",
)


def month(index):
    year, m = divmod(START[0] * 12 + START[1] - 1 + index, 12)
    return date(year, m + 1, 1)


def stamp(day, hour=0):
    return datetime(day.year, day.month, day.day, hour, tzinfo=JST).isoformat()


def first_weekday(day, weekday):
    return day + timedelta(days=(weekday - day.weekday()) % 7)


def scenario():
    events = []

    def add(
        identity,
        kind,
        person,
        on,
        payload,
        *,
        recorded=None,
        revision=1,
        recorded_hour=12,
    ):
        events.append(
            {
                "event_id": identity,
                "kind": kind,
                "person_id": person,
                "effective_at": stamp(on),
                "recorded_at": stamp(recorded or on, recorded_hour),
                "revision": revision,
                "payload": payload,
            }
        )

    for i in range(25):
        begin = month(i)
        for p in ("p0", "p1"):
            add(
                f"contract-{p}-{i}",
                "contract",
                p,
                begin,
                {
                    "employer": "hospital",
                    "establishment": "site-b" if i >= 15 else "site-a",
                    "week_start": 2 if p == "p1" and i >= 6 else 0,
                    "scheduled_days_per_week": 5,
                    "scheduled_day_seconds": 6 * 3600 if i >= 8 else 4 * 3600,
                    "method": "management" if p == "p0" and i >= 12 else "principle",
                    "agreement_revision": 1 + i // 6,
                },
            )
            if i == 0:
                add(
                    f"grant-{p}-2026",
                    "grant",
                    p,
                    begin,
                    {
                        "lot": f"{p}-2026",
                        "days": [10, 1],
                        "expires_on": "2028-02-01",
                        "baseline": str(begin),
                    },
                )
            if i == 11:
                add(
                    f"grant-{p}-2027-a",
                    "grant",
                    p,
                    begin,
                    {
                        "lot": f"{p}-2027",
                        "days": [5, 1],
                        "expires_on": "2029-02-01",
                        "baseline": "2027-02-01",
                        "series": "split-2027",
                    },
                )
            if i == 12:
                add(
                    f"grant-{p}-2027-b",
                    "grant",
                    p,
                    begin,
                    {
                        "lot": f"{p}-2027",
                        "days": [5, 1],
                        "expires_on": "2029-02-01",
                        "baseline": "2027-02-01",
                        "series": "split-2027",
                    },
                )
            for suffix, weekday in [("night", 1), ("holiday", 6)]:
                day = first_weekday(begin, weekday)
                start = datetime.fromisoformat(stamp(day, 20))
                end = start + timedelta(hours=4)
                add(
                    f"work-{p}-{i}-{suffix}",
                    "work",
                    p,
                    day,
                    {
                        "start": start.isoformat(),
                        "end": end.isoformat(),
                        "holiday": weekday == 6,
                        "source": "actual",
                    },
                )
            leave_day = first_weekday(begin + timedelta(days=14), 0)
            add(
                f"leave-{p}-{i}",
                "leave",
                p,
                leave_day,
                {
                    "lot": f"{p}-{2026 if i<12 else 2027}",
                    "unit": "half",
                    "days": [1, 2],
                },
            )
            add(
                f"reserve-{p}-{i}",
                "reservation",
                p,
                begin,
                {
                    "lot": f"{p}-{2026 if i<12 else 2027}",
                    "days": [1, 2],
                    "linked_actual": f"leave-{p}-{i}",
                    "leave_on": str(leave_day),
                },
            )
        add(
            f"publication-{i}",
            "publication",
            None,
            begin,
            {"month": str(begin)[:7], "version": 1, "persons": ["p0", "p1"]},
        )
        if i == 8:
            for person, quantity in (("p0", 5), ("p1", 0)):
                add(
                    "conversion-" + person,
                    "conversion",
                    person,
                    begin,
                    {
                        "lot": person + "-2026",
                        "old_hours": 4,
                        "new_hours": 6,
                        "converted_hours": quantity,
                    },
                )
        if i == 6:
            add(
                "hour-leave-p0",
                "hourly_leave",
                "p0",
                begin + timedelta(days=10),
                {
                    "lot": "p0-2026",
                    "hours": [1, 1],
                    "one_day_hours": 4,
                    "annual_five_day_credit": [0, 1],
                },
            )
        if i == 12:
            original = first_weekday(month(6), 1)
            start = datetime.fromisoformat(stamp(original, 20))
            add(
                "work-p0-6-night",
                "work",
                "p0",
                original,
                {
                    "start": start.isoformat(),
                    "end": (start + timedelta(hours=5)).isoformat(),
                    "holiday": False,
                    "source": "late_actual_correction",
                },
                recorded=begin,
                revision=2,
            )
            add(
                "publication-6-revised",
                "publication",
                None,
                begin,
                {"month": str(month(6))[:7], "version": 2, "reason": "late_actual"},
                recorded_hour=13,
            )
        if i in (3, 18):
            add(
                f"backup-{i}",
                "backup",
                None,
                begin,
                {
                    "version": 1 if i == 3 else 2,
                    "expires_on": "2028-02-27",
                    "persons": ["p0", "p1"],
                },
            )
    last = month(24)
    add(
        "grant-p0-2026",
        "grant",
        "p0",
        month(0),
        {
            "lot": "p0-2026",
            "days": [4, 1],
            "expires_on": "2028-02-01",
            "baseline": str(month(0)),
            "reason": "external HR reduction after expiry",
        },
        recorded=last,
        revision=2,
    )
    for offset, p in ((22, "p0"), (23, "p1")):
        add(
            "hold-" + p,
            "hold",
            p,
            last + timedelta(days=offset - 2),
            {"active": True, "reason": "synthetic reviewed preservation"},
        )
        add(
            "blocked-erasure-" + p,
            "erasure_attempt",
            p,
            last + timedelta(days=offset - 1),
            {"expected": "active_hold_block", "types": COPY_TYPES},
        )
        add("release-" + p, "hold", p, last + timedelta(days=offset), {"active": False})
        add(
            "erase-" + p,
            "erasure",
            p,
            last + timedelta(days=offset),
            {
                "types": COPY_TYPES,
                "copy_versions": [1, 2],
                "control_residual": True,
                "backup_residual": True,
            },
            recorded_hour=13,
        )
    add(
        "backup-expiry",
        "backup_expiry",
        None,
        last + timedelta(days=26),
        {"versions": [1, 2]},
    )
    add(
        "full-restore",
        "restore",
        None,
        last + timedelta(days=25),
        {
            "source_backup_version": 1,
            "latest_controls_required": True,
            "quarantine_before_extract": True,
        },
    )
    return sorted(
        events, key=lambda e: (e["recorded_at"], e["event_id"], e["revision"])
    )


def seconds(start, end):
    return int((end - start).total_seconds())


def night_seconds(start, end):
    total = 0
    day = start.date() - timedelta(days=1)
    while day <= end.date():
        a = datetime.fromisoformat(stamp(day, 22))
        b = a + timedelta(hours=7)
        left = max(start, a)
        right = min(end, b)
        if right > left:
            total += seconds(left, right)
        day += timedelta(days=1)
    return total


def rational(value):
    return {"numerator": value.numerator, "denominator": value.denominator}


def project(events, effective_at, known_at):
    effective_at = datetime.fromisoformat(effective_at)
    known_at = datetime.fromisoformat(known_at)
    latest = {}
    for event in events:
        if (
            datetime.fromisoformat(event["recorded_at"]) > known_at
            or datetime.fromisoformat(event["effective_at"]) > effective_at
        ):
            continue
        old = latest.get(event["event_id"])
        if old is None or event["revision"] > old["revision"]:
            latest[event["event_id"]] = event
    lots = {}
    work = {}
    five = {}
    hourly = {}
    conversions = []
    for event in latest.values():
        p = event["person_id"]
        value = event["payload"]
        kind = event["kind"]
        if kind in ("grant", "leave", "reservation"):
            key = value["lot"]
            lot = lots.setdefault(
                key,
                {
                    "person": p,
                    "granted": Fraction(0),
                    "taken": Fraction(0),
                    "reserved": Fraction(0),
                    "conversion_adjustment": Fraction(0),
                    "expiry": None,
                },
            )
            amount = Fraction(*value["days"])
            if kind == "grant":
                lot["granted"] += amount
                lot["expiry"] = value["expires_on"]
            elif kind == "leave":
                lot["taken"] += amount
                year = datetime.fromisoformat(event["effective_at"]).year
                five[(p, year)] = five.get((p, year), Fraction(0)) + amount
            elif value["linked_actual"] not in latest:
                lot["reserved"] += amount
        if kind == "hourly_leave":
            hours = Fraction(*value["hours"])
            hourly[p] = hourly.get(p, Fraction(0)) + hours
            lot = lots.setdefault(
                value["lot"],
                {
                    "person": p,
                    "granted": Fraction(0),
                    "taken": Fraction(0),
                    "reserved": Fraction(0),
                    "conversion_adjustment": Fraction(0),
                    "expiry": None,
                },
            )
            lot["taken"] += hours / value["one_day_hours"]
        if kind == "conversion":
            lot = lots[value["lot"]]
            before = (
                lot["granted"]
                - lot["taken"]
                - lot["reserved"]
                + lot["conversion_adjustment"]
            )
            if before < 0:
                conversions.append(
                    {
                        "event_id": event["event_id"],
                        "status": "requires_hr_reconciliation",
                        "before": rational(before),
                    }
                )
            else:
                whole = before.numerator // before.denominator
                scaled = (before - whole) * value["new_hours"]
                hours = (
                    scaled.numerator + scaled.denominator - 1
                ) // scaled.denominator
                if hours != value["converted_hours"]:
                    raise ValueError("Independent conversion quantity differs")
                after = Fraction(whole) + Fraction(hours, value["new_hours"])
                lot["conversion_adjustment"] += after - before
                conversions.append(
                    {
                        "event_id": event["event_id"],
                        "status": "applied",
                        "before": rational(before),
                        "after": rational(after),
                    }
                )
        if kind == "work":
            a = datetime.fromisoformat(value["start"])
            b = datetime.fromisoformat(value["end"])
            key = (p, a.strftime("%Y-%m"))
            row = work.setdefault(
                key, {"work_seconds": 0, "night_seconds": 0, "holiday_seconds": 0}
            )
            row["work_seconds"] += seconds(a, b)
            row["night_seconds"] += night_seconds(a, b)
            if value["holiday"]:
                row["holiday_seconds"] += seconds(a, b)
    balances = []
    for lot_id, lot in sorted(lots.items()):
        balance = (
            lot["granted"]
            - lot["taken"]
            - lot["reserved"]
            + lot["conversion_adjustment"]
        )
        expired = bool(
            lot["expiry"] and date.fromisoformat(lot["expiry"]) <= effective_at.date()
        )
        balances.append(
            {
                "lot": lot_id,
                "person": lot["person"],
                "granted": rational(lot["granted"]),
                "taken": rational(lot["taken"]),
                "conversion_adjustment": rational(lot["conversion_adjustment"]),
                "reserved": rational(lot["reserved"]),
                "unreserved": rational(balance),
                "expired": expired,
                "deficit": balance < 0,
            }
        )
    return {
        "lots": balances,
        "conversions": conversions,
        "work": [
            {"person": p, "month": month, **value}
            for (p, month), value in sorted(work.items())
        ],
        "day_and_half_day_credit_by_calendar_year": [
            {"person": p, "year": year, "days": rational(amount)}
            for (p, year), amount in sorted(five.items())
        ],
        "hourly_taken": [
            {
                "person": p,
                "hours": rational(amount),
                "annual_five_day_credit": rational(Fraction(0)),
            }
            for p, amount in sorted(hourly.items())
        ],
        "boundary": "Calendar-year day credit is not the statutory baseline obligation window; expiry does not silently zero a grant-reduction deficit",
    }


def freeze(directory):
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=False)
    events = scenario()
    last = stamp(month(25))
    snapshots = []
    for index in range(25):
        cutoff = (
            datetime.fromisoformat(stamp(month(index + 1))) - timedelta(seconds=1)
        ).isoformat()
        snapshots.append(
            {
                "month": str(month(index))[:7],
                "clock": cutoff,
                "as_known": project(events, cutoff, cutoff),
                "restated": project(events, cutoff, last),
            }
        )
    document = {
        "schema_version": 1,
        "protocol_revision": 7,
        "start": str(month(0)),
        "end_exclusive": str(month(25)),
        "months": 25,
        "events": events,
        "monthly_expected": snapshots,
        "applied_to_api": False,
        "physical_restore_executed": False,
        "required_adapters": [
            "contract_and_regime",
            "grant_and_corrections",
            "work_and_publication",
            "all_shared_types",
            "backup_and_restore",
        ],
        "oracle_scope": [
            "integer_work_intervals",
            "effective_recorded_revisions",
            "rational_lot_balance",
            "hourly_excluded_day_credit",
        ],
        "not_proven": [
            "legal_regime_applicability",
            "statutory_annual_obligation_windows",
            "all_shared_type_handlers",
            "physical_restore",
        ],
    }
    encoded = json.dumps(document, ensure_ascii=False, sort_keys=True, indent=2)
    (target / "protocol.json").write_text(encoded + "\n")
    (target / "protocol.sha256").write_text(
        hashlib.sha256((encoded + "\n").encode()).hexdigest() + "\n"
    )
    return document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    result = freeze(parser.parse_args().output)
    print(
        json.dumps(
            {
                "months": result["months"],
                "events": len(result["events"]),
                "api_executed": False,
            }
        )
    )


if __name__ == "__main__":
    main()
