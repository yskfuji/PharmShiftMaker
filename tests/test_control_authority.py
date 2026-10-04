"""Independent service protocol: no timeout-based success or unsigned permissions."""

from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.service import ControlBase, Head, Operation, create_app
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash

VERIFIER_KEY = Ed25519PrivateKey.from_private_bytes(b"v" * 32)


def signed_release(clients, generation, manifest_hash):
    """Authority protocol fixture only; real observations are tested in PG."""
    challenge = clients["operator"].request("POST", "/nodes/restore/verification")
    payload = {
        "format": "registered-restore-target-v1",
        "node_id": "restore",
        "challenge": challenge["challenge"],
        "generation": generation,
        "manifest_hash": manifest_hash,
        **{k: challenge[k] for k in ("target_hash", "policy_hash", "domains")},
        "observation_hashes": dict.fromkeys(challenge["domains"], "b" * 64),
        "registry_hash": "c" * 64,
        "replay_hash": "d" * 64,
        "observed_at": datetime.now(UTC).isoformat(),
        "residual_counts": {},
        "unobserved_domains": ["external_handoffs", "wal_and_physical_media"],
        "all_storage_paths_verified": False,
    }
    return {
        "expected_generation": generation,
        "manifest_hash": manifest_hash,
        "verification_hash": content_hash(payload),
        "attestation": {
            "payload": payload,
            "signature": VERIFIER_KEY.sign(bytes.fromhex(content_hash(payload))).hex(),
        },
    }


@pytest.fixture
def authority(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "independent.sqlite"))
    ControlBase.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory.begin() as session:
        session.add(Head(id=1, generation=0))
    private = Ed25519PrivateKey.generate()
    credentials = {
        role: {"role": role, "token": role * 32}
        for role in ("source", "restore", "operator")
    }
    credentials["replacement"] = {"role": "source", "token": "replacement" * 32}
    trust = {
        "restore": {
            "public_key": VERIFIER_KEY.public_key().public_bytes_raw().hex(),
            "target_hash": "e" * 64,
            "policy_hash": "f" * 64,
            "domains": ["application_database", "managed_files"],
        }
    }
    web = TestClient(
        create_app(
            factory, private.private_bytes_raw(), credentials, restore_verifiers=trust
        )
    )
    web.restore_trust = (
        trust  # server-side test configuration, no public update endpoint
    )

    def transport(request):
        response = web.request(
            request.method,
            request.url.path,
            content=request.content,
            headers=dict(request.headers),
        )
        return httpx.Response(
            response.status_code, content=response.content, request=request
        )

    clients = {
        role: AuthorityClient(
            "http://authority",
            role,
            entry["token"],
            private.public_key().public_bytes_raw().hex(),
            transport=httpx.MockTransport(transport),
        )
        for role, entry in credentials.items()
    }
    for role in ("source", "restore"):
        clients["operator"].request("POST", "/nodes", {"node_id": role, "role": role})
    yield clients, factory, web
    web.close()
    engine.dispose()


def test_pending_stale_restore_changed_receipt_and_new_generation(authority):
    clients, factory, _ = authority
    source, restore, operator = (clients[r] for r in ("source", "restore", "operator"))
    assert source.require_access()["generation"] == 0
    with pytest.raises(RestoreUnavailable):
        restore.require_access()
    operation = uuid4().hex
    manifest = {"synthetic_control": "generation-one"}
    body = {"operation_id": operation, "expected_generation": 0, "manifest": manifest}
    first = source.request("POST", "/operations/prepare", body)
    assert source.request("POST", "/operations/prepare", body) == first
    for client in (source, restore):
        with pytest.raises(RestoreUnavailable):
            client.require_access()
    with pytest.raises(RestoreUnavailable):
        operator.request("GET", "/manifest")
    confirmation = {"manifest_hash": content_hash(manifest), "receipt_hash": "a" * 64}
    assert (
        source.request("POST", f"/operations/{operation}/commit", confirmation)[
            "generation"
        ]
        == 1
    )
    assert (
        source.request("POST", f"/operations/{operation}/commit", confirmation)[
            "generation"
        ]
        == 1
    )
    with pytest.raises(RestoreUnavailable):
        source.request(
            "POST",
            f"/operations/{operation}/commit",
            {**confirmation, "receipt_hash": "b" * 64},
        )
    release = {
        "expected_generation": 1,
        "manifest_hash": content_hash(manifest),
        "verification_hash": "c" * 64,
    }
    with pytest.raises(RestoreUnavailable):
        restore.request("POST", "/nodes/restore/release", release)
    with pytest.raises(RestoreUnavailable):
        operator.request("POST", "/nodes/restore/release", release)
    release = signed_release(clients, 1, content_hash(manifest))
    operator.request("POST", "/nodes/restore/release", release)
    assert restore.require_access()["generation"] == 1
    second = uuid4().hex
    source.request(
        "POST",
        "/operations/prepare",
        {"operation_id": second, "expected_generation": 1, "manifest": {"next": True}},
    )
    with pytest.raises(RestoreUnavailable):
        operator.request("POST", "/nodes/restore/release", release)
    source.request(
        "POST",
        f"/operations/{second}/commit",
        {"manifest_hash": content_hash({"next": True}), "receipt_hash": "d" * 64},
    )
    with pytest.raises(RestoreUnavailable):
        restore.require_access()
    with factory() as session:
        assert session.get(Head, 1).generation == 2
        assert len(list(session.scalars(select(Operation)))) == 2


def test_replayed_nonce_invalid_signature_and_connection_failure_block(authority):
    clients, _, web = authority
    source = clients["source"]
    captured = web.get(
        "/status",
        headers={
            "Authorization": "Bearer " + "source" * 32,
            "X-Control-Client": "source",
            "X-Control-Nonce": "0" * 32,
        },
    ).json()
    source.transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json=captured)
    )
    with pytest.raises(RestoreUnavailable):
        source.require_access()
    captured["signature"] = "00" * 64
    with pytest.raises(RestoreUnavailable):
        source.require_access()

    def disconnected(request):
        raise httpx.ConnectError("isolated outage", request=request)

    source.transport = httpx.MockTransport(disconnected)
    with pytest.raises(RestoreUnavailable):
        source.require_access()


def test_lost_commit_ack_preserves_application_receipt_for_reconciliation(
    authority, sqlite_session_factory, monkeypatch
):
    import shift_scheduler.control.transaction as transaction
    from shift_scheduler.db.compliance_models import ControlCommit, PrivacyCase

    clients, control_db, _ = authority
    source = clients["source"]
    monkeypatch.setattr(transaction, "configured_client", lambda: source)
    monkeypatch.setenv(
        "PHARMSHIFT_ERASURE_MANIFEST_KEY", "independent-manifest-test-key-000000"
    )
    original = source.request

    def lose_commit(method, path, body=None):
        if path.endswith("/commit"):
            raise RestoreUnavailable("Injected disconnect before confirmation delivery")
        return original(method, path, body)

    monkeypatch.setattr(source, "request", lose_commit)
    with pytest.raises(RestoreUnavailable), sqlite_session_factory.begin() as session:
        session.add(
            PrivacyCase(
                case_id="restrict",
                scope_id="hospital/pharmacy",
                person_id="p0",
                kind="restrict",
                status="APPROVED",
                revision=1,
                payload={"reason": "synthetic restriction"},
            )
        )
        transaction.stage_control(session)
    with sqlite_session_factory() as session:
        assert session.get(PrivacyCase, "restrict") is not None
        receipt = session.scalar(select(ControlCommit))
        assert receipt is not None
    with control_db() as session:
        assert session.get(Head, 1).pending == receipt.operation_id
    with pytest.raises(RestoreUnavailable):
        source.require_access()
    monkeypatch.setattr(source, "request", original)
    source.request(
        "POST",
        f"/operations/{receipt.operation_id}/commit",
        {"manifest_hash": receipt.manifest_hash, "receipt_hash": receipt.receipt_hash},
    )
    assert source.require_access()["generation"] == 1


def test_service_outage_blocks_legacy_and_planning_http_paths(monkeypatch):
    import shift_scheduler.control.client as control
    from shift_scheduler.api.main import app

    def unavailable():
        raise RestoreUnavailable("test service stopped")

    monkeypatch.setattr(control, "require_access", unavailable)
    with TestClient(app) as client:
        for path in (
            "/planning/scopes",
            "/staff",
            "/schedules/2026/1",
            "/planning/compliance/recovery-status",
        ):
            response = client.get(path)
            assert response.status_code == 503
            assert response.headers["cache-control"] == "no-store"
        assert client.get("/").status_code == 200


def test_writer_fence_blocks_late_commit_and_transfer_requires_fence(authority):
    clients, factory, _ = authority
    source, operator = clients["source"], clients["operator"]
    op, fence = "1" * 32, "2" * 32
    manifest = {"synthetic": "prepared-before-fence"}
    source.request(
        "POST",
        "/operations/prepare",
        {"operation_id": op, "expected_generation": 0, "manifest": manifest},
    )
    with pytest.raises(RestoreUnavailable):
        operator.request(
            "POST",
            "/operations/" + op + "/verified-rollback",
            {
                "fence_id": fence,
                "reason": "verified isolated aborted transaction",
                "verification_hash": "3" * 64,
            },
        )
    result = operator.request(
        "POST",
        "/nodes/source/fence",
        {
            "operation_id": fence,
            "expected_generation": 0,
            "reason": "isolate synthetic former source writer",
        },
    )
    assert result["state"] == "FENCED"
    with pytest.raises(RestoreUnavailable):
        source.request(
            "POST",
            "/operations/" + op + "/commit",
            {"manifest_hash": content_hash(manifest), "receipt_hash": "4" * 64},
        )
    with pytest.raises(RestoreUnavailable):
        operator.request(
            "POST",
            "/nodes/source/replace-writer",
            {"fence_id": fence, "new_node_id": "replacement", "expected_generation": 0},
        )
    operator.request(
        "POST",
        "/operations/" + op + "/verified-rollback",
        {
            "fence_id": fence,
            "reason": "verified isolated aborted transaction",
            "verification_hash": "3" * 64,
        },
    )
    result = operator.request(
        "POST",
        "/nodes/source/replace-writer",
        {"fence_id": fence, "new_node_id": "replacement", "expected_generation": 0},
    )
    assert result["state"] == "REPLACED"
    with pytest.raises(RestoreUnavailable):
        source.require_access()
    with pytest.raises(RestoreUnavailable):
        operator.request("POST", "/nodes", {"node_id": "source", "role": "source"})
    assert clients["replacement"].require_access()["allowed"]
    with pytest.raises(RestoreUnavailable):
        source.request(
            "POST",
            "/operations/prepare",
            {"operation_id": "5" * 32, "expected_generation": 0, "manifest": {}},
        )
