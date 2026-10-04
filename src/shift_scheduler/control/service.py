"""Single-writer, separately persisted control authority.

Prepare is durable before the application commit. Ambiguous outcomes remain
pending, never expire into success. Readers must obtain a fresh signed response.
The signing private key is not distributed to the application or restore host.
"""

import hmac
import os
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Boolean, Integer, String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from shift_scheduler.domain.planning import content_hash


class ControlBase(DeclarativeBase):
    pass


class Head(ControlBase):
    __tablename__ = "authority_head"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    generation: Mapped[int] = mapped_column(Integer, default=0)
    pending: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Operation(ControlBase):
    __tablename__ = "authority_operations"
    operation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(128))
    expected_generation: Mapped[int] = mapped_column(Integer)
    manifest_hash: Mapped[str] = mapped_column(String(64))
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(32), default="PREPARED")
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON)


class Node(ControlBase):
    __tablename__ = "authority_nodes"
    node_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    role: Mapped[str] = mapped_column(String(32))
    applied_generation: Mapped[int] = mapped_column(Integer, default=0)
    open: Mapped[bool] = mapped_column(Boolean, default=False)


class Value(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Prepare(Value):
    operation_id: str = Field(pattern=r"^[a-f0-9]{32,64}$")
    expected_generation: int = Field(ge=0)
    manifest: dict[str, Any]


class Confirm(Value):
    manifest_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    receipt_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Enroll(Value):
    node_id: str = Field(min_length=1, max_length=128)
    role: str = Field(pattern="^(source|restore)$")


class Release(Value):
    expected_generation: int = Field(ge=0)
    manifest_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    verification_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    attestation: dict[str, Any]


class FenceRequest(Value):
    operation_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    expected_generation: int = Field(ge=0)
    reason: str = Field(min_length=10, max_length=2000)


class WriterTransfer(Value):
    fence_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    new_node_id: str = Field(min_length=1, max_length=128)
    expected_generation: int = Field(ge=0)


class RollbackProof(Value):
    fence_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    reason: str = Field(min_length=10, max_length=2000)
    verification_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class BeginsTransactions(Protocol):
    def begin(self) -> AbstractContextManager[Session]: ...


Actor = tuple[str, str]  # (client id, role)


def create_app(
    factory: BeginsTransactions,
    private_key: bytes,
    credentials: dict[str, dict[str, str]],
    *,
    witness: Any = None,
    timing_observer: Callable[[dict[str, Any]], None] | None = None,
    restore_verifiers: dict[str, dict[str, Any]] | None = None,
) -> FastAPI:
    """Credentials map client id to role/token, provided from a secret store."""
    signer = Ed25519PrivateKey.from_private_bytes(private_key)
    # Out-of-band deployment trust roots, never accepted from a release caller.
    restore_verifiers = restore_verifiers or {}
    for trusted in restore_verifiers.values():
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(trusted["public_key"]))
        if (
            not trusted.get("domains")
            or len(trusted["domains"]) != len(set(trusted["domains"]))
            or any(
                len(trusted.get(k, "")) != 64 for k in ("target_hash", "policy_hash")
            )
        ):
            raise ValueError("Incomplete restore verifier trust root")
    if not credentials or any(len(c["token"]) < 32 for c in credentials.values()):
        raise ValueError(
            "Independent service credentials of at least 32 characters required"
        )
    raw_factory = factory
    app = FastAPI(
        title="PharmShift independent control authority", docs_url=None, redoc_url=None
    )
    from shift_scheduler.db.restore_lock import RestoreUnavailable

    if witness is None and os.getenv("PHARMSHIFT_ENV") == "production":
        raise ValueError(
            "Production authority requires an independent generation witness"
        )
    if witness is not None:
        from shift_scheduler.control.witness import WitnessedFactory

        factory = WitnessedFactory(factory, witness, observer=timing_observer)

    @app.exception_handler(RestoreUnavailable)
    async def unavailable(_request: Request, _error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": "Control checkpoint is unavailable or unresolved"},
            headers={"Cache-Control": "no-store"},
        )

    def identity(
        authorization: str = Header(default=""),
        x_control_client: str = Header(default=""),
    ) -> Actor:
        configured = credentials.get(x_control_client)
        if not configured or not hmac.compare_digest(
            "Bearer " + configured["token"], authorization
        ):
            raise HTTPException(401, "Service authentication required")
        return x_control_client, configured["role"]

    def signed(request: Request, client: str, body: Any) -> dict[str, Any]:
        nonce = request.headers.get("x-control-nonce", "")
        if not 32 <= len(nonce) <= 128:
            raise HTTPException(400, "A fresh bounded nonce is required")
        payload = {"client_id": client, "nonce": nonce, "body": body}
        return {
            "payload": payload,
            "signature": signer.sign(bytes.fromhex(content_hash(payload))).hex(),
        }

    def locked(session: Session) -> Head:
        head = session.scalar(select(Head).where(Head.id == 1).with_for_update())
        if not head:
            raise HTTPException(503, "Authority is not initialized")
        return head

    def operator(actor: Actor) -> None:
        if actor[1] != "operator":
            raise HTTPException(403, "Independent operator credential required")

    @app.get("/healthz", response_model=None)
    def health() -> dict[str, str]:
        return {"service": "control-authority"}

    @app.get("/status", response_model=None)
    def status(request: Request, actor: Actor = Depends(identity)) -> dict[str, Any]:
        with factory.begin() as session:
            head = locked(session)
            node = session.get(Node, actor[0])
            allowed = bool(
                node
                and node.open
                and node.applied_generation == head.generation
                and not head.pending
            )
            return signed(
                request,
                actor[0],
                {
                    "generation": head.generation,
                    "pending_operation_id": head.pending,
                    "allowed": allowed,
                    "applied_generation": node.applied_generation if node else None,
                    "reason": (
                        None
                        if allowed
                        else "pending, unregistered, isolated or stale control generation"
                    ),
                },
            )

    @app.post("/nodes", response_model=None)
    def enroll(
        value: Enroll, request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        operator(actor)
        if (
            value.node_id not in credentials
            or credentials[value.node_id]["role"] != value.role
        ):
            raise HTTPException(422, "Node credential role mismatch")
        with factory.begin() as session:
            head = locked(session)
            old = session.get(Node, value.node_id)
            if old:
                if old.role != value.role:
                    raise HTTPException(409, "Node role is immutable")
            else:
                if value.role == "source" and (
                    head.generation
                    or session.scalar(select(Node).where(Node.role == "source"))
                ):
                    raise HTTPException(
                        409, "Only one initially enrolled source is supported"
                    )
                session.add(
                    Node(
                        node_id=value.node_id,
                        role=value.role,
                        applied_generation=0,
                        open=value.role == "source",
                    )
                )
            return signed(request, actor[0], {"node_id": value.node_id})

    @app.post("/operations/prepare", response_model=None)
    def prepare(
        value: Prepare, request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        if actor[1] != "source":
            raise HTTPException(403, "Source credential required")
        digest = content_hash(value.manifest)
        with factory.begin() as session:
            head = locked(session)
            node = session.get(Node, actor[0])
            if not node or not node.open or node.role != "source":
                raise HTTPException(403, "Source is not enrolled")
            old = session.get(Operation, value.operation_id)
            if old:
                if (
                    old.source_id != actor[0]
                    or old.manifest_hash != digest
                    or old.expected_generation != value.expected_generation
                ):
                    raise HTTPException(409, "Operation identity reused")
                return signed(
                    request,
                    actor[0],
                    {
                        "operation_id": old.operation_id,
                        "state": old.state,
                        "manifest_hash": digest,
                    },
                )
            if head.pending or head.generation != value.expected_generation:
                raise HTTPException(
                    409, "A control operation is pending or generation changed"
                )
            session.add(
                Operation(
                    operation_id=value.operation_id,
                    source_id=actor[0],
                    expected_generation=head.generation,
                    manifest_hash=digest,
                    manifest=value.manifest,
                    state="PREPARED",
                    evidence={"prepared_at": datetime.now(UTC).isoformat()},
                )
            )
            head.pending = value.operation_id
            return signed(
                request,
                actor[0],
                {
                    "operation_id": value.operation_id,
                    "state": "PREPARED",
                    "manifest_hash": digest,
                },
            )

    @app.post("/operations/{operation_id}/commit", response_model=None)
    def commit(
        operation_id: str,
        value: Confirm,
        request: Request,
        actor: Actor = Depends(identity),
    ) -> dict[str, Any]:
        with factory.begin() as session:
            head = locked(session)
            row = session.get(Operation, operation_id)
            if actor[1] != "source" or not row or row.source_id != actor[0]:
                raise HTTPException(403, "Source operation ownership required")
            node = session.get(Node, actor[0])
            if not node or not node.open or node.role != "source":
                raise HTTPException(403, "Source writer has been fenced")
            if row.manifest_hash != value.manifest_hash:
                raise HTTPException(409, "Manifest changed")
            if row.state == "COMMITTED":
                if row.evidence.get("receipt_hash") != value.receipt_hash:
                    raise HTTPException(409, "Commit receipt changed")
            else:
                if (
                    row.state != "PREPARED"
                    or head.pending != operation_id
                    or head.generation != row.expected_generation
                ):
                    raise HTTPException(409, "Operation is not pending")
                row.state = "COMMITTED"
                row.evidence = {
                    **row.evidence,
                    "receipt_hash": value.receipt_hash,
                    "committed_at": datetime.now(UTC).isoformat(),
                }
                head.generation += 1
                head.pending = None
                head.operation_id = operation_id
                node.applied_generation = (
                    head.generation
                )  # same identity-mapped row as above
            return signed(
                request, actor[0], {"generation": head.generation, "state": row.state}
            )

    @app.post("/operations/{operation_id}/verified-rollback", response_model=None)
    def rollback(
        operation_id: str,
        value: RollbackProof,
        request: Request,
        actor: Actor = Depends(identity),
    ) -> dict[str, Any]:
        operator(actor)
        with factory.begin() as session:
            head = locked(session)
            row = session.get(Operation, operation_id)
            if not row or row.state != "PREPARED" or head.pending != operation_id:
                raise HTTPException(409, "Not an unresolved preparation")
            fence = session.get(Operation, value.fence_id)
            node = session.get(Node, row.source_id)
            if (
                not fence
                or fence.state != "NODE_FENCED"
                or fence.source_id != row.source_id
                or not node
                or node.open
            ):
                raise HTTPException(
                    409, "A durable writer fence is required before rollback"
                )
            # This is an explicit operator decision with independently retained proof,
            # not automatic inference from timeout or absence in a restored database.
            row.state = "ABORTED"
            row.evidence = {
                **row.evidence,
                "rollback_proof": value.model_dump(),
                "operator": actor[0],
            }
            head.pending = None
            return signed(request, actor[0], {"state": "ABORTED"})

    @app.get("/manifest", response_model=None)
    def manifest(request: Request, actor: Actor = Depends(identity)) -> dict[str, Any]:
        with factory.begin() as session:
            head = locked(session)
            if head.pending:
                raise HTTPException(409, "Unresolved preparation prevents restore")
            row = (
                session.get(Operation, head.operation_id) if head.operation_id else None
            )
            return signed(
                request,
                actor[0],
                {
                    "generation": head.generation,
                    "manifest": row.manifest if row else {},
                    "manifest_hash": row.manifest_hash if row else content_hash({}),
                },
            )

    @app.post("/nodes/{node_id}/quarantine", response_model=None)
    def quarantine(
        node_id: str, request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        operator(actor)
        with factory.begin() as session:
            head = locked(session)
            row = session.get(Node, node_id)
            if not row or row.role != "restore":
                raise HTTPException(404, "Restore node not found")
            row.open = False
            manifest = (
                session.get(Operation, head.operation_id) if head.operation_id else None
            )
            if manifest:
                evidence = dict(manifest.evidence)
                evidence.pop("restore-challenge:" + node_id, None)
                manifest.evidence = evidence
            return signed(request, actor[0], {"state": "QUARANTINED"})

    @app.post("/nodes/{node_id}/verification", response_model=None)
    def verification(
        node_id: str, request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        operator(actor)
        with factory.begin() as session:
            head = locked(session)
            node = session.get(Node, node_id)
            manifest = (
                session.get(Operation, head.operation_id) if head.operation_id else None
            )
            trusted = restore_verifiers.get(node_id)
            if (
                not node
                or node.role != "restore"
                or node.open
                or not manifest
                or head.pending
                or not trusted
            ):
                raise HTTPException(
                    409,
                    "Quarantined target, committed controls and preconfigured verifier are required",
                )
            challenge = {
                "challenge": uuid4().hex,
                "generation": head.generation,
                "manifest_hash": manifest.manifest_hash,
                **{k: trusted[k] for k in ("target_hash", "policy_hash", "domains")},
            }
            manifest.evidence = {
                **manifest.evidence,
                "restore-challenge:" + node_id: challenge,
            }
            return signed(request, actor[0], challenge)

    @app.post("/nodes/{node_id}/release", response_model=None)
    def release(
        node_id: str, value: Release, request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        operator(actor)
        with factory.begin() as session:
            head = locked(session)
            row = session.get(Node, node_id)
            manifest = (
                session.get(Operation, head.operation_id) if head.operation_id else None
            )
            digest = manifest.manifest_hash if manifest else content_hash({})
            if not row or row.role != "restore":
                raise HTTPException(404, "Restore node not found")
            if (
                head.pending
                or head.generation != value.expected_generation
                or digest != value.manifest_hash
            ):
                raise HTTPException(409, "Restore verification is stale or incomplete")
            try:
                from shift_scheduler.control.restore_verification import Attestation

                trusted = restore_verifiers[node_id]
                envelope = value.attestation
                if set(envelope) != {"payload", "signature"}:
                    raise ValueError("Unknown attestation envelope")
                payload = envelope["payload"]
                if value.verification_hash != content_hash(payload):
                    raise ValueError("Attestation hash differs")
                Ed25519PublicKey.from_public_bytes(
                    bytes.fromhex(trusted["public_key"])
                ).verify(
                    bytes.fromhex(envelope["signature"]),
                    bytes.fromhex(content_hash(payload)),
                )
                proof = Attestation.model_validate(payload)
                challenge = (
                    manifest.evidence.get("restore-challenge:" + node_id)
                    if manifest
                    else None
                )
                if (
                    not challenge
                    or challenge["challenge"] != proof.challenge
                    or proof.node_id != node_id
                    or proof.generation != head.generation
                    or proof.manifest_hash != digest
                    or proof.target_hash != trusted["target_hash"]
                    or proof.policy_hash != trusted["policy_hash"]
                    or list(proof.domains) != trusted["domains"]
                    or set(proof.observation_hashes) != set(trusted["domains"])
                    or any(
                        len(h) != 64 or any(c not in "0123456789abcdef" for c in h)
                        for h in proof.observation_hashes.values()
                    )
                    or proof.observed_at.utcoffset() is None
                    or not 0
                    <= (datetime.now(UTC) - proof.observed_at).total_seconds()
                    <= 60
                ):
                    raise ValueError(
                        "Target, domains, generation, challenge or observation age differs"
                    )
            except Exception as error:
                raise HTTPException(
                    409,
                    "Measured restore attestation is missing, changed, untrusted or stale",
                ) from error
            # Verification proof is retained on the independently signed manifest's
            # generation, and every later generation invalidates this permission.
            row.applied_generation, row.open = head.generation, True
            if manifest:
                evidence = {
                    **manifest.evidence,
                    "restore:" + node_id: value.model_dump(),
                }
                evidence.pop("restore-challenge:" + node_id, None)
                manifest.evidence = evidence
            return signed(
                request,
                actor[0],
                {
                    "state": "OPEN",
                    "generation": head.generation,
                    "verification_scope": "registered-active-restore-target-v1",
                    "all_storage_paths_verified": False,
                    "unobserved_domains": list(proof.unobserved_domains),
                    "residual_counts": proof.residual_counts,
                },
            )

    @app.post("/witness/reconcile", response_model=None)
    def reconcile_witness(
        request: Request, actor: Actor = Depends(identity)
    ) -> dict[str, Any]:
        operator(actor)
        if witness is None:
            raise HTTPException(409, "No independent witness configured")
        from shift_scheduler.control.witness import authority_digest

        # Narrow recovery bypass: lock the same head as every normal authority transaction.
        # A still-running transaction cannot commit after this before-image observation.
        with raw_factory.begin() as session:
            locked(session)
            digest = authority_digest(session)
            checkpoint = witness.request("GET", "/checkpoint")
            pending = checkpoint.get("pending")
            if not pending:
                if checkpoint["digest"] != digest:
                    raise HTTPException(409, "Authority image does not match witness")
                return signed(request, actor[0], {"state": "CONSISTENT"})
            if pending["after"] == digest:
                result = witness.request("POST", "/commit/" + pending["operation_id"])
            elif pending.get("before") == digest:
                proof = {
                    "operator": actor[0],
                    "operation_id": pending["operation_id"],
                    "sequence": checkpoint["sequence"],
                    "locked_digest": digest,
                }
                result = witness.request(
                    "POST",
                    "/verified-abort/" + pending["operation_id"],
                    {
                        "observed_digest": digest,
                        "verification_hash": content_hash(proof),
                    },
                )
            else:
                raise HTTPException(
                    409, "Neither durable before nor after image matches"
                )
            return signed(request, actor[0], result)

    @app.post("/nodes/{node_id}/fence", response_model=None)
    def fence_node(
        node_id: str,
        value: FenceRequest,
        request: Request,
        actor: Actor = Depends(identity),
    ) -> dict[str, Any]:
        operator(actor)
        with factory.begin() as session:
            head = locked(session)
            row = session.get(Node, node_id)
            if not row or row.role != "source":
                raise HTTPException(404, "Active source identity not found")
            prior = session.get(Operation, value.operation_id)
            evidence = {
                "reason": value.reason,
                "operator": actor[0],
                "node_id": node_id,
            }
            if prior:
                if (
                    prior.state != "NODE_FENCED"
                    or prior.evidence != evidence
                    or prior.expected_generation != value.expected_generation
                ):
                    raise HTTPException(409, "Fence operation identity reused")
            else:
                if head.generation != value.expected_generation:
                    raise HTTPException(409, "Control generation changed")
                row.open = False
                session.add(
                    Operation(
                        operation_id=value.operation_id,
                        source_id=node_id,
                        expected_generation=head.generation,
                        manifest={},
                        manifest_hash=content_hash({}),
                        state="NODE_FENCED",
                        evidence=evidence,
                    )
                )
            return signed(
                request, actor[0], {"state": "FENCED", "fence_id": value.operation_id}
            )

    @app.post("/nodes/{node_id}/replace-writer", response_model=None)
    def replace_writer(
        node_id: str,
        value: WriterTransfer,
        request: Request,
        actor: Actor = Depends(identity),
    ) -> dict[str, Any]:
        operator(actor)
        if (
            value.new_node_id not in credentials
            or credentials[value.new_node_id]["role"] != "source"
        ):
            raise HTTPException(
                422, "New source credential must be independently provisioned"
            )
        with factory.begin() as session:
            head = locked(session)
            old, fence = session.get(Node, node_id), session.get(
                Operation, value.fence_id
            )
            if (
                head.pending
                or head.generation != value.expected_generation
                or not old
                or old.open
            ):
                raise HTTPException(
                    409, "Pending operation, stale generation or unfenced writer"
                )
            if not fence or fence.state != "NODE_FENCED" or fence.source_id != node_id:
                raise HTTPException(409, "Wrong fence identity")
            new = session.get(Node, value.new_node_id)
            if new:
                if old.role != "retired_source" or new.role != "source" or not new.open:
                    raise HTTPException(409, "Replacement node already exists")
            else:
                if old.role != "source" or value.new_node_id == node_id:
                    raise HTTPException(409, "Source identity cannot be reused")
                old.role = "retired_source"
                session.add(
                    Node(
                        node_id=value.new_node_id,
                        role="source",
                        open=True,
                        applied_generation=head.generation,
                    )
                )
            return signed(
                request, actor[0], {"state": "REPLACED", "node_id": value.new_node_id}
            )

    return app
