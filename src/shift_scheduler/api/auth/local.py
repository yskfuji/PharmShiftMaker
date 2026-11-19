"""Local accounts for the desktop profile (AUTH_MODE=local).

Passwords are stored as scrypt hashes (N=2**17, r=8, p=1; OWASP's recommended
minimum) from the standard library, so no extra native dependency is bundled.
Unknown login IDs are verified against a dummy hash so that the response time
does not reveal which IDs exist. Five consecutive failures (sign-in or the
current password on the change form) lock the account for fifteen minutes.
At most two hashes run at once, so unauthenticated requests cannot exhaust memory.

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

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.api.auth.models import AppRole, UserPrincipal
from shift_scheduler.db.planning_models import LocalAccount

SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
_MAXMEM = 256 * 1024 * 1024
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256
MAX_FAILURES = 5
LOCK_DURATION = timedelta(minutes=15)
_HASH_SLOTS = threading.BoundedSemaphore(2)


class LocalAuthError(Exception):
    """Sign-in failed. The message never says which part was wrong."""


class PasswordPolicyError(ValueError):
    """The new password does not satisfy the policy."""


def issuer() -> str:
    """The AccountMembership issuer for this installation."""
    return "local:" + (os.getenv("PHARMSHIFT_INSTALL_ID") or "default")


def normalize_login(login_id: str) -> str:
    return unicodedata.normalize("NFKC", login_id).strip().casefold()


def _normalize(password: str) -> bytes:
    return unicodedata.normalize("NFKC", password).encode("utf-8")


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    with _HASH_SLOTS:
        return hashlib.scrypt(
            _normalize(password), salt=salt, n=n, r=r, p=p, maxmem=_MAXMEM, dklen=dklen
        )


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


def _audit(session: Session, account: LocalAccount, kind: str) -> None:
    from shift_scheduler.application.planning import emit

    emit(
        session,
        account.scope_id,
        account.account_id,
        kind,
        {"account_id": account.account_id},
    )


def _record_failure(session: Session, account: LocalAccount) -> None:
    account.failed_count = (account.failed_count or 0) + 1
    if account.failed_count >= MAX_FAILURES:
        account.locked_until = _now() + LOCK_DURATION
        account.failed_count = 0
        _audit(session, account, "local_account.locked")


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


def authenticate(session: Session, login_id: str, password: str) -> SignIn | None:
    """Verify a sign-in inside the caller's transaction.

    A failure returns None instead of raising, so the caller commits the updated
    failure counter and lock before answering 401.
    """
    account = session.scalar(
        select(LocalAccount)
        .where(LocalAccount.login_id == normalize_login(login_id))
        .with_for_update()
    )
    if account is None or not account.active:
        verify_password(password, _dummy_hash())
        return None
    locked = _aware(account.locked_until)
    if locked and locked > _now():
        verify_password(password, _dummy_hash())
        return None
    if not verify_password(password, account.password_hash):
        _record_failure(session, account)
        return None
    account.failed_count = 0
    account.locked_until = None
    _audit(session, account, "local_account.signed_in")
    return SignIn(principal_for(account), bool(account.must_change_password))


def change_password(
    session: Session, account_id: str, current: str, new: str
) -> LocalAccount | None:
    """Change the password in the caller's transaction; None for a wrong current password.

    A wrong current password counts towards the lock like a failed sign-in, and the
    caller commits that before answering.
    """
    account = session.get(LocalAccount, account_id, with_for_update=True)
    if account is None or not account.active:
        return None
    locked = _aware(account.locked_until)
    if locked and locked > _now():
        return None
    if not verify_password(current, account.password_hash):
        _record_failure(session, account)
        return None
    if current == new:
        raise PasswordPolicyError("現在と異なるパスワードにしてください。")
    check_policy(new, account.login_id)
    account.password_hash = hash_password(new)
    account.must_change_password = False
    account.failed_count = 0
    account.password_changed_at = _now()
    _audit(session, account, "local_account.password_changed")
    return account


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
    "LocalAuthError",
    "PasswordPolicyError",
    "SignIn",
    "authenticate",
    "change_password",
    "check_policy",
    "current_account",
    "hash_password",
    "issuer",
    "normalize_login",
    "principal_for",
    "temporary_password",
    "verify_password",
]
