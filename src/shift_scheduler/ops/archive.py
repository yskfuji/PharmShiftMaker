"""Bounded, manifest-verified archives. Restore only to a new isolated directory."""

from __future__ import annotations

import contextlib
import gzip
import hashlib
import hmac
import io
import json
import os
import re
import stat
import tarfile
import tempfile
import uuid
import zlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import IO

from sqlalchemy.orm import Session, sessionmaker

MAX_FILES = 100_000
MAX_BYTES = 10 * 1024**3
SIGNATURE = "manifest.sig"


KEY_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
# Signature format 2 binds the purpose and the key ID into the MAC input, so a
# MAC made for another purpose or recorded under another key ID never verifies.
CONTEXT = b"pharmshift.archive.manifest.v2\n"
EXPECTED_FIELDS = frozenset({"archive_id", "kind", "scope", "operation_id", "sha256"})


@dataclass(frozen=True)
class ArchiveKey:
    """One HMAC key with usage periods (NIST SP 800-57 Pt 1 Rev 5, 5.3.6).

    active: signs until sign_until and verifies until verify_until.
    deactivated: verifies only (archives signed before the rotation).
    compromised: neither; archives signed with it are refused, since without a
    trusted timestamp a forged archive cannot be told from an old genuine one.
    """

    key_id: str
    secret: bytes
    state: str = "active"
    sign_until: datetime | None = None
    verify_until: datetime | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _production() -> bool:
    """As legacy_storage: an independent control configuration also means production."""
    return os.environ.get("PHARMSHIFT_ENV") == "production" or bool(
        os.environ.get("PHARMSHIFT_CONTROL_URL")
    )


def _instant(value: object, name: str) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.tzinfo is None:
        raise ValueError(
            f"Archive keyring {name} must be an ISO date-time with an offset"
        )
    return parsed


def _archive_keys() -> list[ArchiveKey] | None:
    """The archive keyring: PHARMSHIFT_ARCHIVE_KEYRING (JSON), or the single key
    PHARMSHIFT_ARCHIVE_KEY (>= 32 bytes) with PHARMSHIFT_ARCHIVE_KEY_ID as a one-key ring.

    Without a signature anyone who can edit an archive can also recompute its
    manifest. Production refuses to create or restore archives without a key.
    """
    ring = os.environ.get("PHARMSHIFT_ARCHIVE_KEYRING")
    raw = os.environ.get("PHARMSHIFT_ARCHIVE_KEY")
    if ring and raw:
        raise ValueError(
            "Configure either PHARMSHIFT_ARCHIVE_KEYRING or PHARMSHIFT_ARCHIVE_KEY, not both"
        )
    if not ring and not raw:
        if _production():
            raise ValueError(
                "Production archives require PHARMSHIFT_ARCHIVE_KEY or PHARMSHIFT_ARCHIVE_KEYRING"
            )
        return None
    if raw:
        entries: object = [
            {
                "key_id": os.environ.get("PHARMSHIFT_ARCHIVE_KEY_ID", "default"),
                "secret": raw,
            }
        ]
    else:
        try:
            entries = json.loads(ring or "").get("keys")
        except (json.JSONDecodeError, AttributeError) as exc:
            raise ValueError(
                "Archive keyring must be a JSON object with a keys list"
            ) from exc
    if not isinstance(entries, list) or not entries:
        raise ValueError("Archive keyring must be a JSON object with a keys list")
    keys = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {
            "key_id",
            "secret",
            "state",
            "sign_until",
            "verify_until",
        }:
            raise ValueError("Archive keyring entries have unknown or malformed fields")
        key_id, secret, state = (
            entry.get("key_id"),
            entry.get("secret"),
            entry.get("state", "active"),
        )
        if not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise ValueError(
                "Archive key ID must be 1-64 letters, digits, '.', '_' or '-'"
            )
        if not isinstance(secret, str) or len(secret.encode()) < 32:
            raise ValueError("Archive signing key must contain at least 32 bytes")
        if state not in {"active", "deactivated", "compromised"}:
            raise ValueError(
                "Archive key state must be active, deactivated or compromised"
            )
        key = ArchiveKey(
            key_id,
            secret.encode(),
            state,
            _instant(entry.get("sign_until"), "sign_until"),
            _instant(entry.get("verify_until"), "verify_until"),
        )
        if key.sign_until and key.verify_until and key.verify_until < key.sign_until:
            raise ValueError(
                "Archive key must remain verifiable for as long as it signs"
            )
        keys.append(key)
    if len({k.key_id for k in keys}) != len(keys) or len(
        {k.secret for k in keys}
    ) != len(keys):
        raise ValueError("Archive keyring repeats a key ID or a secret")
    return keys


def _signing_key(keys: list[ArchiveKey] | None) -> ArchiveKey | None:
    """The one key allowed to sign now; a configured ring without one is refused."""
    if keys is None:
        return None
    now = _now()
    usable = [
        k
        for k in keys
        if k.state == "active"
        and (k.sign_until is None or now < k.sign_until)
        and (k.verify_until is None or now < k.verify_until)
    ]
    if len(usable) != 1:
        raise ValueError(
            "Archive keyring requires exactly one active key within its signing period"
        )
    return usable[0]


def _mac(key: ArchiveKey, manifest: bytes, version: int) -> str:
    message = (
        manifest if version == 1 else CONTEXT + key.key_id.encode() + b"\n" + manifest
    )
    return hmac.new(key.secret, message, hashlib.sha256).hexdigest()


def _signature(manifest: bytes, key: ArchiveKey | None) -> bytes | None:
    if key is None:
        return None
    now = _now()
    created = _instant(
        json.loads(manifest).get("identity", {}).get("created_at"), "created_at"
    )
    if (
        key.sign_until is not None
        and (
            now >= key.sign_until or (created is not None and created >= key.sign_until)
        )
    ) or (key.verify_until is not None and now >= key.verify_until):
        # A long backup outlived the key's signing period: fail, retry with the new key.
        raise ValueError(
            "Archive signing key's signing period ended during the backup; retry"
        )
    return json.dumps(
        {
            "format": 2,
            "key_id": key.key_id,
            "algorithm": "HMAC-SHA256",
            "mac": _mac(key, manifest, 2),
        },
        sort_keys=True,
    ).encode()


def _verify_signature(
    keys: list[ArchiveKey],
    claim: object,
    manifest_bytes: bytes,
    manifest: dict[str, object],
) -> None:
    invalid = ValueError("Archive signature missing or invalid")
    if not isinstance(claim, dict):
        raise invalid
    version = claim.get("format", 1)
    given = claim.get("mac")
    # No downgrade: a format 2 manifest needs a format 2 signature, and the old
    # signature form is accepted only for the old manifest form.
    if (
        version != manifest["format"]
        or claim.get("algorithm", "HMAC-SHA256") != "HMAC-SHA256"
        or not isinstance(given, str)
        or len(given) != 64
        or any(c not in "0123456789abcdef" for c in given)
    ):
        raise invalid
    key = next((k for k in keys if k.key_id == claim.get("key_id")), None)
    if key is None:
        raise invalid
    if key.state == "compromised":
        raise ValueError("Archive was signed with a compromised key")
    if key.verify_until is not None and _now() >= key.verify_until:
        raise ValueError("Archive signing key is past its verification period")
    identity = manifest.get("identity")
    if version == 2 and key.sign_until is not None and isinstance(identity, dict):
        created = _instant(identity.get("created_at"), "created_at")
        if created is None or created >= key.sign_until:
            raise ValueError("Archive claims creation after its key's signing period")
    if not hmac.compare_digest(
        given.encode(), _mac(key, manifest_bytes, version).encode()
    ):
        raise invalid


def _identity(
    kind: str,
    scope: str | None,
    operation_id: str | None,
    archive_id: str | None = None,
) -> dict[str, object]:
    return {
        "archive_id": archive_id or uuid.uuid4().hex,
        "kind": kind,
        "scope": scope,
        "created_at": _now().isoformat(),
        "operation_id": operation_id,
    }


def _checked_identity(manifest: dict[str, object]) -> dict[str, object]:
    identity = manifest.get("identity")
    if (
        not isinstance(identity, dict)
        or set(identity)
        != {"archive_id", "kind", "scope", "created_at", "operation_id"}
        or not isinstance(identity["archive_id"], str)
        or not identity["archive_id"]
        or identity["kind"] not in {"files", "managed"}
        or any(
            identity[k] is not None and not isinstance(identity[k], str)
            for k in ("scope", "operation_id")
        )
    ):
        raise ValueError("Manifest identity missing or mismatch")
    try:
        _instant(identity["created_at"], "created_at")
    except ValueError as exc:
        raise ValueError("Manifest identity missing or mismatch") from exc
    return identity


def archive_identity(archive_path: Path) -> dict[str, object]:
    """Identity and SHA-256 to record at backup time and to expect at restore.

    Reads only; the values are not verified here (restore_archive verifies).
    """
    with archive_path.open("rb") as raw:
        digest = hashlib.file_digest(raw, "sha256").hexdigest()
        raw.seek(0)
        with tarfile.open(fileobj=raw, mode="r:gz") as archive:
            stream = archive.extractfile(archive.getmember("manifest.json"))
            assert stream is not None
            manifest = json.loads(stream.read(20 * 1024**2))
    identity = manifest.get("identity") if isinstance(manifest, dict) else None
    return {**(identity if isinstance(identity, dict) else {}), "sha256": digest}


class _HashingReader:
    """Hashes exactly the bytes handed to the tar writer."""

    def __init__(self, raw: IO[bytes]) -> None:
        self.raw, self.hash = raw, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        data = self.raw.read(size)
        self.hash.update(data)
        return data


def create_archive(
    sources: list[Path],
    destination: Path,
    *,
    scope: str | None = None,
    operation_id: str | None = None,
) -> dict[str, object]:
    """Returns the signed identity; record it (or archive_identity) to restore with."""
    from shift_scheduler.ops.legacy_storage import require_development_storage

    require_development_storage()
    if not sources:
        raise ValueError("At least one authoritative source is required")
    # Fail before writing a partial archive when the key is missing, short or unusable.
    signer = _signing_key(_archive_keys())
    identity = _identity("files", scope, operation_id)
    with tempfile.TemporaryDirectory(prefix="pharmshift-backup-") as temp:
        members: dict[str, Path] = {}
        source_map: dict[str, str] = {}
        digests: dict[str, object] = {}
        total = 0
        for index, source in enumerate(sources):
            if source.is_symlink() or not source.exists():
                raise ValueError("Backup sources must exist and cannot be links")
            prefix = f"sources/{index:04d}/{source.name}"
            source_map[prefix] = str(source)
            paths = sorted(source.rglob("*")) if source.is_dir() else [source]
            for path in paths:
                if path.is_symlink():
                    raise ValueError("Backup does not accept symbolic links")
                if path.is_dir():
                    continue
                if not path.is_file() or len(members) >= MAX_FILES:
                    raise ValueError("Backup requires bounded regular files")
                name = prefix + (
                    "/" + path.relative_to(source).as_posix() if source.is_dir() else ""
                )
                staged = Path(temp) / str(len(members))
                digest = hashlib.sha256()
                size = 0
                # O_NOFOLLOW: a file swapped for a link after the check above is refused.
                try:
                    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                except OSError as exc:
                    raise ValueError("Backup source changed or became a link") from exc
                with os.fdopen(fd, "rb") as original, staged.open("xb") as copy:
                    if not stat.S_ISREG(os.fstat(original.fileno()).st_mode):
                        raise ValueError("Backup requires bounded regular files")
                    while chunk := original.read(1024 * 1024):
                        total += len(chunk)
                        size += len(chunk)
                        if total > MAX_BYTES:
                            raise ValueError("Backup resource limit exceeded")
                        digest.update(chunk)
                        copy.write(chunk)
                members[name] = staged
                digests[name] = {"sha256": digest.hexdigest(), "size": size}
        manifest = json.dumps(
            {
                "format": 2,
                "identity": identity,
                "sources": source_map,
                "files": digests,
            },
            sort_keys=True,
        ).encode()
        signature = _signature(manifest, signer)
        # Stage first: an inconsistent/missing source never creates a partial backup.
        with (
            destination.open("xb") as out,
            tarfile.open(fileobj=out, mode="w:gz") as archive,
        ):
            for name, staged in members.items():
                entry = tarfile.TarInfo(name)
                entry.size = staged.stat().st_size
                entry.mode = 0o600
                with staged.open("rb") as content:
                    archive.addfile(entry, content)
            entry = tarfile.TarInfo("manifest.json")
            entry.size = len(manifest)
            entry.mode = 0o600
            archive.addfile(entry, io.BytesIO(manifest))
            if signature is not None:
                entry = tarfile.TarInfo(SIGNATURE)
                entry.size, entry.mode = len(signature), 0o600
                archive.addfile(entry, io.BytesIO(signature))
        destination.chmod(0o600)
    return identity


def restore_archive(
    archive_path: Path,
    target: Path,
    *,
    expected: Mapping[str, str | None] | None = None,
) -> dict[str, object]:
    """Restore after verifying members, signature and the expected identity.

    `expected` names the archive recorded at backup time (archive_id, kind, scope,
    operation_id and/or the SHA-256 of the whole file), so an older genuine
    archive cannot be substituted. Production requires archive_id or sha256.
    A format 1 archive has no identity: with a key or in production it is
    restored only when bound by its recorded SHA-256.
    """
    keys = _archive_keys()  # configuration errors leave nothing behind
    wanted = dict(expected or {})
    production = _production()
    if set(wanted) - EXPECTED_FIELDS:
        raise ValueError("Unknown expected archive field")
    if production and not (wanted.get("archive_id") or wanted.get("sha256")):
        raise ValueError(
            "Production restore requires the expected archive identity or SHA-256"
        )
    # lexists: a dangling symbolic link also counts as an existing target.
    if os.path.lexists(target):
        raise ValueError("Restore target must not exist; use a new isolated directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Claim the name atomically. rename() would silently replace an empty
    # directory created by someone else after the check above.
    try:
        os.mkdir(target, 0o700)
    except FileExistsError as exc:
        raise ValueError(
            "Restore target must not exist; use a new isolated directory"
        ) from exc
    try:
        with archive_path.open("rb") as raw:
            hashed = os.fstat(raw.fileno())
            archive_digest = hashlib.file_digest(raw, "sha256").hexdigest()
            if wanted.get("sha256") is not None and not hmac.compare_digest(
                archive_digest.encode(), str(wanted["sha256"]).lower().encode()
            ):
                raise ValueError(
                    "Archive is not the expected archive (SHA-256 differs)"
                )
            raw.seek(0)
            with tarfile.open(fileobj=raw, mode="r:gz") as archive:
                entries = []
                names: set[str] = set()
                total = 0
                for entry in archive:
                    name = PurePosixPath(entry.name)
                    if (
                        name.is_absolute()
                        or ".." in name.parts
                        or "\\" in entry.name
                        or not name.parts
                        or name.as_posix() != entry.name
                        or not entry.isfile()
                        or entry.name in names
                    ):
                        raise ValueError("Unsafe or duplicate archive member")
                    names.add(entry.name)
                    total += entry.size
                    if len(names) > MAX_FILES + 1 or total > MAX_BYTES:
                        raise ValueError("Archive resource limit exceeded")
                    entries.append(entry)
                # One member must not be both a file and a directory ("a" and "a/b").
                # Names that differ only by case or Unicode normalisation are valid on
                # case-sensitive file systems; where they collide, exclusive creation
                # below fails and is reported as an unsafe member instead.
                if any(
                    "/".join(PurePosixPath(n).parts[:i]) in names
                    for n in names
                    for i in range(1, len(PurePosixPath(n).parts))
                ):
                    raise ValueError("Unsafe or duplicate archive member")
                if "manifest.json" not in names:
                    raise ValueError(
                        "Verified restore requires a manifest; legacy backup needs explicit migration"
                    )
                manifest_entry = archive.getmember("manifest.json")
                if manifest_entry.size > 20 * 1024**2:
                    raise ValueError("Manifest too large")
                stream = archive.extractfile(manifest_entry)
                assert stream is not None
                manifest_bytes = stream.read()
                manifest = json.loads(manifest_bytes)
                if not isinstance(manifest, dict) or not isinstance(
                    manifest.get("files"), dict
                ):
                    raise ValueError("Manifest member set mismatch")
                recorded = manifest["files"]
                if (
                    type(manifest.get("format")) is not int
                    or manifest["format"] not in (1, 2)
                    or set(recorded) != names - {"manifest.json", SIGNATURE}
                ):
                    raise ValueError("Manifest member set mismatch")
                if manifest["format"] == 2:
                    identity = _checked_identity(manifest)
                    if any(
                        identity[field] != wanted[field]
                        for field in EXPECTED_FIELDS - {"sha256"}
                        if field in wanted
                    ):
                        raise ValueError(
                            "Archive identity differs from the expected archive"
                        )
                else:
                    identity = {"format": 1}
                    if (EXPECTED_FIELDS - {"sha256"}) & set(wanted):
                        raise ValueError(
                            "A format 1 archive has no identity; expect its recorded SHA-256"
                        )
                    if (keys is not None or production) and wanted.get(
                        "sha256"
                    ) is None:
                        raise ValueError(
                            "A format 1 archive requires its recorded SHA-256"
                        )
                if keys is not None:
                    # With a configured keyring, only an archive signed with one of its keys is restored.
                    if (
                        SIGNATURE not in names
                        or archive.getmember(SIGNATURE).size > 64 * 1024
                    ):
                        raise ValueError("Archive signature missing or invalid")
                    signed = archive.extractfile(archive.getmember(SIGNATURE))
                    assert signed is not None
                    _verify_signature(
                        keys, json.loads(signed.read()), manifest_bytes, manifest
                    )
                with tempfile.TemporaryDirectory(
                    prefix="pharmshift-restore-", dir=target.parent
                ) as temp:
                    staging = Path(temp) / "verified"
                    staging.mkdir(mode=0o700)
                    for entry in entries:
                        stream = archive.extractfile(entry)
                        assert stream is not None
                        dest = staging / entry.name
                        try:
                            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                            output_file = dest.open("xb")
                        except (
                            FileExistsError,
                            NotADirectoryError,
                            IsADirectoryError,
                        ) as exc:
                            raise ValueError(
                                "Unsafe or duplicate archive member"
                            ) from exc
                        digest = hashlib.sha256()
                        with output_file as output:
                            while chunk := stream.read(1024 * 1024):
                                output.write(chunk)
                                digest.update(chunk)
                        if entry.name not in ("manifest.json", SIGNATURE):
                            record = recorded[entry.name]
                            if record != {
                                "sha256": digest.hexdigest(),
                                "size": entry.size,
                            }:
                                raise ValueError("Archive checksum mismatch")
                        dest.chmod(0o600)
                    after = os.fstat(raw.fileno())
                    if (
                        hashed.st_ino,
                        hashed.st_size,
                        hashed.st_mtime_ns,
                        hashed.st_ctime_ns,
                    ) != (
                        after.st_ino,
                        after.st_size,
                        after.st_mtime_ns,
                        after.st_ctime_ns,
                    ):
                        raise ValueError("Archive changed during restore")
                    # Replaces only our own empty placeholder; fails if it gained content.
                    try:
                        os.rename(staging, target)
                    except OSError as exc:
                        raise ValueError(
                            "Restore target changed during restore"
                        ) from exc
        return {**identity, "sha256": archive_digest}
    except BaseException as exc:
        with contextlib.suppress(OSError):
            os.rmdir(target)  # only our empty placeholder; never other content
        if isinstance(
            exc,
            (
                tarfile.TarError,
                EOFError,
                gzip.BadGzipFile,
                zlib.error,
                json.JSONDecodeError,
                UnicodeDecodeError,
                RecursionError,
            ),
        ):
            raise ValueError("Archive is corrupt or unreadable") from exc
        raise


def create_managed_archive(
    factory: sessionmaker[Session],
    scope: str,
    source_copies: dict[str, str],
    copy_id: str,
) -> Path:
    """Backup registered managed files without unregistered temporary byte copies.

    Native PostgreSQL dumps and unregistered legacy directories are deliberately
    not inferred into this file-backup interface. Those require separate capture
    and consistency-point evidence. Source IDs/hashes are included in the archive.
    """
    import stat

    from sqlalchemy import select

    from shift_scheduler.application.copies import checked_file
    from shift_scheduler.db.compliance_models import ManagedCopy
    from shift_scheduler.ops import managed_writer

    # Fail before reserving or writing anything when the key is missing, short or unusable.
    signer = _signing_key(_archive_keys())
    managed_writer.reserve_capture(
        factory, scope, copy_id, "backup.files", source_copies
    )

    def produce(stream: IO[bytes]) -> None:
        with factory() as session:
            rows = {
                r.copy_id: r
                for r in session.scalars(
                    select(ManagedCopy).where(ManagedCopy.copy_id.in_(source_copies))
                )
            }
            if len(rows) != len(source_copies) or any(
                r.medium not in {"file", "backup"} for r in rows.values()
            ):
                raise ValueError("File backups require registered file sources")
            paths = {
                key: checked_file(rows[key].locator["relative_path"])
                for key in source_copies
            }
        if len(paths) > MAX_FILES:
            raise ValueError("Backup file limit exceeded")
        files, total = {}, 0
        with tarfile.open(fileobj=stream, mode="w|gz") as archive:
            for key, path in sorted(paths.items()):
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, "rb") as original:
                    before = os.fstat(original.fileno())
                    if not stat.S_ISREG(before.st_mode):
                        raise ValueError("Backup source is not a regular file")
                    total += before.st_size
                    if total > MAX_BYTES:
                        raise ValueError("Backup byte limit exceeded")
                    digest = hashlib.file_digest(original, "sha256").hexdigest()
                    if digest != source_copies[key]:
                        raise ValueError("Backup source hash changed")
                    original.seek(0)
                    name = "copies/" + key
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode = before.st_size, 0o600
                    written = _HashingReader(original)
                    archive.addfile(entry, written)
                    after = os.fstat(original.fileno())
                    # The bytes written to the tar are re-hashed: an in-place rewrite that
                    # restores size and mtime is caught too.
                    if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                        after.st_size,
                        after.st_mtime_ns,
                        after.st_ino,
                    ) or written.hash.hexdigest() != digest:
                        raise ValueError("Backup source changed while reading")
                    files[name] = {"sha256": digest, "size": before.st_size}
            identity = _identity("managed", scope, copy_id, archive_id=copy_id)
            manifest = json.dumps(
                {
                    "format": 2,
                    "identity": identity,
                    "sources": source_copies,
                    "files": files,
                },
                sort_keys=True,
            ).encode()
            entry = tarfile.TarInfo("manifest.json")
            entry.size, entry.mode = len(manifest), 0o600
            archive.addfile(entry, io.BytesIO(manifest))
            signature = _signature(manifest, signer)
            if signature is not None:
                entry = tarfile.TarInfo(SIGNATURE)
                entry.size, entry.mode = len(signature), 0o600
                archive.addfile(entry, io.BytesIO(signature))

    return managed_writer.capture(factory, scope, copy_id, produce)
