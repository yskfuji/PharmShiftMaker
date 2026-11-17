"""Authority-aware restore: external quarantine survives restored DB contents."""

import os
from collections.abc import Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.control.client import AuthorityClient
from shift_scheduler.db.restore_lock import RESTORE_LOCK
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import quarantine, replay


def restore_with_authority(
    factory: sessionmaker[Session],
    operator: AuthorityClient,
    node_id: str,
    secret: bytes,
    artifacts: list[dict[str, Any]] | None = None,
    *,
    verifier_private_key: bytes | None = None,
    business_verifier: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    if not node_id:
        raise ValueError("An independently enrolled restore node is required")
    operator.request("POST", f"/nodes/{node_id}/quarantine")
    engine = factory.kw["bind"]
    if engine.dialect.name != "postgresql":
        raise ValueError("Measured restore release requires PostgreSQL")
    key = verifier_private_key or bytes.fromhex(
        os.environ.get("PHARMSHIFT_RESTORE_VERIFIER_PRIVATE_KEY", "")
    )
    if len(key) != 32:
        raise ValueError("Preconfigured restore verifier private key required")
    with engine.connect() as guard:
        if not guard.scalar(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": RESTORE_LOCK}
        ):
            raise ValueError(
                "Active application transactions prevent restore verification"
            )
        try:
            with factory.begin() as session:
                quarantine(session)
            current = operator.request("GET", "/manifest")
            if not current["manifest"]:
                raise ValueError(
                    "No authoritative manifest has been committed; keep restore blocked"
                )
            with factory.begin() as session:
                result = replay(
                    session,
                    current["manifest"],
                    current["manifest_hash"],
                    secret,
                    artifacts,
                )
            business = business_verifier() if business_verifier else None
            challenge = operator.request("POST", f"/nodes/{node_id}/verification")
            from shift_scheduler.control.restore_verification import attest

            measured = attest(factory, node_id, current, challenge, result, key)
            released = operator.request(
                "POST",
                f"/nodes/{node_id}/release",
                {
                    "expected_generation": current["generation"],
                    "manifest_hash": current["manifest_hash"],
                    "verification_hash": content_hash(measured["payload"]),
                    "attestation": measured,
                },
            )
            return {
                "result": result,
                "generation": current["generation"],
                "node_id": node_id,
                "attestation": measured,
                "authority": released,
                "business_verification": business,
            }
        finally:
            guard.execute(
                text("SELECT pg_advisory_unlock(:key)"), {"key": RESTORE_LOCK}
            )
