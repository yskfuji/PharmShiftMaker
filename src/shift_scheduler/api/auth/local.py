"""Local accounts for the desktop profile (AUTH_MODE=local).

Passwords are stored as scrypt hashes (N=2**17, r=8, p=1; OWASP's recommended
minimum) from the standard library, so no extra native dependency is bundled.
Unknown login IDs are verified against a dummy hash so that the response time
does not reveal which IDs exist. Five consecutive failures (sign-in or the
current password on the change form) lock the account for fifteen minutes.
At most two hashes run at once, so unauthenticated requests cannot exhaust memory;
a request that cannot get a slot within two seconds is refused (``HashBusy``).
Hashes are computed outside any transaction and row lock: the account is read,
the password is verified, and only the counter update takes a short row lock.
Sign-in and administration events go to ``local_account_events`` (append-only),
not to the business notification outbox.

Every authenticated request re-reads the account (see ``current_account``): a
deactivated account, a password changed or reset after the token was issued,
or a pending password change takes effect immediately on every session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.db.planning_models import LocalAccount, LocalAccountEvent

SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
_MAXMEM = 256 * 1024 * 1024
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256
MAX_FAILURES = 5
LOCK_DURATION = timedelta(minutes=15)
_HASH_SLOTS = threading.BoundedSemaphore(2)
_HASH_WAIT_SECONDS = 2.0


class PasswordPolicyError(ValueError):
    """The new password does not satisfy the policy."""


class HashBusy(RuntimeError):
    """Too many password hashes are running; the caller answers 429."""


def issuer() -> str:
    """The AccountMembership issuer for this installation."""
    return "local:" + (os.getenv("PHARMSHIFT_INSTALL_ID") or "default")


def normalize_login(login_id: str) -> str:
    return unicodedata.normalize("NFKC", login_id).strip().casefold()


def _normalize(password: str) -> bytes:
    return unicodedata.normalize("NFKC", password).encode("utf-8")


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    if not _HASH_SLOTS.acquire(timeout=_HASH_WAIT_SECONDS):
        raise HashBusy("Too many sign-in attempts at once")
    try:
        return hashlib.scrypt(
            _normalize(password), salt=salt, n=n, r=r, p=p, maxmem=_MAXMEM, dklen=dklen
        )
    finally:
        _HASH_SLOTS.release()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, 32)
    encode = base64.b64encode
    return (
        f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}$"
        f"{encode(salt).decode()}${encode(digest).decode()}"
    )


def verify_password(password: str, encoded: str) -> bool:
    if len(password) > MAX_PASSWORD_LENGTH:
        return False
    try:
        scheme, n, r, p, salt, digest = encoded.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = _scrypt(
            password, base64.b64decode(salt), int(n), int(r), int(p), len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(24))
    return _DUMMY_HASH


def check_policy(password: str, login_id: str = "") -> None:
    if not (MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH):
        raise PasswordPolicyError(
            f"パスワードは{MIN_PASSWORD_LENGTH}文字以上{MAX_PASSWORD_LENGTH}文字以下にしてください。"
        )
    if login_id and normalize_login(login_id) in password.casefold():
        raise PasswordPolicyError("パスワードにログインIDを含めないでください。")
    if len(set(password)) < 4:
        raise PasswordPolicyError("同じ文字の繰り返しが多すぎます。")


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo:
        return value
    return value.replace(tzinfo=UTC)


def _locked(account: LocalAccount) -> bool:
    locked = _aware(account.locked_until)
    return bool(locked and locked > _now())


def record_event(
    session: Session, account: LocalAccount, actor: str, kind: str
) -> None:
    """Append an audit record in the caller's transaction."""
    session.add(
        LocalAccountEvent(
            event_id=uuid4().hex,
            account_id=account.account_id,
            scope_id=account.scope_id,
            actor=actor,
            kind=kind,
        )
    )


def _record_failure(session: Session, account: LocalAccount) -> None:
    account.failed_count = (account.failed_count or 0) + 1
    if account.failed_count >= MAX_FAILURES:
        account.locked_until = _now() + LOCK_DURATION
        account.failed_count = 0
        record_event(session, account, account.account_id, "local_account.locked")


@dataclass(frozen=True)
class SignIn:
    principal: UserPrincipal
    must_change_password: bool


def principal_for(account: LocalAccount) -> UserPrincipal:
    return UserPrincipal(
        user_id=account.account_id,
        role=AppRole(account.role),
        display_name=account.display_name,
        claims={"iss": issuer(), "sub": account.account_id, "local": True},
    )


def _usable(account: LocalAccount) -> bool:
    return bool(account.active) and not _locked(account)


def sign_in(
    factory: sessionmaker[Session], login_id: str, password: str
) -> SignIn | None:
    """Verify a sign-in; None for any failure (the failure counter is committed).

    The hash runs with no transaction open. The counter update then re-reads the
    account under a row lock and ignores the result if the password or the lock
    changed in between.
    """
    with factory() as session:
        found = session.scalar(
            select(LocalAccount).where(
                LocalAccount.login_id == normalize_login(login_id)
            )
        )
        snapshot = (
            (found.account_id, found.password_hash)
            if found is not None and _usable(found)
            else None
        )
    if snapshot is None:
        verify_password(password, _dummy_hash())
        return None
    account_id, stored = snapshot
    correct = verify_password(password, stored)
    with factory.begin() as session:
        account = session.get(LocalAccount, account_id, with_for_update=True)
        if account is None or not _usable(account) or account.password_hash != stored:
            return None
        if not correct:
            _record_failure(session, account)
            return None
        account.failed_count = 0
        account.locked_until = None
        record_event(session, account, account.account_id, "local_account.signed_in")
        return SignIn(principal_for(account), bool(account.must_change_password))


def change_password(
    factory: sessionmaker[Session], account_id: str, current: str, new: str
) -> UserPrincipal | None:
    """Change the password; None for a wrong current password.

    A wrong current password counts towards the lock like a failed sign-in. As in
    ``sign_in``, both hashes run before the short locked update.
    """
    with factory() as session:
        found = session.get(LocalAccount, account_id)
        if found is None or not _usable(found):
            return None
        stored, login = found.password_hash, found.login_id
    correct = verify_password(current, stored)
    new_hash = None
    if correct:
        if current == new:
            raise PasswordPolicyError("現在と異なるパスワードにしてください。")
        check_policy(new, login)
        new_hash = hash_password(new)
    with factory.begin() as session:
        account = session.get(LocalAccount, account_id, with_for_update=True)
        if account is None or not _usable(account) or account.password_hash != stored:
            return None
        if new_hash is None:
            _record_failure(session, account)
            return None
        account.password_hash = new_hash
        account.must_change_password = False
        account.failed_count = 0
        account.password_changed_at = _now()
        record_event(
            session, account, account.account_id, "local_account.password_changed"
        )
        return principal_for(account)


class AccountState:
    ACTIVE = "active"
    CHANGE_REQUIRED = "change_required"
    INVALID = "invalid"


def current_account(session: Session, principal: UserPrincipal) -> str:
    """State of the signed-in local account for this token (read on every request)."""
    claims = principal.claims or {}
    if not claims.get("local") or claims.get("iss") != issuer():
        return AccountState.INVALID
    account = session.get(LocalAccount, str(claims.get("sub") or ""))
    if account is None or not account.active:
        return AccountState.INVALID
    issued = _aware(principal.issued_at)
    changed = _aware(account.password_changed_at)
    # A token signed before the latest password change or reset no longer counts.
    if issued is None or (changed is not None and issued < changed):
        return AccountState.INVALID
    if account.must_change_password:
        return AccountState.CHANGE_REQUIRED
    return AccountState.ACTIVE


def temporary_password() -> str:
    """A one-time password an administrator hands over; it must be changed at first sign-in."""
    return secrets.token_urlsafe(12)


__all__ = [
    "AccountState",
    "HashBusy",
    "PasswordPolicyError",
    "SignIn",
    "change_password",
    "check_policy",
    "current_account",
    "hash_password",
    "issuer",
    "normalize_login",
    "principal_for",
    "record_event",
    "sign_in",
    "temporary_password",
    "verify_password",
]
