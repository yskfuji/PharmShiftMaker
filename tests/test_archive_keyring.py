"""S05: archive keyring with usage periods, signature format 2 and archive identity.

Key usage follows NIST SP 800-57 Pt 1 Rev 5 (5.3.6): a key that no longer signs
may still verify during its recipient-usage period; a compromised key does
neither. The identity (archive_id, kind, scope, created_at, operation_id) is
inside the signed manifest, and restore compares it with the archive recorded at
backup time, so an older genuine archive cannot be substituted.
Local temporary files only.
"""

import hashlib
import hmac
import io
import json
import tarfile
from argparse import Namespace
from datetime import UTC, datetime, timedelta

import pytest

from shift_scheduler.ops import archive as archive_module
from shift_scheduler.ops.archive import (
    archive_identity,
    create_archive,
    restore_archive,
)

K1, K2 = "1" * 32, "2" * 32
NOW = datetime(2026, 9, 27, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (
        "PHARMSHIFT_ARCHIVE_KEY",
        "PHARMSHIFT_ARCHIVE_KEY_ID",
        "PHARMSHIFT_ARCHIVE_KEYRING",
        "PHARMSHIFT_ENV",
        "PHARMSHIFT_CONTROL_URL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(archive_module, "_now", lambda: NOW)


def ring(monkeypatch, *keys):
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEYRING", json.dumps({"keys": list(keys)}))


def key(key_id, secret, state="active", **periods):
    return {
        "key_id": key_id,
        "secret": secret,
        "state": state,
        **{k: v.isoformat() for k, v in periods.items()},
    }


def make(tmp_path, name="backup.tar.gz", content=b"alpha", **identity):
    source = tmp_path / f"src-{name}"
    source.mkdir()
    (source / "a.txt").write_bytes(content)
    path = tmp_path / name
    return path, create_archive([source], path, **identity)


def members(path):
    with tarfile.open(path, "r:gz") as tar:
        return {m.name: tar.extractfile(m).read() for m in tar}


def write(path, contents):
    path.unlink(missing_ok=True)
    with tarfile.open(path, "w:gz") as tar:
        for name, data in contents.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def test_rotation_keeps_old_archives_verifiable_and_signs_with_the_new_key(
    tmp_path, monkeypatch
):
    ring(monkeypatch, key("k1", K1))
    old, identity = make(tmp_path, "old.tar.gz")
    assert json.loads(members(old)["manifest.sig"])["key_id"] == "k1"
    ring(monkeypatch, key("k1", K1, "deactivated"), key("k2", K2))
    assert (
        restore_archive(old, tmp_path / "out-old")["archive_id"]
        == identity["archive_id"]
    )
    new, _ = make(tmp_path, "new.tar.gz")
    claim = json.loads(members(new)["manifest.sig"])
    assert (claim["key_id"], claim["format"]) == ("k2", 2)
    restore_archive(new, tmp_path / "out-new")


def test_a_compromised_or_expired_key_no_longer_verifies(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, _ = make(tmp_path)
    ring(monkeypatch, key("k1", K1, "compromised"), key("k2", K2))
    with pytest.raises(ValueError, match="compromised"):
        restore_archive(path, tmp_path / "out1")
    ring(monkeypatch, key("k1", K1, "deactivated", verify_until=NOW), key("k2", K2))
    with pytest.raises(ValueError, match="verification period"):
        restore_archive(path, tmp_path / "out2")
    assert not (tmp_path / "out1").exists() and not (tmp_path / "out2").exists()


def test_an_archive_claiming_creation_after_the_signing_period_is_refused(
    tmp_path, monkeypatch
):
    # The signing period is later shortened (e.g. a suspected leak from that time).
    ring(monkeypatch, key("k1", K1))
    path, _ = make(tmp_path)
    ring(monkeypatch, key("k1", K1, "deactivated", sign_until=NOW), key("k2", K2))
    with pytest.raises(ValueError, match="after its key's signing period"):
        restore_archive(path, tmp_path / "out")
    ring(
        monkeypatch,
        key("k1", K1, "deactivated", sign_until=NOW + timedelta(seconds=1)),
        key("k2", K2),
    )
    restore_archive(path, tmp_path / "out")


@pytest.mark.parametrize(
    "keys",
    [
        [key("k1", K1, sign_until=NOW)],  # signing period over
        [key("k1", K1), key("k2", K2)],  # two primaries
        [key("k1", K1, "deactivated")],  # none active
    ],
)
def test_exactly_one_active_key_signs(tmp_path, monkeypatch, keys):
    ring(monkeypatch, *keys)
    with pytest.raises(ValueError, match="exactly one active key"):
        make(tmp_path)
    assert not (tmp_path / "backup.tar.gz").exists()


@pytest.mark.parametrize(
    "config",
    [
        "not json",
        json.dumps({"keys": []}),
        json.dumps([]),
        json.dumps({"keys": [key("k1", K1), key("k1", K2)]}),  # repeated ID
        json.dumps({"keys": [key("k1", K1), key("k2", K1)]}),  # repeated secret
        json.dumps({"keys": [key("k1", "short")]}),
        json.dumps({"keys": [key("k/1", K1)]}),
        json.dumps({"keys": [key("k1", K1, "revoked")]}),
        json.dumps(
            {"keys": [{**key("k1", K1), "sign_until": "2026-01-01T00:00:00"}]}
        ),  # no offset
        json.dumps(
            {
                "keys": [
                    key("k1", K1, sign_until=NOW, verify_until=NOW - timedelta(days=1))
                ]
            }
        ),
        json.dumps({"keys": [{**key("k1", K1), "note": "x"}]}),
    ],
)
def test_malformed_keyrings_are_refused(tmp_path, monkeypatch, config):
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEYRING", config)
    with pytest.raises(ValueError):
        make(tmp_path)


def test_a_keyring_and_a_single_key_are_not_combined(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", K2)
    with pytest.raises(ValueError, match="either"):
        make(tmp_path)


def test_the_signature_binds_its_purpose_and_format(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, _ = make(tmp_path)
    contents = members(path)
    manifest = contents["manifest.json"]
    plain = hmac.new(K1.encode(), manifest, hashlib.sha256).hexdigest()
    # A MAC over the manifest alone (the old form, or any other use of the key)
    # does not verify as format 2, and a format 1 claim on a format 2 manifest is
    # a downgrade.
    for claim in (
        {"format": 2, "key_id": "k1", "algorithm": "HMAC-SHA256", "mac": plain},
        {"key_id": "k1", "algorithm": "HMAC-SHA256", "mac": plain},
    ):
        write(path, {**contents, "manifest.sig": json.dumps(claim).encode()})
        with pytest.raises(ValueError, match="signature"):
            restore_archive(path, tmp_path / "out")


def test_the_identity_is_signed(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, _ = make(tmp_path)
    contents = members(path)
    manifest = json.loads(contents["manifest.json"])
    manifest["identity"]["scope"] = "other/scope"
    write(
        path,
        {**contents, "manifest.json": json.dumps(manifest, sort_keys=True).encode()},
    )
    with pytest.raises(ValueError, match="signature"):
        restore_archive(path, tmp_path / "out")


def test_an_older_genuine_archive_is_not_accepted_for_the_recorded_one(
    tmp_path, monkeypatch
):
    ring(monkeypatch, key("k1", K1))
    old, _ = make(tmp_path, "old.tar.gz", b"old", scope="hospital/pharmacy")
    new, identity = make(tmp_path, "new.tar.gz", b"new", scope="hospital/pharmacy")
    with pytest.raises(ValueError, match="differs from the expected archive"):
        restore_archive(
            old, tmp_path / "out1", expected={"archive_id": identity["archive_id"]}
        )
    with pytest.raises(ValueError, match="SHA-256 differs"):
        restore_archive(
            old, tmp_path / "out2", expected={"sha256": archive_identity(new)["sha256"]}
        )
    with pytest.raises(ValueError, match="differs from the expected archive"):
        restore_archive(
            new,
            tmp_path / "out3",
            expected={"archive_id": identity["archive_id"], "scope": "other"},
        )
    restored = restore_archive(
        new,
        tmp_path / "out4",
        expected={"archive_id": identity["archive_id"], "scope": "hospital/pharmacy"},
    )
    assert restored["sha256"] == archive_identity(new)["sha256"]
    assert (tmp_path / "out4/sources/0000/src-new.tar.gz/a.txt").read_bytes() == b"new"
    with pytest.raises(ValueError, match="Unknown expected"):
        restore_archive(
            new, tmp_path / "out5", expected={"archiveid": identity["archive_id"]}
        )


def test_production_restores_only_a_named_archive(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, identity = make(tmp_path)
    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    with pytest.raises(ValueError, match="requires the expected archive"):
        restore_archive(path, tmp_path / "out")
    assert not (tmp_path / "out").exists()
    restore_archive(
        path, tmp_path / "out", expected={"archive_id": identity["archive_id"]}
    )


def legacy(tmp_path, secret=K1):
    """A format 1 archive with a format 1 signature, as written before this change."""
    data = b"alpha"
    manifest = json.dumps(
        {
            "format": 1,
            "sources": {},
            "files": {
                "a.txt": {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
            },
        },
        sort_keys=True,
    ).encode()
    signature = json.dumps(
        {
            "key_id": "k1",
            "algorithm": "HMAC-SHA256",
            "mac": hmac.new(secret.encode(), manifest, hashlib.sha256).hexdigest(),
        }
    ).encode()
    path = tmp_path / "legacy.tar.gz"
    write(path, {"a.txt": data, "manifest.json": manifest, "manifest.sig": signature})
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def test_a_format_1_archive_restores_only_when_bound_by_its_recorded_hash(
    tmp_path, monkeypatch
):
    path, digest = legacy(tmp_path)
    ring(monkeypatch, key("k1", K1, "deactivated"), key("k2", K2))
    with pytest.raises(ValueError, match="requires its recorded SHA-256"):
        restore_archive(path, tmp_path / "out1")
    with pytest.raises(ValueError, match="no identity"):
        restore_archive(
            path, tmp_path / "out2", expected={"archive_id": "x", "sha256": digest}
        )
    with pytest.raises(ValueError, match="SHA-256 differs"):
        restore_archive(path, tmp_path / "out3", expected={"sha256": "0" * 64})
    assert restore_archive(
        path, tmp_path / "out4", expected={"sha256": digest.upper()}
    ) == {"format": 1, "sha256": digest}
    # The old single-key setting still verifies it as a one-key ring.
    monkeypatch.delenv("PHARMSHIFT_ARCHIVE_KEYRING")
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", K1)
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY_ID", "k1")
    restore_archive(path, tmp_path / "out5", expected={"sha256": digest})


def test_the_restore_command_passes_the_recorded_identity(
    tmp_path, monkeypatch, capsys
):
    from scripts import backup_pipeline as pipeline

    from shift_scheduler.control import client

    ring(monkeypatch, key("k1", K1))
    path, identity = make(tmp_path)
    monkeypatch.setattr(client, "configured_client", lambda: None)
    args = Namespace(
        tarball=str(path),
        dump_file=None,
        db_url=None,
        pg_restore="pg_restore",
        target_dir=str(tmp_path / "wrong"),
        expect_archive_id="0" * 32,
        expect_sha256=None,
        expect_scope=None,
    )
    with pytest.raises(ValueError, match="differs from the expected archive"):
        pipeline.restore_command(args)
    args.target_dir, args.expect_archive_id = (
        str(tmp_path / "right"),
        identity["archive_id"],
    )
    pipeline.restore_command(args)
    assert (tmp_path / "right/manifest.json").exists()


def test_no_signature_is_made_after_the_signing_period(monkeypatch):
    # A long backup that outlives sign_until fails instead of producing an archive
    # that could never be restored ("creation after its key's signing period").
    key_ = archive_module.ArchiveKey("k1", K1.encode(), sign_until=NOW)
    with pytest.raises(ValueError, match="ended during the backup"):
        archive_module._signature(b"{}", key_)
    later = archive_module.ArchiveKey(
        "k1", K1.encode(), sign_until=NOW + timedelta(seconds=1)
    )
    assert archive_module._signature(b"{}", later)


def test_an_archive_rewritten_in_place_during_restore_is_refused(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, _ = make(tmp_path)
    digest = archive_identity(path)["sha256"]
    original = archive_module.hashlib.file_digest

    def hashed_then_rewritten(stream, name):
        result = original(stream, name)
        # Same bytes written back through another descriptor: ctime/mtime change.
        with path.open("r+b") as other:
            first = other.read(1)
            other.seek(0)
            other.write(first)
        return result

    monkeypatch.setattr(archive_module.hashlib, "file_digest", hashed_then_rewritten)
    with pytest.raises(ValueError, match="changed during restore"):
        restore_archive(path, tmp_path / "out", expected={"sha256": digest})
    assert not (tmp_path / "out").exists()


def test_a_control_configuration_counts_as_production(tmp_path, monkeypatch):
    ring(monkeypatch, key("k1", K1))
    path, identity = make(tmp_path)
    monkeypatch.delenv("PHARMSHIFT_ARCHIVE_KEYRING")
    monkeypatch.setenv("PHARMSHIFT_CONTROL_URL", "https://127.0.0.1:1")
    with pytest.raises(ValueError, match="require PHARMSHIFT_ARCHIVE_KEY"):
        restore_archive(
            path, tmp_path / "out", expected={"archive_id": identity["archive_id"]}
        )
    ring(monkeypatch, key("k1", K1))
    with pytest.raises(ValueError, match="requires the expected archive"):
        restore_archive(path, tmp_path / "out")


def test_a_boolean_manifest_format_is_refused(tmp_path):
    data = b"alpha"
    manifest = json.dumps(
        {
            "format": True,
            "sources": {},
            "files": {
                "a.txt": {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
            },
        }
    ).encode()
    path = tmp_path / "bool.tar.gz"
    write(path, {"a.txt": data, "manifest.json": manifest})
    with pytest.raises(ValueError, match="mismatch"):
        restore_archive(path, tmp_path / "out")


def test_a_refused_signature_leaves_no_partial_archive(tmp_path, monkeypatch):
    # The key is chosen at NOW; by the time the manifest is signed its period is over.
    ring(monkeypatch, key("k1", K1, sign_until=NOW + timedelta(seconds=1)))
    clock = iter(
        [NOW, NOW]
    )  # key selection, identity stamp; later calls are past sign_until
    monkeypatch.setattr(
        archive_module, "_now", lambda: next(clock, NOW + timedelta(seconds=2))
    )
    with pytest.raises(ValueError, match="ended during the backup"):
        make(tmp_path)
    assert not (tmp_path / "backup.tar.gz").exists()


def test_a_key_past_its_verification_period_does_not_sign():
    past = archive_module.ArchiveKey("k1", K1.encode(), verify_until=NOW)
    with pytest.raises(ValueError, match="ended during the backup"):
        archive_module._signature(b"{}", past)
