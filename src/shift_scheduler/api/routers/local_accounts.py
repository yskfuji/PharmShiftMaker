"""Administration of local accounts (desktop profile, AUTH_MODE=local).

Only an administrator of the account's own department (``LocalAccount.scope_id``)
may manage it. The acting administrator is identified by the token subject
(account_id), never by a person ID. An administrator cannot deactivate their own
account or the department's last active administrator. Every change is recorded
in ``local_account_events`` in the same transaction. Deactivation and password
resets end every existing session of the account (each request re-reads the
account). Every change locks the department's administrator memberships first
(in a fixed order) and re-checks the actor among them, so two administrators
cannot remove each other concurrently.

A new account is not yet a staff member: an administrator links it once to a
person of the same department (``/person``); the link is never moved afterwards.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from shift_scheduler.api.auth import local
from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.api.auth.settings import AuthMode, get_auth_mode
from shift_scheduler.api.dependencies import require_roles
from shift_scheduler.db.planning_models import AccountMembership, LocalAccount

router = APIRouter(prefix="/local-accounts", tags=["local-accounts"])
Admin = Depends(require_roles(AppRole.ADMIN))

_LOGIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
_ROLES = {AppRole.ADMIN.value, AppRole.LEADER.value, AppRole.PHARMACIST.value}


def _require_local() -> None:
    if get_auth_mode() != AuthMode.LOCAL:
        raise HTTPException(status_code=404, detail="Not available")


def _actor(user: UserPrincipal) -> str:
    """The acting account (token subject), not a person ID projection."""
    subject = (user.claims or {}).get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return str(subject)


class AccountView(BaseModel):
    account_id: str
    login_id: str
    display_name: str
    role: str
    scope_id: str
    person_id: str | None
    active: bool
    locked: bool
    must_change_password: bool
    created_at: datetime


class NewAccount(BaseModel):
    login_id: str = Field(..., min_length=3, max_length=64)
    display_name: str = Field(..., min_length=1, max_length=128)
    role: str
    scope_id: str = Field(..., min_length=3, max_length=127)


class PersonLink(BaseModel):
    person_id: str = Field(..., min_length=1, max_length=64)


class IssuedPassword(BaseModel):
    account_id: str
    temporary_password: str


def _admin_scopes(session: Session, actor: str) -> set[str]:
    return set(
        session.scalars(
            select(AccountMembership.scope_id).where(
                AccountMembership.issuer == local.issuer(),
                AccountMembership.subject == actor,
                AccountMembership.role == AppRole.ADMIN.value,
                AccountMembership.active.is_(True),
            )
        )
    )


def _view(account: LocalAccount) -> AccountView:
    locked_until = account.locked_until
    if locked_until is not None and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    return AccountView(
        account_id=account.account_id,
        login_id=account.login_id,
        display_name=account.display_name,
        role=account.role,
        scope_id=account.scope_id,
        person_id=account.person_id,
        active=account.active,
        locked=bool(locked_until and locked_until > datetime.now(UTC)),
        must_change_password=account.must_change_password,
        created_at=account.created_at,
    )


def _lock_scope_admins(session: Session, scope_id: str) -> list[AccountMembership]:
    """Active administrators of a department, row-locked in a fixed order."""
    return list(
        session.scalars(
            select(AccountMembership)
            .where(
                AccountMembership.issuer == local.issuer(),
                AccountMembership.scope_id == scope_id,
                AccountMembership.role == AppRole.ADMIN.value,
                AccountMembership.active.is_(True),
            )
            .order_by(AccountMembership.membership_id)
            .with_for_update()
        )
    )


def _load_for_admin(
    session: Session, account_id: str, actor: str, *, lock: bool = True
) -> LocalAccount:
    account = session.get(LocalAccount, account_id, with_for_update=lock)
    if account is None:
        raise HTTPException(404, "Account not found")
    if lock:
        # Re-checked under the lock: an actor removed meanwhile is no longer admin.
        allowed = any(
            m.subject == actor for m in _lock_scope_admins(session, account.scope_id)
        )
    else:
        allowed = account.scope_id in _admin_scopes(session, actor)
    # Missing and foreign accounts look the same to the caller.
    if not allowed:
        raise HTTPException(404, "Account not found")
    return account


def _emit(session: Session, account: LocalAccount, actor: str, kind: str) -> None:
    local.record_event(session, account, actor, kind)


@router.get("", response_model=list[AccountView])
def list_accounts(response: Response, user: UserPrincipal = Admin) -> list[AccountView]:
    _require_local()
    from shift_scheduler.db.session import get_session_factory

    response.headers["Cache-Control"] = "no-store"
    with get_session_factory()() as session:
        scopes = _admin_scopes(session, _actor(user))
        if not scopes:
            return []
        accounts = session.scalars(
            select(LocalAccount)
            .where(LocalAccount.scope_id.in_(scopes))
            .order_by(LocalAccount.login_id)
        ).all()
        return [_view(a) for a in accounts]


@router.post("", response_model=IssuedPassword, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: NewAccount, user: UserPrincipal = Admin
) -> IssuedPassword:
    _require_local()
    actor = _actor(user)
    if not _LOGIN.fullmatch(payload.login_id):
        raise HTTPException(
            422, "ログインIDは半角英数字と . _ - の3〜64文字にしてください。"
        )
    if payload.role not in _ROLES:
        raise HTTPException(
            422, "役割は ADMIN、LEADER、PHARMACIST のいずれかにしてください。"
        )
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory()() as session:
        if payload.scope_id not in _admin_scopes(session, actor):
            raise HTTPException(403, "この所属の管理者ではありません。")
    temporary = local.temporary_password()
    password_hash = await run_in_threadpool(local.hash_password, temporary)

    def _create() -> str:
        account_id = uuid4().hex
        login_id = local.normalize_login(payload.login_id)
        with get_session_factory().begin() as session:
            if not any(
                m.subject == actor
                for m in _lock_scope_admins(session, payload.scope_id)
            ):
                raise HTTPException(403, "この所属の管理者ではありません。")
            if session.scalar(
                select(LocalAccount.account_id).where(LocalAccount.login_id == login_id)
            ):
                raise HTTPException(409, "このログインIDは既に使われています。")
            account = LocalAccount(
                account_id=account_id,
                login_id=login_id,
                display_name=payload.display_name,
                role=payload.role,
                scope_id=payload.scope_id,
                person_id=None,
                password_hash=password_hash,
                must_change_password=True,
                created_by=actor,
            )
            session.add(account)
            session.add(
                AccountMembership(
                    membership_id=uuid4().hex,
                    issuer=local.issuer(),
                    subject=account_id,
                    person_id=account_id,
                    scope_id=payload.scope_id,
                    role=payload.role,
                    active=True,
                    created_by=actor,
                )
            )
            try:
                session.flush()
            except IntegrityError as exc:  # the same ID created concurrently
                raise HTTPException(
                    409, "このログインIDは既に使われています。"
                ) from exc
            _emit(session, account, actor, "local_account.created")
        return account_id

    account_id = await run_in_threadpool(_create)
    return IssuedPassword(account_id=account_id, temporary_password=temporary)


@router.post("/{account_id}/reset-password", response_model=IssuedPassword)
async def reset_password(
    account_id: str, user: UserPrincipal = Admin
) -> IssuedPassword:
    _require_local()
    actor = _actor(user)
    from shift_scheduler.db.session import get_session_factory

    # Authorize before spending a hash on the request.
    with get_session_factory()() as session:
        _load_for_admin(session, account_id, actor, lock=False)
    temporary = local.temporary_password()
    password_hash = await run_in_threadpool(local.hash_password, temporary)

    def _reset() -> None:
        with get_session_factory().begin() as session:
            account = _load_for_admin(session, account_id, actor)
            account.password_hash = password_hash
            account.must_change_password = True
            account.failed_count = 0
            account.locked_until = None
            # Every session signed before this moment stops working.
            account.password_changed_at = datetime.now(UTC)
            _emit(session, account, actor, "local_account.password_reset")

    await run_in_threadpool(_reset)
    return IssuedPassword(account_id=account_id, temporary_password=temporary)


@router.post("/{account_id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
def unlock(account_id: str, user: UserPrincipal = Admin) -> Response:
    _require_local()
    actor = _actor(user)
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory().begin() as session:
        account = _load_for_admin(session, account_id, actor)
        account.failed_count = 0
        account.locked_until = None
        _emit(session, account, actor, "local_account.unlocked")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{account_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate(account_id: str, user: UserPrincipal = Admin) -> Response:
    _require_local()
    actor = _actor(user)
    from shift_scheduler.db.session import get_session_factory

    if account_id == actor:
        raise HTTPException(409, "自分自身のアカウントは無効にできません。")
    with get_session_factory().begin() as session:
        account = _load_for_admin(session, account_id, actor)
        admins = session.scalars(
            select(AccountMembership)
            .where(
                AccountMembership.issuer == local.issuer(),
                AccountMembership.scope_id == account.scope_id,
                AccountMembership.role == AppRole.ADMIN.value,
                AccountMembership.active.is_(True),
            )
            .with_for_update()
        ).all()
        if any(m.subject == account_id for m in admins) and not any(
            m.subject != account_id for m in admins
        ):
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
        _emit(session, account, actor, "local_account.deactivated")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{account_id}/person", status_code=status.HTTP_204_NO_CONTENT)
def link_person(
    account_id: str, payload: PersonLink, user: UserPrincipal = Admin
) -> Response:
    """Link the account once to a staff member of its own department."""
    _require_local()
    actor = _actor(user)
    from shift_scheduler.application.ideal_workflows import scope_people
    from shift_scheduler.db.session import get_session_factory

    with get_session_factory().begin() as session:
        account = _load_for_admin(session, account_id, actor)
        if account.person_id is not None:
            # ops/reviewed-planning.md: an account is never re-pointed at another
            # person; a mistake is corrected with a new account.
            raise HTTPException(409, "このアカウントは既に職員に結び付いています。")
        if payload.person_id not in scope_people(session, account.scope_id):
            raise HTTPException(422, "この所属の職員ではありません。")
        if session.scalar(
            select(AccountMembership.membership_id).where(
                AccountMembership.scope_id == account.scope_id,
                AccountMembership.person_id == payload.person_id,
                AccountMembership.active.is_(True),
            )
        ):
            raise HTTPException(
                409, "この職員には既に別のアカウントが結び付いています。"
            )
        memberships = session.scalars(
            select(AccountMembership)
            .where(
                AccountMembership.issuer == local.issuer(),
                AccountMembership.subject == account_id,
            )
            .with_for_update()
        ).all()
        for membership in memberships:
            # Until linked, the membership carries the account ID as a placeholder.
            if membership.person_id != account_id:
                raise HTTPException(409, "このアカウントは既に職員に結び付いています。")
            membership.person_id = payload.person_id
            membership.revision = (membership.revision or 0) + 1
        account.person_id = payload.person_id
        _emit(session, account, actor, "local_account.person_linked")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
