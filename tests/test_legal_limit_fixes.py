"""Legal limits confirmed against primary sources (no database needed).

- Special clause: overtime plus holiday work must be under 100h a month
  (Labour Standards Act Art. 36(6)(ii)). A stored 100h agreement stays readable
  and is reported as a violation; a new one is refused when saved.
- Management model: A overtime + B hours under 100h in a month and averaging
  80h or less over several months (基発0901第3号); with the same monthly limits
  every month the combined limit must be 80h or less.
- Statutory annual leave expires two years after it can first be used
  (Labour Standards Act Art. 115); a period that starts at 0:00 counts its first
  day (Civil Code Art. 140), so a grant on 2026-01-01 may expire on 2028-01-01
  in this app's exclusive end-date convention.
"""

from datetime import date

import pytest
from pydantic import ValidationError

from shift_scheduler.domain.compliance import Agreement, SolverSnapshotV2
from shift_scheduler.domain.planning import SolverSnapshot
from shift_scheduler.validation.leave_accounting import account_leave, two_years_after
from shift_scheduler.validation.planning import input_findings as v1_inputs
from shift_scheduler.validation.work_accounting import account_work
from shift_scheduler.validation.work_accounting import input_findings as work_inputs
from tests.test_compliance_v2 import leave_fixture, work_fixture
from tests.test_reviewed_planning import snapshot as reviewed_v1_snapshot


@pytest.mark.parametrize(
    "seconds,reported", [(100 * 3600 - 1, False), (100 * 3600, True)]
)
def test_special_clause_monthly_limit_under_100h_is_reported_not_unreadable(
    seconds, reported
):
    # Stored inputs with exactly 100h must stay readable (same input hash) and be
    # reported as a violation; only new saves are refused (see below).
    payload = work_fixture([]).model_dump(mode="json")
    payload["agreements"][0].update(
        special_clause=True,
        monthly_limit_seconds=seconds,
        annual_limit_seconds=720 * 3600,
        invocation_evidence=payload["agreements"][0]["evidence"],
    )
    data = SolverSnapshotV2.model_validate(payload)
    assert (
        SolverSnapshotV2.model_validate(data.model_dump(mode="json")).input_hash
        == data.input_hash
    )
    found = [f for f in work_inputs(data) if "below 100h" in f.message]
    assert bool(found) is reported
    if reported:
        assert found[0].status == "violation"

    v1 = reviewed_v1_snapshot().model_dump(mode="json")
    evidence = v1["contracts"][0]["evidence"]
    v1["overtime_agreements"] = [
        {
            "agreement_id": "x",
            "employer_id": v1["contracts"][0]["employer_id"],
            "year_start": "2026-01-01",
            "monthly_limit_seconds": seconds,
            "annual_limit_seconds": 720 * 3600,
            "special_clause": True,
            "evidence": evidence,
            "special_invocation_evidence": evidence,
        }
    ]
    for contract in v1["contracts"]:
        contract["overtime_agreement_id"] = "x"
    legacy = [
        f
        for f in v1_inputs(SolverSnapshot.model_validate(v1))
        if "below 100h" in f.message
    ]
    assert bool(legacy) is reported
    if reported:
        assert legacy[0].status == "violation"
    with pytest.raises(ValidationError):  # above 100h is still not a valid agreement
        Agreement.model_validate(
            dict(payload["agreements"][0], monthly_limit_seconds=100 * 3600 + 1)
        )


def test_saving_a_new_100h_agreement_is_refused_but_a_stored_one_stays_editable(
    sqlite_session_factory,
):
    from shift_scheduler.application.compliance import entity_key, save_entity
    from shift_scheduler.db.compliance_models import ComplianceEntity

    scope = "facility/department"
    raw = work_fixture([]).model_dump(mode="json")["agreements"][0]
    raw.update(
        special_clause=True,
        monthly_limit_seconds=100 * 3600,
        annual_limit_seconds=720 * 3600,
    )
    with (
        sqlite_session_factory() as session,
        pytest.raises(ValueError, match="below 100 hours"),
    ):
        save_entity(session, scope, "agreement", raw, 0, "admin")
    stored = Agreement.model_validate(raw).model_dump(mode="json")
    under = Agreement.model_validate(
        dict(raw, agreement_id="under", monthly_limit_seconds=99 * 3600)
    ).model_dump(mode="json")
    with (
        sqlite_session_factory.begin() as session
    ):  # records saved before the rule existed
        for item in (stored, under):
            session.add(
                ComplianceEntity(
                    key=entity_key(scope, "agreement", item["agreement_id"]),
                    scope_id=scope,
                    kind="agreement",
                    entity_id=item["agreement_id"],
                    revision=1,
                    payload=item,
                )
            )
    with sqlite_session_factory.begin() as session:
        # Re-registering the identical record (as register_snapshot does) is not refused.
        assert (
            save_entity(session, scope, "agreement", stored, 1, "admin").revision == 1
        )
    with sqlite_session_factory.begin() as session:
        # Other fields of the stored 100h record can still be edited (e.g. closing it).
        closed = dict(stored, end=stored["start"][:10] + "T12:00:00+09:00")
        assert (
            save_entity(session, scope, "agreement", closed, 1, "admin").revision == 2
        )
    with (
        sqlite_session_factory() as session,
        pytest.raises(ValueError, match="below 100 hours"),
    ):
        # Raising a stored limit to 100h is a new 100h limit and is refused.
        save_entity(
            session,
            scope,
            "agreement",
            dict(under, monthly_limit_seconds=100 * 3600),
            1,
            "admin",
        )


@pytest.mark.parametrize(
    "first,second,message",
    [
        (40 * 3600, 40 * 3600, None),
        (40 * 3600, 40 * 3600 + 1, "multi-month average within 80h"),
        (50 * 3600, 49 * 3600 + 3599, "multi-month average within 80h"),
        (50 * 3600, 50 * 3600, "below 100h"),
    ],
)
def test_management_model_limits_keep_100h_and_80h(first, second, message):
    data = work_fixture([("A", 0, 6, 6, 6), ("B", 0, 13, 1, 1)], method="management")
    payload = data.model_dump(mode="json")
    payload["management_models"] = [
        {
            "model_id": "AB",
            "person_id": "p0",
            "first_employer": "A",
            "second_employer": "B",
            "start": data.context.start,
            "end": data.context.end,
            "month_anchor": "2026-01-01",
            "first_month_limit_seconds": first,
            "second_month_limit_seconds": second,
            "first_consent": data.policy_evidence,
            "second_consent": data.policy_evidence,
            "notification": data.policy_evidence,
        }
    ]
    data = SolverSnapshotV2.model_validate(payload)
    messages = [
        f.message
        for f in account_work(data, list(data.candidates))["findings"]
        if "Management-model combined" in f.message
    ]
    if message is None:
        assert messages == []
    else:
        assert len(messages) == 1 and message in messages[0]


def test_two_year_date_including_leap_day():
    assert two_years_after(date(2026, 1, 1)) == date(2028, 1, 1)
    assert two_years_after(date(2028, 2, 29)) == date(2030, 3, 1)


@pytest.mark.parametrize(
    "expires_on,statutory,flagged",
    [
        ("2028-01-01", 10, False),  # exactly two years
        ("2027-12-31", 10, True),  # one day short
        ("2027-12-31", 0, False),  # no statutory portion: company leave may be shorter
    ],
)
def test_statutory_leave_must_not_expire_before_two_years(
    expires_on, statutory, flagged
):
    data = leave_fixture()
    payload = data.model_dump(mode="json")
    payload["leave_accounts"][0].update(expires_on=expires_on, statutory_days=statutory)
    if statutory == 0:
        payload["leave_obligations"] = []
    report = account_leave(SolverSnapshotV2.model_validate(payload), date(2026, 6, 1))
    found = [f for f in report["findings"] if "two years" in f.message]
    assert bool(found) is flagged
    if flagged:
        assert found[0].status == "unverified"
