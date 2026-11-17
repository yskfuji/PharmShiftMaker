import pytest

from shift_scheduler.control.recovery import restore_with_authority
from shift_scheduler.db.compliance_models import LegalHold, RestoreGate, RetentionRule
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import export_manifest
from tests.test_control_authority import VERIFIER_KEY


def test_restore_uses_latest_holds_and_control_change_prevents_release(
    authority, pg, tmp_path, monkeypatch
):
    factory = pg
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    clients, _, web = authority
    from shift_scheduler.control.restore_verification import target_description

    web.restore_trust["restore"].update(target_description(pg))
    source, operator, restore = (clients[r] for r in ("source", "operator", "restore"))
    secret = b"independent-recovery-test-secret-000"
    with factory.begin() as session:
        session.add(
            LegalHold(
                hold_id="new-hold",
                scope_id="hospital/pharmacy",
                person_id="p0",
                active=True,
                revision=2,
                payload={"reason": "synthetic preservation"},
            )
        )
        session.add(
            RetentionRule(
                key="latest-rule",
                scope_id="hospital/pharmacy",
                category="audit",
                revision=2,
                payload={"reason": "synthetic external policy"},
            )
        )
        session.flush()
        manifest = export_manifest(session, secret, include_policies=True)
        assert manifest["payload"]["version"] == 7
    source.request(
        "POST",
        "/operations/prepare",
        {"operation_id": "a" * 32, "expected_generation": 0, "manifest": manifest},
    )
    source.request(
        "POST",
        "/operations/" + "a" * 32 + "/commit",
        {"manifest_hash": content_hash(manifest), "receipt_hash": "b" * 64},
    )
    # Model a restored backup predating the independent hold. Actual pg_restore
    # and process/network faults belong to separate integration evidence.
    with factory.begin() as session:
        session.delete(session.get(LegalHold, "new-hold"))
    original = operator.request

    def advance_before_open(method, path, body=None):
        if path.endswith("/release"):
            source.request(
                "POST",
                "/operations/prepare",
                {
                    "operation_id": "c" * 32,
                    "expected_generation": 1,
                    "manifest": manifest,
                },
            )
        return original(method, path, body)

    operator.request = advance_before_open
    with pytest.raises(RestoreUnavailable):
        restore_with_authority(
            factory,
            operator,
            "restore",
            secret,
            verifier_private_key=VERIFIER_KEY.private_bytes_raw(),
        )
    with factory() as session:
        assert session.get(LegalHold, "new-hold").active
        assert session.get(RestoreGate, "restore").state == "REPLAYED"
    # DB replay success alone must never authorize personal-data access.
    with pytest.raises(RestoreUnavailable):
        restore.require_access()
    source.request(
        "POST",
        "/operations/" + "c" * 32 + "/commit",
        {"manifest_hash": content_hash(manifest), "receipt_hash": "d" * 64},
    )
    operator.request = original
    result = restore_with_authority(
        factory,
        operator,
        "restore",
        secret,
        verifier_private_key=VERIFIER_KEY.private_bytes_raw(),
    )
    assert result["authority"]["state"] == "OPEN"
    assert restore.require_access()["generation"] == 2


@pytest.mark.parametrize("tamper", ["active", "person", "unknown"])
def test_equal_revision_tampering_or_unlisted_hold_keeps_restore_blocked(
    sqlite_session_factory, tamper
):
    from shift_scheduler.ops.erasure_replay import quarantine, replay

    secret = b"independent-recovery-test-secret-000"
    with sqlite_session_factory.begin() as session:
        session.add(
            LegalHold(
                hold_id="known",
                scope_id="hospital/pharmacy",
                person_id="p0",
                active=True,
                revision=1,
                payload={},
            )
        )
    with sqlite_session_factory() as session:
        manifest = export_manifest(session, secret, include_policies=True)
    with sqlite_session_factory.begin() as session:
        row = session.get(LegalHold, "known")
        if tamper == "active":
            row.active = False
        elif tamper == "person":
            row.person_id = "p1"
        else:
            session.add(
                LegalHold(
                    hold_id="unlisted",
                    scope_id="hospital/pharmacy",
                    person_id="p0",
                    active=True,
                    revision=1,
                    payload={},
                )
            )
        quarantine(session)
    with pytest.raises(ValueError), sqlite_session_factory.begin() as session:
        replay(session, manifest, content_hash(manifest), secret)
    with sqlite_session_factory() as session:
        assert session.get(RestoreGate, "restore").state == "QUARANTINED"
