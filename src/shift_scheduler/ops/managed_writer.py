"""Registered file publication with a durable intent and recoverable after-image.

Only the returned AVAILABLE path is distributable. Staging is private; failure
leaves an explicit residual rather than silently deleting audit evidence.
"""

import fcntl
import hashlib
import os
import re
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from shift_scheduler.application.copies import checked_file, file_digest, storage_root
from shift_scheduler.application.planning import Conflict, lock_facility
from shift_scheduler.db.compliance_models import CopySubject, ErasedSubject, ManagedCopy
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import content_hash

ROUTES = {
    "publication.json",
    "schedule.json",
    "schedule.csv",
    "attendance.csv",
    "backup.files",
    "backup.database",
    "replica",
}


def registered_copy(session: Session, copy_id: str) -> ManagedCopy:
    """A reserved row that vanished between transactions is a conflict, not a crash."""
    row = session.get(ManagedCopy, copy_id)
    if row is None:
        raise Conflict("Managed copy registration disappeared")
    return row


def allowed_subjects(session: Session, scope: str, people: Iterable[str]) -> None:
    if session.scalar(
        select(ErasedSubject).where(
            ErasedSubject.facility_id == scope.split("/")[0],
            ErasedSubject.person_id.in_(people),
        )
    ):
        raise Conflict("Erasure prevents creation or publication of this copy")


def reserve(
    factory: sessionmaker[Session],
    scope: str,
    item: CopyRegistration,
    route: str,
    source_hash: str,
) -> str:
    with factory.begin() as session:
        return reserve_in_session(session, scope, item, route, source_hash)


def reserve_in_session(
    session: Session, scope: str, item: CopyRegistration, route: str, source_hash: str
) -> str:
    if route not in ROUTES or not re.fullmatch(r"[a-f0-9]{64}", source_hash):
        raise ValueError("Registered storage route and immutable source hash required")
    if item.medium not in {"file", "backup"}:
        raise ValueError("Managed writer only publishes local managed files")
    # Flat, immutable object names avoid untrusted parent directories and clobbering.
    if (
        not item.copy_id.isalnum()
        or len(item.copy_id) != 32
        or item.relative_path != item.copy_id
    ):
        raise ValueError("Writer object path must be a fresh 32-character identity")
    request_hash = content_hash(
        {
            "scope": scope,
            "item": item.model_dump(mode="json"),
            "route": route,
            "source": source_hash,
        }
    )
    checked_file(item.relative_path)
    lock_facility(session, scope)
    allowed_subjects(session, scope, item.person_ids)
    old = session.get(ManagedCopy, item.copy_id)
    if old:
        if old.scope_id != scope or old.evidence.get("writer_request") != request_hash:
            raise Conflict("Writer identity was reused with different content")
        return item.copy_id
    session.add(
        ManagedCopy(
            copy_id=item.copy_id,
            scope_id=scope,
            category=item.category,
            medium=item.medium,
            locator={
                "relative_path": item.relative_path,
                "staging_path": ".pending-" + item.copy_id,
                "route": route,
                "source_hash": source_hash,
            },
            content_hash=item.content_hash,
            revision=1,
            state="RESERVED",
            subject_status=item.subject_status,
            anchor=item.anchor,
            anchor_at=item.anchor_at,
            evidence={
                **item.evidence.model_dump(mode="json"),
                "writer_request": request_hash,
                "writer_format": 1,
            },
        )
    )
    session.flush()
    session.add_all(
        CopySubject(copy_id=item.copy_id, person_id=p) for p in set(item.person_ids)
    )
    return item.copy_id


@contextmanager
def file_lock(root: str | Path, copy_id: str) -> Iterator[int]:
    # The open directory, not an independently re-resolved path, is the trust root.
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = os.open(
        ".lock-" + copy_id,
        os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield directory
    finally:
        os.close(fd)
        os.close(directory)


def publish_bytes(
    factory: sessionmaker[Session], scope: str, copy_id: str, data: bytes
) -> Path:
    """Retries require the identical bytes; crash after rename is reconciled."""
    if len(copy_id) != 32 or not copy_id.isalnum():
        raise ValueError("Invalid managed object identity")
    digest = hashlib.sha256(data).hexdigest()
    root = storage_root()
    with file_lock(root, copy_id) as directory:
        with factory.begin() as session:
            lock_facility(session, scope)
            row = session.get(ManagedCopy, copy_id)
            if (
                not row
                or row.scope_id != scope
                or row.evidence.get("writer_format") != 1
            ):
                raise LookupError("Registered file reservation not found")
            people = tuple(
                session.scalars(
                    select(CopySubject.person_id).where(CopySubject.copy_id == copy_id)
                )
            )
            allowed_subjects(session, scope, people)
            if row.content_hash != digest or row.state not in {
                "RESERVED",
                "WRITING",
                "WRITE_RETRY",
                "PRESENT",
            }:
                raise Conflict("File content or lifecycle changed")
            final: str = row.locator["relative_path"]
            temporary: str = row.locator["staging_path"]
            row.state = "WRITING"
            row.revision += 1
        try:
            try:
                fd = os.open(final, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            except FileNotFoundError:
                fd = None
            if fd is not None:
                with os.fdopen(fd, "rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                        raise Conflict("Published after-image was changed")
                try:
                    staged = os.open(
                        temporary, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory
                    )
                except FileNotFoundError:
                    staged = None
                if staged is not None:
                    with os.fdopen(staged, "rb") as stream:
                        if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                            raise Conflict("Staging after-image was changed")
                    os.unlink(temporary, dir_fd=directory)
                    os.fsync(directory)
            else:
                fd = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=directory,
                )
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                # Hard-link publication is atomic and refuses an existing target.
                os.link(
                    temporary,
                    final,
                    src_dir_fd=directory,
                    dst_dir_fd=directory,
                    follow_symlinks=False,
                )
                os.unlink(temporary, dir_fd=directory)
                os.fsync(directory)
            with factory.begin() as session:
                lock_facility(session, scope)
                row = registered_copy(session, copy_id)
                allowed_subjects(session, scope, people)
                if row.state != "WRITING" or row.content_hash != digest:
                    raise Conflict("Copy was restricted during writing")
                row.state = "PRESENT"
                row.revision += 1
                row.evidence = {
                    **row.evidence,
                    "verified_bytes": len(data),
                    "available_at": datetime.now(UTC).isoformat(),
                }
            return root / final
        except Exception:
            with factory.begin() as session:
                row = session.get(ManagedCopy, copy_id)
                if row and row.state == "WRITING":
                    row.state = "WRITE_RETRY"
                    row.revision += 1
            raise


def reconcile_files(session: Session) -> dict[str, Any]:
    """Inventory all managed bytes, including incomplete files and unexpected files."""
    root = storage_root()
    registered, issues = set(), []
    for row in session.scalars(
        select(ManagedCopy).where(ManagedCopy.medium.in_(("file", "backup")))
    ):
        path = row.locator.get("relative_path")
        if path:
            registered.add(path)
        if row.evidence.get("writer_format") == 1:
            registered.update((row.locator["staging_path"], ".lock-" + row.copy_id))
            if (root / row.locator["staging_path"]).exists():
                issues.append(
                    {"copy_id": row.copy_id, "reason": "staging_copy_remaining"}
                )
        if row.state == "PRESENT":
            try:
                # A PRESENT file row without a path is reported, not a TypeError crash.
                valid = (
                    file_digest(checked_file(path)) == row.content_hash
                    if path
                    else False
                )
            except (OSError, ValueError):
                valid = False
            if not valid:
                issues.append({"copy_id": row.copy_id, "reason": "missing_or_changed"})
        elif row.state not in {"ERASED", "DELETED"}:
            issues.append(
                {"copy_id": row.copy_id, "reason": "unfinished", "state": row.state}
            )
        elif path and (root / path).exists():
            issues.append({"copy_id": row.copy_id, "reason": "erased_copy_reappeared"})
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink() or (not path.is_dir() and relative not in registered):
            issues.append({"path": relative, "reason": "unregistered_or_link"})
    return {"complete": not issues, "issues": issues}


CAPTURE_ROUTES = {"backup.files", "backup.database", "attendance.csv", "replica"}


def _capture_sources(
    session: Session, scope: str, sources: dict[str, str], route: str | None = None
) -> list[str]:
    """Resolve immutable producer provenance, not caller-asserted ownership."""
    if not sources:
        raise ValueError("Managed capture requires registered source copies")
    people: set[str] = set()
    for identity, digest in sources.items():
        row = session.get(ManagedCopy, identity)
        scope_matches = row is not None and (
            row.scope_id == scope
            or (
                route == "backup.database"
                and (
                    row.scope_id == "__unclassified__"
                    or row.scope_id.startswith(scope.split("/")[0] + "/")
                )
            )
        )
        if (
            row is None
            or not scope_matches
            or row.content_hash != digest
            or row.state != "PRESENT"
        ):
            raise Conflict("Managed capture source changed, missing or outside scope")
        people.update(
            session.scalars(
                select(CopySubject.person_id).where(CopySubject.copy_id == identity)
            )
        )
        if row.medium in {"file", "backup"}:
            if file_digest(checked_file(row.locator["relative_path"])) != digest:
                raise Conflict("Managed capture source bytes changed")
        elif row.medium == "database":
            from shift_scheduler.application.database_erasure import current_hash

            if current_hash(session, row) != digest:
                raise Conflict("Managed capture source row changed")
        else:
            raise Conflict("External source cannot be verified by managed capture")
    if not people:
        raise Conflict("Managed capture source subject attribution is unresolved")
    allowed_subjects(session, scope, people)
    return sorted(people)


def reserve_capture(
    factory: sessionmaker[Session],
    scope: str,
    copy_id: str,
    route: str,
    sources: dict[str, str],
) -> str:
    """Register private staging before an unknown-size output is generated.

    `sources` is copy ID -> exact registered hash. Subject attribution is inherited
    as UNVERIFIED: provenance alone is never a free-text ownership review.
    Authentication/role authorization belongs to the calling API or operator CLI.
    The independent service gate applies here as well, including direct callers.
    """
    from shift_scheduler.control.client import require_access

    require_access()
    if route not in CAPTURE_ROUTES or len(copy_id) != 32 or not copy_id.isalnum():
        raise ValueError("Unsupported capture route or identity")
    checked_file(copy_id)
    fingerprint = content_hash({"scope": scope, "route": route, "sources": sources})
    with factory.begin() as session:
        lock_facility(session, scope)
        people = _capture_sources(session, scope, sources, route)
        existing = session.get(ManagedCopy, copy_id)
        if existing:
            if (
                existing.scope_id != scope
                or existing.evidence.get("capture_request") != fingerprint
            ):
                raise Conflict("Managed capture identity reused with different sources")
            return copy_id
        session.add(
            ManagedCopy(
                copy_id=copy_id,
                scope_id=scope,
                category="backups" if route.startswith("backup.") else "exports",
                medium="backup" if route.startswith("backup.") else "file",
                locator={
                    "relative_path": copy_id,
                    "staging_path": ".pending-" + copy_id,
                    "route": route,
                    "source_copies": dict(sources),
                },
                content_hash="0" * 64,
                revision=1,
                state="CAPTURE_RESERVED",
                subject_status="UNVERIFIED",
                anchor=(
                    "backup_created" if route.startswith("backup.") else "last_activity"
                ),
                anchor_at=datetime.now(UTC),
                evidence={
                    "capture_format": 1,
                    "writer_format": 1,
                    "capture_request": fingerprint,
                    "hash_pending": True,
                    "reference": "Derived from exact registered source hashes; ownership review remains required",
                },
            )
        )
        session.flush()
        session.add_all(CopySubject(copy_id=copy_id, person_id=p) for p in people)
    return copy_id


def capture(
    factory: sessionmaker[Session],
    scope: str,
    copy_id: str,
    producer: Callable[[IO[bytes]], None],
) -> Path:
    """Run producer(binary stream) under a registered durable intent.

    No DB transaction spans file generation. An unfinished staging file is never
    distributable. After the staged digest commits, resume uses the identical
    after-image without re-running the producer, including a lost publish ACK.
    """
    from shift_scheduler.control.client import require_access

    require_access()
    if len(copy_id) != 32 or not copy_id.isalnum():
        raise ValueError("Invalid managed capture identity")
    root = storage_root()
    with file_lock(root, copy_id) as directory:
        with factory.begin() as session:
            lock_facility(session, scope)
            row = session.get(ManagedCopy, copy_id)
            if (
                not row
                or row.scope_id != scope
                or row.evidence.get("capture_format") != 1
            ):
                raise LookupError("Managed capture reservation missing")
            sources = dict(row.locator["source_copies"])
            route = row.locator["route"]
            _capture_sources(session, scope, sources, route)
            previous_state = row.state
            if previous_state not in {
                "CAPTURE_RESERVED",
                "CAPTURING",
                "CAPTURE_RETRY",
                "CAPTURE_READY",
                "PRESENT",
            }:
                raise Conflict("Capture is restricted or has an unsupported state")
            staged: str = row.locator["staging_path"]
            final: str = row.locator["relative_path"]
            digest = None if row.evidence.get("hash_pending") else row.content_hash
            if digest is None:
                row.state = "CAPTURING"
                row.revision += 1
        try:
            if digest is None:
                # Fresh output must not collide with a pre-existing published file.
                try:
                    os.stat(final, dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise Conflict("Uncommitted capture has a published after-image")
                fd = os.open(
                    staged,
                    os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=directory,
                )
                with os.fdopen(fd, "wb") as stream:
                    producer(stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                fd = os.open(staged, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
                with os.fdopen(fd, "rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                    size = os.fstat(stream.fileno()).st_size
                require_access()
                with factory.begin() as session:
                    lock_facility(session, scope)
                    row = registered_copy(session, copy_id)
                    _capture_sources(session, scope, sources, route)
                    if row.state != "CAPTURING" or not row.evidence.get("hash_pending"):
                        raise Conflict("Capture changed during generation")
                    row.content_hash, row.state = digest, "CAPTURE_READY"
                    row.evidence = {
                        **row.evidence,
                        "hash_pending": False,
                        "verified_bytes": size,
                    }
                    row.revision += 1
            try:
                fd = os.open(final, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            except FileNotFoundError:
                fd = os.open(staged, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
                with os.fdopen(fd, "rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                        raise Conflict("Captured staging hash changed")
                os.link(
                    staged,
                    final,
                    src_dir_fd=directory,
                    dst_dir_fd=directory,
                    follow_symlinks=False,
                )
            else:
                with os.fdopen(fd, "rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                        raise Conflict("Captured final hash changed")
            with suppress(FileNotFoundError):
                os.unlink(staged, dir_fd=directory)
            os.fsync(directory)
            require_access()
            with factory.begin() as session:
                lock_facility(session, scope)
                row = registered_copy(session, copy_id)
                _capture_sources(session, scope, sources, route)
                if (
                    row.state not in {"CAPTURE_READY", "PRESENT"}
                    or row.content_hash != digest
                ):
                    raise Conflict("Capture restricted before availability")
                row.state = "PRESENT"
                row.evidence = {
                    **row.evidence,
                    "available_at": datetime.now(UTC).isoformat(),
                }
                row.revision += 1
            return root / final
        except Exception:
            with factory.begin() as session:
                row = session.get(ManagedCopy, copy_id)
                if row and row.state == "CAPTURING":
                    row.state = "CAPTURE_RETRY"
                    row.revision += 1
            raise
