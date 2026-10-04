"""Independent witness counterexamples; authority and witness use separate stores."""

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.control.service import (
    ControlBase,
    Head,
    Node,
    Operation,
    create_app,
)
from shift_scheduler.control.witness import (
    Checkpoint,
    WitnessBase,
    authority_digest,
    create_witness,
)
from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash


@pytest.fixture
def witnessed(tmp_path):
    authority_engine = create_engine("sqlite:///" + str(tmp_path / "authority.db"))
    witness_engine = create_engine("sqlite:///" + str(tmp_path / "witness.db"))
    ControlBase.metadata.create_all(authority_engine)
    WitnessBase.metadata.create_all(witness_engine)
    authority, witness = sessionmaker(authority_engine), sessionmaker(witness_engine)
    with authority.begin() as s:
        s.add(Head(id=1, generation=0))
        initial = authority_digest(s)
    with witness.begin() as s:
        s.add(Checkpoint(id=1, sequence=0, digest=initial))
    key = Ed25519PrivateKey.generate()
    witness_web = TestClient(
        create_witness(witness, key.private_bytes_raw(), "authority", "w" * 32)
    )

    def bridge(web):
        def send(request):
            r = web.request(
                request.method,
                request.url.path,
                content=request.content,
                headers=dict(request.headers),
            )
            return httpx.Response(r.status_code, content=r.content, request=request)

        return httpx.MockTransport(send)

    checkpoint = AuthorityClient(
        "http://witness",
        "authority",
        "w" * 32,
        key.public_key().public_bytes_raw().hex(),
        transport=bridge(witness_web),
    )
    akey = Ed25519PrivateKey.generate()
    credentials = {
        r: {"role": r, "token": r * 32} for r in ("source", "operator", "restore")
    }
    web = TestClient(
        create_app(authority, akey.private_bytes_raw(), credentials, witness=checkpoint)
    )
    clients = {
        r: AuthorityClient(
            "http://authority",
            r,
            c["token"],
            akey.public_key().public_bytes_raw().hex(),
            transport=bridge(web),
        )
        for r, c in credentials.items()
    }
    for role in ("source", "restore"):
        clients["operator"].request("POST", "/nodes", {"node_id": role, "role": role})
    yield clients, authority, checkpoint, witness
    web.close()
    witness_web.close()
    authority_engine.dispose()
    witness_engine.dispose()


def commit_one(source):
    source.request(
        "POST",
        "/operations/prepare",
        {
            "operation_id": "a" * 32,
            "expected_generation": 0,
            "manifest": {"synthetic": True},
        },
    )
    source.request(
        "POST",
        "/operations/" + "a" * 32 + "/commit",
        {"manifest_hash": content_hash({"synthetic": True}), "receipt_hash": "b" * 64},
    )


def test_authority_rollback_blocks_status_manifest_and_restore_release(witnessed):
    clients, db, _, witness = witnessed
    assert clients["source"].require_access()["generation"] == 0
    commit_one(clients["source"])
    assert clients["source"].require_access()["generation"] == 1
    # Recreate a formerly valid authority state; the external checkpoint survives.
    with db.begin() as s:
        s.execute(delete(Operation))
        h = s.get(Head, 1)
        h.generation, h.pending, h.operation_id = 0, None, None
        s.get(Node, "source").applied_generation = 0
    for client, method, path, body in [
        ("source", "GET", "/status", None),
        ("operator", "GET", "/manifest", None),
        (
            "operator",
            "POST",
            "/nodes/restore/release",
            {
                "expected_generation": 0,
                "manifest_hash": content_hash({}),
                "verification_hash": "c" * 64,
            },
        ),
    ]:
        with pytest.raises(RestoreUnavailable):
            clients[client].request(method, path, body)
    with witness() as s:
        assert s.get(Checkpoint, 1).sequence == 4


def test_lost_witness_ack_reconciles_only_durable_after_image(witnessed, monkeypatch):
    clients, db, checkpoint, witness = witnessed
    original = checkpoint.request

    def fail(method, path, body=None):
        if path.startswith("/commit/"):
            raise RestoreUnavailable("Injected ACK loss")
        return original(method, path, body)

    monkeypatch.setattr(checkpoint, "request", fail)
    with pytest.raises(RestoreUnavailable):
        clients["source"].request(
            "POST",
            "/operations/prepare",
            {
                "operation_id": "d" * 32,
                "expected_generation": 0,
                "manifest": {"synthetic": 2},
            },
        )
    with db() as s:
        assert s.get(Head, 1).pending == "d" * 32
    with witness() as s:
        assert s.get(Checkpoint, 1).pending is not None
    monkeypatch.setattr(checkpoint, "request", original)
    assert clients["source"].request("GET", "/status")["allowed"] is False
    with witness() as s:
        assert s.get(Checkpoint, 1).pending is None
    # Source application commit is still not proved, hence pending at the authority.
    with pytest.raises(RestoreUnavailable):
        clients["operator"].request("GET", "/manifest")


def test_prepare_ack_loss_before_db_commit_never_self_cancels(witnessed, monkeypatch):
    clients, db, checkpoint, witness = witnessed
    original = checkpoint.request

    def fail(method, path, body=None):
        result = original(method, path, body)
        if path == "/prepare":
            raise RestoreUnavailable("Injected prepare response loss")
        return result

    monkeypatch.setattr(checkpoint, "request", fail)
    with pytest.raises(RestoreUnavailable):
        clients["source"].request(
            "POST",
            "/operations/prepare",
            {
                "operation_id": "e" * 32,
                "expected_generation": 0,
                "manifest": {"synthetic": 3},
            },
        )
    monkeypatch.setattr(checkpoint, "request", original)
    with db() as s:
        assert s.get(Head, 1).pending is None
    for _ in range(2):
        with pytest.raises(RestoreUnavailable):
            clients["source"].require_access()
    with witness() as s:
        assert s.get(Checkpoint, 1).pending is not None


def test_witness_outage_and_permission_tampering_fail_closed(witnessed, monkeypatch):
    clients, db, checkpoint, _ = witnessed
    original = checkpoint.request

    def unavailable(*a, **kw):
        raise RestoreUnavailable("Isolated communication failure")

    monkeypatch.setattr(checkpoint, "request", unavailable)
    with pytest.raises(RestoreUnavailable):
        clients["source"].require_access()
    monkeypatch.setattr(checkpoint, "request", original)
    assert clients["source"].require_access()["allowed"]
    with db.begin() as s:
        s.get(Node, "restore").open = True
    with pytest.raises(RestoreUnavailable):
        clients["restore"].require_access()


def test_locked_before_image_reconciliation_is_explicit_and_sequence_is_not_reused(
    witnessed, monkeypatch
):
    clients, db, checkpoint, journal = witnessed
    original = checkpoint.request

    def lose_prepare(method, path, body=None):
        result = original(method, path, body)
        if path == "/prepare":
            raise RestoreUnavailable("Injected prepared ACK loss")
        return result

    monkeypatch.setattr(checkpoint, "request", lose_prepare)
    with pytest.raises(RestoreUnavailable):
        clients["source"].request(
            "POST",
            "/operations/prepare",
            {
                "operation_id": "f" * 32,
                "expected_generation": 0,
                "manifest": {"synthetic": 4},
            },
        )
    monkeypatch.setattr(checkpoint, "request", original)
    with pytest.raises(RestoreUnavailable):
        clients["source"].require_access()
    with pytest.raises(RestoreUnavailable):
        clients["source"].request("POST", "/witness/reconcile")
    result = clients["operator"].request("POST", "/witness/reconcile")
    assert result["state"] == "ABORTED"
    from shift_scheduler.control.witness import IntentResolution

    with journal() as s:
        proof = s.scalar(select(IntentResolution))
        assert proof and len(proof.verification_hash) == 64
        assert s.get(Checkpoint, 1).sequence == 3
    assert clients["source"].require_access()["allowed"]
    commit_one(clients["source"])
    assert clients["source"].require_access()["generation"] == 1


def test_reconciliation_does_not_legitimize_unknown_authority_image(witnessed):
    clients, db, _, _ = witnessed
    with db.begin() as s:
        s.get(Node, "source").open = False
    with pytest.raises(RestoreUnavailable):
        clients["operator"].request("POST", "/witness/reconcile")
