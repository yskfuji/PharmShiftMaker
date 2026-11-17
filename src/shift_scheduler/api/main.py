"""FastAPI エントリポイント (README 6.2 準拠)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.responses import Response

from shift_scheduler.api.routers import (
    artifacts,
    auth,
    compliance,
    health,
    holiday_requests,
    leave_quotas,
    planning,
    schedules,
    staff,
    workflows,
)
from shift_scheduler.db.restore_lock import RestoreUnavailable


def _resolve_cors_origins() -> list[str]:
    """環境変数から許可オリジンを取得（未設定時はローカル開発を許可）。"""

    config = os.getenv("API_CORS_ALLOW_ORIGINS")
    if not config:
        return [
            "https://localhost:3000",
            "https://127.0.0.1:3000",
            "https://localhost:4020",
            "https://127.0.0.1:4020",
        ]
    return [origin.strip() for origin in config.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from shift_scheduler.config.production import check_production

    check_production()
    yield


# The interactive /docs and /redoc pages load scripts from a CDN and cannot run
# under the API's policy; they are off. Production also hides the schema.
app = FastAPI(
    title="PharmShiftMaker API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=(
        None if os.getenv("PHARMSHIFT_ENV") == "production" else "/openapi.json"
    ),
)


@app.exception_handler(RestoreUnavailable)
async def restore_unavailable(
    _request: Request, _error: RestoreUnavailable
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "復元の隔離・検証中です。通常アクセスは停止しています。"},
        headers={"Retry-After": "30"},
    )


@app.exception_handler(OperationalError)
async def database_unavailable(
    _request: Request, error: OperationalError
) -> JSONResponse:
    # Never expose SQL, parameters, or a purported success after an ambiguous
    # commit. Retrying a mutation requires the original body/idempotency key.
    sqlite_code = getattr(error.orig, "sqlite_errorcode", 0) or 0
    state = getattr(error.orig, "sqlstate", "") or ""
    transient = (
        (sqlite_code & 255) in {5, 6}
        or state in {"40001", "40P01", "55P03", "57P01", "57P02", "57P03"}
        or state.startswith("08")
    )
    return JSONResponse(
        status_code=503 if transient else 500,
        content={
            "detail": "データベースの処理結果を確認できません。同じ内容のまま結果照会または再送してください。",
            "code": "database_retryable" if transient else "database_failure",
        },
        headers={
            "Cache-Control": "no-store",
            **({"Retry-After": "1"} if transient else {}),
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Transfer-ID", "X-Content-SHA256", "Content-Disposition"],
)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(holiday_requests.router)
app.include_router(leave_quotas.router)
app.include_router(schedules.router)
app.include_router(staff.router)
app.include_router(planning.router)
app.include_router(workflows.router)
app.include_router(compliance.router)
app.include_router(artifacts.router)


@app.get("/", tags=["meta"], summary="API root")
def root() -> dict[str, str]:
    """Return a simple landing payload for manual access."""

    return {
        "message": "PharmShiftMaker API",
        "health": "/healthz",
    }


__all__ = ["app"]


async def _browser_protection(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    from starlette.concurrency import run_in_threadpool

    from shift_scheduler.api.auth.settings import get_session_settings
    from shift_scheduler.control.client import require_access

    # Sign-out only revokes and clears the session, so it must work even while the
    # independent control state cannot be read (shared terminals).
    public = request.url.path in {
        "/",
        "/healthz",
        "/livez",
        "/control-health",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/auth/logout",
    }
    if not public and request.method != "OPTIONS":
        try:
            await run_in_threadpool(require_access)
        except RestoreUnavailable:
            return JSONResponse(
                {
                    "detail": "最新の消去・利用制限を確認できないため、個人情報の操作を停止しています。"
                },
                status_code=503,
                headers={"Cache-Control": "no-store", "Retry-After": "5"},
            )

    settings = get_session_settings()
    if (
        os.getenv("PHARMSHIFT_ENV") == "production"
        and request.method not in {"GET", "HEAD", "OPTIONS"}
        and any(
            request.url.path.startswith(prefix)
            for prefix in ("/staff", "/schedules", "/holiday-requests", "/leave-quotas")
        )
    ):
        return JSONResponse(
            {"detail": "Legacy writes are disabled; use reviewed /planning operations"},
            status_code=410,
        )
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.cookies.get(settings.cookie_name)
        and not request.headers.get("authorization", "").lower().startswith("bearer ")
        and request.headers.get("origin") not in _resolve_cors_origins()
    ):
        return JSONResponse(
            {"detail": "Cookie-authenticated writes require a trusted Origin"},
            status_code=403,
        )
    response = await call_next(request)
    if not public and request.method != "OPTIONS":
        try:
            await run_in_threadpool(require_access)
        except RestoreUnavailable:
            return JSONResponse(
                {
                    "detail": "制御状態が変更されました。処理結果を確認してから再送してください。"
                },
                status_code=503,
                headers={"Cache-Control": "no-store"},
            )
    return response


SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    # The API answers with data, never with pages: a response opened in a browser
    # runs nothing and cannot be framed.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@app.middleware("http")
async def browser_protection(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Every response, including early refusals (403/410/503), carries the headers.
    response = await _browser_protection(request, call_next)
    for name, value in SECURITY_HEADERS.items():
        response.headers[name] = value
    return response
