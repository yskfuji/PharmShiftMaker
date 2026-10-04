from datetime import datetime, timedelta

from scripts.long_integrated_scenario import freeze, project, scenario


def test_exact_25_months_2026_february_through_2028_february(tmp_path):
    protocol = freeze(tmp_path / "fixed")
    assert (
        protocol["start"] == "2026-02-01" and protocol["end_exclusive"] == "2028-03-01"
    )
    assert len(protocol["monthly_expected"]) == 25
    assert not protocol["applied_to_api"] and not protocol["physical_restore_executed"]
    assert {e["kind"] for e in protocol["events"]} >= {
        "contract",
        "grant",
        "leave",
        "hourly_leave",
        "reservation",
        "work",
        "publication",
        "backup",
        "hold",
        "erasure",
        "restore",
        "backup_expiry",
    }


def test_delayed_work_correction_and_after_expiry_grant_reduction():
    events = scenario()
    august_end = "2026-08-31T23:59:59+09:00"
    correction = next(
        i
        for i, e in enumerate(events)
        if e["event_id"] == "work-p0-6-night" and e["revision"] == 2
    )
    republish = next(
        i for i, e in enumerate(events) if e["event_id"] == "publication-6-revised"
    )
    assert correction < republish
    known = project(events, august_end, august_end)
    corrected = project(events, august_end, "2028-03-01T00:00:00+09:00")

    def key(result):
        return next(
            r for r in result["work"] if r["person"] == "p0" and r["month"] == "2026-08"
        )

    assert key(known)["work_seconds"] == 28800
    assert key(corrected)["work_seconds"] == 32400
    assert key(corrected)["night_seconds"] == 18000
    end = project(events, "2028-02-29T23:59:59+09:00", "2028-02-29T23:59:59+09:00")
    old = next(lot for lot in end["lots"] if lot["lot"] == "p0-2026")
    assert old["expired"] and old["deficit"]
    assert old["unreserved"] == {"numerator": -9, "denominator": 4}
    assert end["hourly_taken"][0]["annual_five_day_credit"] == {
        "numerator": 0,
        "denominator": 1,
    }


def test_reservations_are_not_consumption_and_no_zero_balance_repair():
    events = scenario()
    begin = project(events, "2026-02-01T23:59:59+09:00", "2026-02-01T23:59:59+09:00")
    p0 = next(lot for lot in begin["lots"] if lot["lot"] == "p0-2026")
    assert p0["taken"] == {"numerator": 0, "denominator": 1}
    assert p0["reserved"] == {"numerator": 1, "denominator": 2}


def test_equal_timestamp_does_not_make_uncommitted_future_event_visible():
    events = scenario()
    index = next(
        i for i, event in enumerate(events) if event["event_id"] == "publication-12"
    )
    known = events[index]["recorded_at"]

    def expected(prefix):
        return next(
            row["night_seconds"]
            for row in project(prefix, "2027-02-01T00:00:00+09:00", known)["work"]
            if row["person"] == "p0" and row["month"] == "2026-08"
        )

    assert expected(events[:index]) == 14400
    assert expected(events) == 18000


def test_release_precedes_erasure_without_changing_protocol_population():
    events = scenario()
    assert len(events) == 299
    for person in ("p0", "p1"):
        release = next(e for e in events if e["event_id"] == "release-" + person)
        erase = next(e for e in events if e["event_id"] == "erase-" + person)
        assert release["payload"]["active"] is False
        assert datetime.fromisoformat(erase["recorded_at"]) - datetime.fromisoformat(
            release["recorded_at"]
        ) == timedelta(hours=1)
        assert release["effective_at"] == erase["effective_at"]
        assert events.index(release) < events.index(erase)


def test_protocol_7_grants_do_not_expire_before_two_years(tmp_path):
    # Labour Standards Act Art. 115: statutory leave survives two years. The API
    # uses the event date as granted_on and expires_on as an exclusive end date.
    from datetime import date

    from shift_scheduler.validation.leave_accounting import two_years_after

    assert freeze(tmp_path / "fixed")["protocol_revision"] == 7
    grants = [e for e in scenario() if e["kind"] == "grant"]
    assert grants
    for event in grants:
        granted = date.fromisoformat(event["effective_at"][:10])
        assert date.fromisoformat(event["payload"]["expires_on"]) >= two_years_after(
            granted
        ), event["event_id"]
