"""First-run setup of the desktop profile (AUTH_MODE=local).

The desktop shell generates a one-time setup token, passes it to the API through
the environment and attaches it as ``X-Setup-Token`` only to requests from its own
window. The bootstrap succeeds once: while no local account exists, it creates the
first administrator and the administrator's membership for one department.
"""

from __future__ import annotations

import hmac
import os
import re
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from starlette.concurrency import run_in_threadpool

from shift_scheduler.api.auth import local
from shift_scheduler.api.auth.models import AppRole
from shift_scheduler.api.auth.settings import AuthMode, get_auth_mode

router = APIRouter(prefix="/setup", tags=["setup"])

_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_LOGIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")


def _require_local() -> None:
    if get_auth_mode() != AuthMode.LOCAL:
        raise HTTPException(status_code=404, detail="Not available")


class SetupStatus(BaseModel):
    initialized: bool


class Bootstrap(BaseModel):
    login_id: str = Field(..., min_length=3, max_length=64)
    display_name: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)
    facility_id: str = Field(..., min_length=1, max_length=63)
    department_id: str = Field(..., min_length=1, max_length=63)


class BootstrapResult(BaseModel):
    account_id: str
    scope_id: str


def _initialized() -> bool:
    from shift_scheduler.db.planning_models import LocalAccount
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory()() as session:
        return bool(session.scalar(select(func.count()).select_from(LocalAccount)))


@router.get("/status", response_model=SetupStatus)
async def setup_status(response: Response) -> SetupStatus:
    _require_local()
    response.headers["Cache-Control"] = "no-store"
    return SetupStatus(initialized=await run_in_threadpool(_initialized))


def _check_token(supplied: str | None) -> None:
    expected = os.getenv("PHARMSHIFT_SETUP_TOKEN", "")
    if (
        len(expected) < 32
        or not supplied
        or not hmac.compare_digest(supplied.encode(), expected.encode())
    ):
        raise HTTPException(status_code=403, detail="Setup is not permitted")


@router.post(
    "/bootstrap", response_model=BootstrapResult, status_code=status.HTTP_201_CREATED
)
async def bootstrap(
    payload: Bootstrap, x_setup_token: str | None = Header(default=None)
) -> BootstrapResult:
    _require_local()
    _check_token(x_setup_token)
    if not _LOGIN.fullmatch(payload.login_id):
        raise HTTPException(
            422, "ログインIDは半角英数字と . _ - の3〜64文字にしてください。"
        )
    if not (
        _ID.fullmatch(payload.facility_id) and _ID.fullmatch(payload.department_id)
    ):
        raise HTTPException(
            422, "施設IDと部署IDは半角英小文字・数字・_ - にしてください。"
        )
    try:
        local.check_policy(payload.password, payload.login_id)
    except local.PasswordPolicyError as exc:
        raise HTTPException(422, str(exc)) from exc
    password_hash = await run_in_threadpool(local.hash_password, payload.password)
    return await run_in_threadpool(_create_first_admin, payload, password_hash)


def _create_first_admin(payload: Bootstrap, password_hash: str) -> BootstrapResult:
    from shift_scheduler.application.planning import emit
    from shift_scheduler.db.planning_models import AccountMembership, LocalAccount
    from shift_scheduler.db.session import get_session_factory

    scope_id = f"{payload.facility_id}/{payload.department_id}"
    account_id = uuid4().hex
    with get_session_factory().begin() as session:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            # Two concurrent bootstraps cannot both see an empty table.
            session.execute(text("LOCK TABLE local_accounts IN EXCLUSIVE MODE"))
        if session.scalar(select(func.count()).select_from(LocalAccount)):
            raise HTTPException(409, "Setup has already been completed")
        session.add(
            LocalAccount(
                account_id=account_id,
                login_id=local.normalize_login(payload.login_id),
                display_name=payload.display_name,
                role=AppRole.ADMIN.value,
                scope_id=scope_id,
                person_id=None,
                password_hash=password_hash,
                must_change_password=False,
                created_by="setup",
            )
        )
        session.add(
            AccountMembership(
                membership_id=uuid4().hex,
                issuer=local.issuer(),
                subject=account_id,
                person_id=account_id,
                scope_id=scope_id,
                role=AppRole.ADMIN.value,
                active=True,
                created_by="setup",
            )
        )
        emit(
            session,
            scope_id,
            account_id,
            "local_account.bootstrap",
            {"account_id": account_id, "role": AppRole.ADMIN.value},
        )
    return BootstrapResult(account_id=account_id, scope_id=scope_id)


__all__ = ["router"]
