"""Health and readiness probes for FastAPI deployment."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from shift_scheduler.db.session import get_engine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get(
    "/control-health", summary="Non-personal control availability", response_model=None
)
def control_health() -> dict[str, str]:
    from shift_scheduler.control.client import configured_client
    from shift_scheduler.db.restore_lock import RestoreUnavailable

    try:
        client = configured_client()
        if client is None:
            return {"state": "UNCONFIGURED", "personal_data_access": "development-only"}
        client.require_access()
        return {"state": "AVAILABLE", "personal_data_access": "enabled"}
    except RestoreUnavailable:
        return {"state": "BLOCKED", "personal_data_access": "disabled"}


@router.get("/livez", summary="Liveness probe")
def livez() -> dict[str, str]:
    """Return OK when the process is alive."""

    return {"status": "ok"}


@router.get("/healthz", summary="Readiness probe")
def healthz() -> dict[str, object]:
    """Return readiness along with dependencies status."""

    backend = os.getenv("SHIFT_SCHEDULER_DATA_BACKEND", "yaml").lower()
    details: dict[str, str] = {"database": "skipped"}

    if backend == "db":
        try:
            engine = get_engine()
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            details["database"] = "ok"
        except Exception as exc:  # noqa: BLE001
            logger.warning("Database readiness check failed", exc_info=exc)
            raise HTTPException(status_code=503, detail="database_unavailable") from exc

    return {"status": "ok", "details": details}
