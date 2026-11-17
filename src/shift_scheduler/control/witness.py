"""Independent, non-personal checkpoint journal for authority rollback detection.

The witness must not share the authority's database, storage or credentials.
An unresolved intent is never expired or cancelled merely because time passed.
"""

import hmac
import json
import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Integer, String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from shift_scheduler.db.restore_lock import RestoreUnavailable
from shift_scheduler.domain.planning import content_hash

if TYPE_CHECKING:
    from shift_scheduler.control.service import BeginsTransactions


class WitnessBase(DeclarativeBase):
    pass


class Checkpoint(WitnessBase):
    __tablename__ = "witness_checkpoint"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    digest: Mapped[str] = mapped_column(String(64))
    pending: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Intent(WitnessBase):
    __tablename__ = "witness_intents"
    operation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, unique=True)
    before: Mapped[str] = mapped_column(String(64))
    after: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16))


class IntentResolution(WitnessBase):
    __tablename__ = "witness_intent_resolutions"
    operation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    observed_digest: Mapped[str] = mapped_column(String(64))
    verification_hash: Mapped[str] = mapped_column(String(64))


class AbortProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observed_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    verification_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Transition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    sequence: int = Field(ge=0)
    before: str = Field(pattern=r"^[a-f0-9]{64}$")
    after: str = Field(pattern=r"^[a-f0-9]{64}$")


def create_witness(
    factory: sessionmaker[Session], private_key: bytes, client_id: str, token: str
) -> FastAPI:
    if len(token) < 32:
        raise ValueError("Independent witness credential required")
    signer = Ed25519PrivateKey.from_private_bytes(private_key)
    app = FastAPI(title="PharmShift generation witness", docs_url=None, redoc_url=None)

    def auth(
        authorization: str = Header(default=""),
        x_control_client: str = Header(default=""),
    ) -> None:
        if x_control_client != client_id or not hmac.compare_digest(
            authorization, "Bearer " + token
        ):
            raise HTTPException(401, "Witness authentication required")

    def signed(request: Request, body: Any) -> dict[str, Any]:
        nonce = request.headers.get("x-control-nonce", "")
        if not 32 <= len(nonce) <= 128:
            raise HTTPException(400, "Fresh nonce required")
        payload = {"client_id": client_id, "nonce": nonce, "body": body}
        return {
            "payload": payload,
            "signature": signer.sign(bytes.fromhex(content_hash(payload))).hex(),
        }

    def head(session: Session) -> Checkpoint:
        row = session.scalar(
            select(Checkpoint).where(Checkpoint.id == 1).with_for_update()
        )
        if row is None:
            raise HTTPException(503, "Witness requires explicit initialized checkpoint")
        return row

    @app.get("/checkpoint", dependencies=[Depends(auth)], response_model=None)
    def checkpoint(request: Request) -> dict[str, Any]:
        with factory.begin() as session:
            row = head(session)
            intent = session.get(Intent, row.pending) if row.pending else None
            return signed(
                request,
                {
                    "sequence": row.sequence,
                    "digest": row.digest,
                    "pending": (
                        {
                            "operation_id": intent.operation_id,
                            "before": intent.before,
                            "after": intent.after,
                            "sequence": intent.sequence,
                        }
                        if intent
                        else None
                    ),
                },
            )

    @app.post("/prepare", dependencies=[Depends(auth)], response_model=None)
    def prepare(value: Transition, request: Request) -> dict[str, Any]:
        with factory.begin() as session:
            row = head(session)
            old = session.get(Intent, value.operation_id)
            if old:
                if (old.sequence, old.before, old.after) != (
                    value.sequence + 1,
                    value.before,
                    value.after,
                ):
                    raise HTTPException(409, "Witness operation identity reused")
                return signed(request, {"state": old.state})
            if (
                row.pending
                or row.sequence != value.sequence
                or row.digest != value.before
                or value.before == value.after
            ):
                raise HTTPException(409, "Witness checkpoint changed or unresolved")
            session.add(
                Intent(
                    operation_id=value.operation_id,
                    sequence=value.sequence + 1,
                    before=value.before,
                    after=value.after,
                    state="PREPARED",
                )
            )
            row.pending = value.operation_id
            return signed(request, {"state": "PREPARED"})

    @app.post(
        "/commit/{operation_id}", dependencies=[Depends(auth)], response_model=None
    )
    def commit(operation_id: str, request: Request) -> dict[str, Any]:
        with factory.begin() as session:
            row = head(session)
            intent = session.get(Intent, operation_id)
            if intent is None:
                raise HTTPException(409, "Unknown witness intent")
            if intent.state == "COMMITTED":
                return signed(
                    request, {"state": intent.state, "sequence": intent.sequence}
                )
            if (
                row.pending != operation_id
                or row.digest != intent.before
                or row.sequence + 1 != intent.sequence
            ):
                raise HTTPException(409, "Witness intent conflicts with checkpoint")
            row.digest, row.sequence, row.pending = intent.after, intent.sequence, None
            intent.state = "COMMITTED"
            return signed(request, {"state": intent.state, "sequence": intent.sequence})

    @app.post(
        "/verified-abort/{operation_id}",
        dependencies=[Depends(auth)],
        response_model=None,
    )
    def abort(operation_id: str, value: AbortProof, request: Request) -> dict[str, Any]:
        with factory.begin() as session:
            row = head(session)
            intent = session.get(Intent, operation_id)
            if not intent or value.observed_digest != intent.before:
                raise HTTPException(409, "Missing locked before-image evidence")
            if intent.state == "ABORTED":
                proof = session.get(IntentResolution, operation_id)
                if (
                    not proof
                    or proof.observed_digest != value.observed_digest
                    or proof.verification_hash != value.verification_hash
                ):
                    raise HTTPException(409, "Abort evidence changed")
                return signed(
                    request, {"state": intent.state, "sequence": intent.sequence}
                )
            if (
                intent.state != "PREPARED"
                or row.pending != operation_id
                or row.digest != intent.before
            ):
                raise HTTPException(409, "Witness intent is not abortable")
            # Consume the sequence even on abort; it must never be reused by a later intent.
            row.sequence, row.pending = intent.sequence, None
            intent.state = "ABORTED"
            session.add(
                IntentResolution(operation_id=operation_id, **value.model_dump())
            )
            return signed(request, {"state": intent.state, "sequence": intent.sequence})

    return app


def authority_digest(session: Session) -> str:
    """Digest all authority state, including node permissions and aborted intents."""
    from shift_scheduler.control.service import ControlBase

    session.flush()
    records: dict[str, list[dict[str, Any]]] = {}
    for table in sorted(ControlBase.metadata.tables.values(), key=lambda t: t.name):
        rows = [dict(row) for row in session.execute(select(table)).mappings()]
        records[table.name] = sorted(rows, key=content_hash)
    return content_hash(records)


class WitnessedFactory:
    def __init__(
        self,
        factory: "BeginsTransactions",
        witness: Any,
        observer: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.factory, self.witness, self.observer = factory, witness, observer

    @contextmanager
    def begin(self) -> Iterator[Session]:
        from shift_scheduler.control.service import Head

        operation = None
        started = time.perf_counter()
        timings: dict[str, float] = {}

        @contextmanager
        def measured(stage: str) -> Iterator[None]:
            start = time.perf_counter()
            try:
                yield
            finally:
                timings[stage] = timings.get(stage, 0.0) + time.perf_counter() - start

        def request(method: str, path: str, body: Any = None) -> Any:
            with measured("witness_network_seconds"):
                return (
                    self.witness.request(method, path, body)
                    if body is not None
                    else self.witness.request(method, path)
                )

        outcome = "FAILED"
        try:
            with self.factory.begin() as session:
                # Query timing includes lock wait and transport; it is not pure DB lock time.
                with measured("head_query_and_lock_seconds"):
                    head = session.scalar(
                        select(Head).where(Head.id == 1).with_for_update()
                    )
                if head is None:
                    raise RestoreUnavailable("Authority not initialized")
                with measured("before_digest_seconds"):
                    before = authority_digest(session)
                checkpoint = request("GET", "/checkpoint")
                pending = checkpoint["pending"]
                if pending:
                    if pending["after"] != before:
                        raise RestoreUnavailable(
                            "Unresolved witness intent; source investigation required"
                        )
                    request("POST", "/commit/" + pending["operation_id"])
                    checkpoint = request("GET", "/checkpoint")
                if checkpoint["pending"] or checkpoint["digest"] != before:
                    raise RestoreUnavailable(
                        "Authority rollback or unregistered state change detected"
                    )
                with measured("caller_work_seconds"):
                    yield session
                with measured("after_digest_seconds"):
                    after = authority_digest(session)
                if after != before:
                    operation = uuid4().hex
                    request(
                        "POST",
                        "/prepare",
                        {
                            "operation_id": operation,
                            "sequence": checkpoint["sequence"],
                            "before": before,
                            "after": after,
                        },
                    )
                commit_started = time.perf_counter()
            timings["transaction_exit_seconds"] = time.perf_counter() - commit_started
            if operation:
                request("POST", "/commit/" + operation)
            outcome = "SUCCEEDED"
        finally:
            # No subjects, credentials, payload, operation ID or digest enters diagnostics.
            record = {
                "event": "control_witness_timing",
                "outcome": outcome,
                "total_seconds": time.perf_counter() - started,
                "stages": timings,
            }
            logging.getLogger(__name__).info("%s", json.dumps(record, sort_keys=True))
            if self.observer:
                try:
                    self.observer(record)
                except Exception:
                    # Observability must never turn a failed authorization into success,
                    # nor undo a committed operation. Missing diagnostics remain missing.
                    logging.getLogger(__name__).warning(
                        "Control timing observer failed"
                    )
