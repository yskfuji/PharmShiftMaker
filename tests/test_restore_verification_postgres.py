"""Measured registered-store restoration and trusted release; real PostgreSQL."""

from copy import deepcopy
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import text

from shift_scheduler.control.recovery import restore_with_authority
from shift_scheduler.control.restore_verification import attest, target_description
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay
from tests.test_control_authority import VERIFIER_KEY
from tests.test_managed_capture_postgres import source

SECRET = b"synthetic-restore-verifier-secret-0000"


def prepare(pg, authority, tmp_path, monkeypatch):
    root = tmp_path / "managed"
    root.mkdir()
    copy_id, _ = source(pg, root, monkeypatch)
    clients, _, web = authority
    web.restore_trust["restore"].update(target_description(pg))
    with pg() as session:
        manifest = export_manifest(session, SECRET)
    identity = uuid4().hex
    clients["source"].request(
        "POST",
        "/operations/prepare",
        {"operation_id": identity, "expected_generation": 0, "manifest": manifest},
    )
    clients["source"].request(
        "POST",
        f"/operations/{identity}/commit",
        {"manifest_hash": content_hash(manifest), "receipt_hash": "a" * 64},
    )
    return root, copy_id, manifest, clients


def measured(pg, clients, manifest):
    clients["operator"].request("POST", "/nodes/restore/quarantine")
    with pg.begin() as session:
        quarantine(session)
    with pg.begin() as session:
        result = replay(session, manifest, content_hash(manifest), SECRET)
    current = clients["operator"].request("GET", "/manifest")
    challenge = clients["operator"].request("POST", "/nodes/restore/verification")
    proof = attest(
        pg, "restore", current, challenge, result, VERIFIER_KEY.private_bytes_raw()
    )
    return {
        "expected_generation": current["generation"],
        "manifest_hash": current["manifest_hash"],
        "verification_hash": content_hash(proof["payload"]),
        "attestation": proof,
    }


def test_product_recovery_requires_measured_target_and_never_claims_all_copy_completion(
    pg, authority, tmp_path, monkeypatch
):
    root, copy_id, manifest, clients = prepare(pg, authority, tmp_path, monkeypatch)
    result = restore_with_authority(
        pg,
        clients["operator"],
        "restore",
        SECRET,
        verifier_private_key=VERIFIER_KEY.private_bytes_raw(),
    )
    assert clients["restore"].require_access()["generation"] == 1
    assert result["authority"]["state"] == "OPEN"
    assert not result["authority"]["all_storage_paths_verified"]
    assert "unregistered_dynamic_paths" in result["authority"]["unobserved_domains"]
    assert set(result["attestation"]["payload"]["observation_hashes"]) == {
        "application_database",
        "managed_files",
    }
    assert (root / copy_id).read_bytes() == b"person p0"


@pytest.mark.parametrize(
    "fault",
    [
        "missing",
        "changed",
        "unregistered_file",
        "unregistered_db",
        "other_facility",
        "unfinished",
        "unknown_medium",
    ],
)
def test_unreconciled_active_stores_keep_gate_closed(
    pg, authority, tmp_path, monkeypatch, fault
):
    root, copy_id, manifest, clients = prepare(pg, authority, tmp_path, monkeypatch)
    if fault == "missing":
        (root / copy_id).unlink()
    elif fault == "changed":
        (root / copy_id).write_bytes(b"changed synthetic data")
    elif fault == "unregistered_file":
        (root / "unknown").write_bytes(b"unknown synthetic output")
    elif fault in {"unregistered_db", "other_facility"}:
        with pg.begin() as session:
            session.execute(
                text("ALTER TABLE privacy_cases DISABLE TRIGGER pharmshift_copy_write")
            )
            session.execute(
                text(
                    "INSERT INTO privacy_cases(case_id,scope_id,person_id,kind,status,revision,payload) VALUES ('unknown',:scope,'p0','access','RECEIVED',1,'{}')"
                ),
                {
                    "scope": (
                        "other/pharmacy"
                        if fault == "other_facility"
                        else "hospital/pharmacy"
                    )
                },
            )
            session.execute(
                text("ALTER TABLE privacy_cases ENABLE TRIGGER pharmshift_copy_write")
            )
    else:
        with pg.begin() as session:
            session.execute(
                text(
                    "UPDATE managed_copies SET "
                    + ("state" if fault == "unfinished" else "medium")
                    + "=:value WHERE copy_id=:id"
                ),
                {
                    "value": (
                        "CAPTURE_RETRY" if fault == "unfinished" else "unknown-replica"
                    ),
                    "id": copy_id,
                },
            )
    with pytest.raises(ValueError):
        restore_with_authority(
            pg,
            clients["operator"],
            "restore",
            SECRET,
            verifier_private_key=VERIFIER_KEY.private_bytes_raw(),
        )
    with pytest.raises(RestoreUnavailable):
        clients["restore"].require_access()


@pytest.mark.parametrize(
    "fault",
    [
        "signature",
        "target",
        "domains",
        "added_domain",
        "generation",
        "missing",
        "hash",
        "old_challenge",
        "old_time",
        "self_key",
    ],
)
def test_authority_refuses_forged_changed_or_stale_observations(
    pg, authority, tmp_path, monkeypatch, fault
):
    _, _, manifest, clients = prepare(pg, authority, tmp_path, monkeypatch)
    request = measured(pg, clients, manifest)
    payload = request["attestation"]["payload"]
    if fault == "missing":
        request.pop("attestation")
    elif fault == "signature":
        request["attestation"]["signature"] = "00" * 64
    elif fault == "hash":
        request["verification_hash"] = "f" * 64
    elif fault == "old_challenge":
        clients["operator"].request("POST", "/nodes/restore/verification")
    else:
        if fault == "target":
            payload["target_hash"] = "e" * 64
        elif fault == "domains":
            payload["domains"] = ["application_database"]
            payload["observation_hashes"].pop("managed_files")
        elif fault == "added_domain":
            payload["domains"].append("invented")
            payload["observation_hashes"]["invented"] = "a" * 64
        elif fault == "generation":
            payload["generation"] = 0
        elif fault == "old_time":
            payload["observed_at"] = "2020-01-01T00:00:00Z"
        key = Ed25519PrivateKey.generate() if fault == "self_key" else VERIFIER_KEY
        request["verification_hash"] = content_hash(payload)
        request["attestation"]["signature"] = key.sign(
            bytes.fromhex(content_hash(payload))
        ).hex()
    with pytest.raises(RestoreUnavailable):
        clients["operator"].request("POST", "/nodes/restore/release", request)
    with pytest.raises(RestoreUnavailable):
        clients["restore"].require_access()


def test_observation_cannot_target_another_pg_schema_or_unconfigured_key(
    pg, authority, tmp_path, monkeypatch
):
    _, _, manifest, clients = prepare(pg, authority, tmp_path, monkeypatch)
    _, _, web = authority
    deepcopy(web.restore_trust["restore"])
    web.restore_trust["restore"]["target_hash"] = "e" * 64
    with pytest.raises(ValueError, match="target"):
        restore_with_authority(
            pg,
            clients["operator"],
            "restore",
            SECRET,
            verifier_private_key=VERIFIER_KEY.private_bytes_raw(),
        )
    web.restore_trust.clear()
    with pytest.raises(RestoreUnavailable):
        clients["operator"].request("POST", "/nodes/restore/verification")
