"""Administration of local accounts (desktop profile, AUTH_MODE=local).

Only administrators with an active membership may use these endpoints. Every
change is recorded in the transactional audit outbox. An administrator cannot
deactivate their own account or the last active administrator.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from shift_scheduler.api.auth import local
from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.settings import AuthMode, get_auth_mode
from shift_scheduler.api.dependencies import require_roles

router = APIRouter(prefix="/local-accounts", tags=["local-accounts"])
Admin = Depends(require_roles(AppRole.ADMIN))

_LOGIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
_SCOPE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}/[a-z0-9][a-z0-9_-]{0,62}$")
_ROLES = {AppRole.ADMIN.value, AppRole.LEADER.value, AppRole.PHARMACIST.value}


def _require_local() -> None:
    if get_auth_mode() != AuthMode.LOCAL:
        raise HTTPException(status_code=404, detail="Not available")


class Membership(BaseModel):
    scope_id: str
    role: str
    active: bool


class AccountView(BaseModel):
    account_id: str
    login_id: str
    display_name: str
    role: str
    person_id: str | None
    active: bool
    locked: bool
    must_change_password: bool
    created_at: datetime
    memberships: list[Membership]


class NewAccount(BaseModel):
    login_id: str = Field(..., min_length=3, max_length=64)
    display_name: str = Field(..., min_length=1, max_length=128)
    role: str
    scope_id: str = Field(..., min_length=3, max_length=127)
    person_id: str | None = Field(default=None, max_length=64)


class IssuedPassword(BaseModel):
    account_id: str
    temporary_password: str


def _admin_scopes(session: Session, user: UserPrincipal) -> set[str]:
    from shift_scheduler.api.routers.planning import memberships

    return {
        m.scope_id for m in memberships(session, user) if m.role == AppRole.ADMIN.value
    }


def _view(session: Session, account) -> AccountView:  # type: ignore[no-untyped-def]
    from shift_scheduler.db.planning_models import AccountMembership

    rows = session.scalars(
        select(AccountMembership).where(
            AccountMembership.issuer == local.issuer(),
            AccountMembership.subject == account.account_id,
        )
    ).all()
    locked_until = account.locked_until
    if locked_until is not None and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    return AccountView(
        account_id=account.account_id,
        login_id=account.login_id,
        display_name=account.display_name,
        role=account.role,
        person_id=account.person_id,
        active=account.active,
        locked=bool(locked_until and locked_until > datetime.now(UTC)),
        must_change_password=account.must_change_password,
        created_at=account.created_at,
        memberships=[
            Membership(scope_id=m.scope_id, role=m.role, active=m.active) for m in rows
        ],
    )


def _scope_of(session: Session, account_id: str) -> str:
    from shift_scheduler.db.planning_models import AccountMembership

    scope = session.scalar(
        select(AccountMembership.scope_id).where(
            AccountMembership.issuer == local.issuer(),
            AccountMembership.subject == account_id,
        )
    )
    return scope or "local"


@router.get("", response_model=list[AccountView])
def list_accounts(response: Response, user: UserPrincipal = Admin) -> list[AccountView]:
    _require_local()
    from shift_scheduler.db.planning_models import LocalAccount
    from shift_scheduler.db.session import get_session_factory

    response.headers["Cache-Control"] = "no-store"
    with get_session_factory()() as session:
        scopes = _admin_scopes(session, user)
        accounts = session.scalars(
            select(LocalAccount).order_by(LocalAccount.login_id)
        ).all()
        # Only accounts belonging to a department this administrator manages.
        return [
            _view(session, a)
            for a in accounts
            if _scope_of(session, a.account_id) in scopes
        ]


@router.post("", response_model=IssuedPassword, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: NewAccount, user: UserPrincipal = Admin
) -> IssuedPassword:
    _require_local()
    if not _LOGIN.fullmatch(payload.login_id):
        raise HTTPException(
            422, "ログインIDは半角英数字と . _ - の3〜64文字にしてください。"
        )
    if payload.role not in _ROLES:
        raise HTTPException(
            422, "役割は ADMIN、LEADER、PHARMACIST のいずれかにしてください。"
        )
    if not _SCOPE.fullmatch(payload.scope_id):
        raise HTTPException(422, "所属は「施設ID/部署ID」の形にしてください。")
    temporary = local.temporary_password()
    password_hash = await run_in_threadpool(local.hash_password, temporary)

    def _create() -> str:
        from shift_scheduler.application.planning import emit
        from shift_scheduler.db.planning_models import AccountMembership, LocalAccount
        from shift_scheduler.db.session import get_session_factory

        account_id = uuid4().hex
        with get_session_factory().begin() as session:
            if payload.scope_id not in _admin_scopes(session, user):
                raise HTTPException(403, "この所属の管理者ではありません。")
            if session.scalar(
                select(LocalAccount.account_id).where(
                    LocalAccount.login_id == payload.login_id
                )
            ):
                raise HTTPException(409, "このログインIDは既に使われています。")
            session.add(
                LocalAccount(
                    account_id=account_id,
                    login_id=payload.login_id,
                    display_name=payload.display_name,
                    role=payload.role,
                    person_id=payload.person_id,
                    password_hash=password_hash,
                    must_change_password=True,
                    created_by=user.user_id,
                )
            )
            session.add(
                AccountMembership(
                    membership_id=uuid4().hex,
                    issuer=local.issuer(),
                    subject=account_id,
                    person_id=payload.person_id or account_id,
                    scope_id=payload.scope_id,
                    role=payload.role,
                    active=True,
                    created_by=user.user_id,
                )
            )
            emit(
                session,
                payload.scope_id,
                user.user_id,
                "local_account.created",
                {"account_id": account_id, "role": payload.role},
            )
        return account_id

    account_id = await run_in_threadpool(_create)
    return IssuedPassword(account_id=account_id, temporary_password=temporary)


def _load_for_admin(session: Session, account_id: str, user: UserPrincipal):  # type: ignore[no-untyped-def]
    from shift_scheduler.db.planning_models import LocalAccount

    account = session.get(LocalAccount, account_id, with_for_update=True)
    if account is None:
        raise HTTPException(404, "Account not found")
    if _scope_of(session, account_id) not in _admin_scopes(session, user):
        raise HTTPException(403, "この所属の管理者ではありません。")
    return account


@router.post("/{account_id}/reset-password", response_model=IssuedPassword)
async def reset_password(
    account_id: str, user: UserPrincipal = Admin
) -> IssuedPassword:
    _require_local()
    temporary = local.temporary_password()
    password_hash = await run_in_threadpool(local.hash_password, temporary)

    def _reset() -> None:
        from shift_scheduler.application.planning import emit
        from shift_scheduler.db.session import get_session_factory

        with get_session_factory().begin() as session:
            account = _load_for_admin(session, account_id, user)
            account.password_hash = password_hash
            account.must_change_password = True
            account.failed_count = 0
            account.locked_until = None
            account.password_changed_at = datetime.now(UTC)
            emit(
                session,
                _scope_of(session, account_id),
                user.user_id,
                "local_account.password_reset",
                {"account_id": account_id},
            )

    await run_in_threadpool(_reset)
    return IssuedPassword(account_id=account_id, temporary_password=temporary)


@router.post("/{account_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
def unlock(account_id: str, user: UserPrincipal = Admin) -> Response:
    _require_local()
    from shift_scheduler.application.planning import emit
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory().begin() as session:
        account = _load_for_admin(session, account_id, user)
        account.failed_count = 0
        account.locked_until = None
        emit(
            session,
            _scope_of(session, account_id),
            user.user_id,
            "local_account.unlocked",
            {"account_id": account_id},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{account_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate(account_id: str, user: UserPrincipal = Admin) -> Response:
    _require_local()
    from shift_scheduler.application.planning import emit
    from shift_scheduler.db.planning_models import AccountMembership, LocalAccount
    from shift_scheduler.db.session import get_session_factory

    if account_id == user.user_id:
        raise HTTPException(409, "自分自身のアカウントは無効にできません。")
    with get_session_factory().begin() as session:
        account = _load_for_admin(session, account_id, user)
        if account.role == AppRole.ADMIN.value and account.active:
            others = session.scalars(
                select(LocalAccount.account_id)
                .where(
                    LocalAccount.role == AppRole.ADMIN.value,
                    LocalAccount.active.is_(True),
                    LocalAccount.account_id != account_id,
                )
                .with_for_update()
            ).all()
            if not others:
                raise HTTPException(409, "最後の管理者は無効にできません。")
        account.active = False
        now = datetime.now(UTC)
        for membership in session.scalars(
            select(AccountMembership).where(
                AccountMembership.issuer == local.issuer(),
                AccountMembership.subject == account_id,
                AccountMembership.active.is_(True),
            )
        ):
            membership.active = False
            membership.deactivated_at = now
        emit(
            session,
            _scope_of(session, account_id),
            user.user_id,
            "local_account.deactivated",
            {"account_id": account_id},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
