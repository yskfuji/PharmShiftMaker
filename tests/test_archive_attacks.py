"""S05: hostile archives, restore targets and erasure targets (local temp files only)."""

import hashlib
import io
import json
import os
import tarfile
import unicodedata
from pathlib import Path

import pytest

from shift_scheduler.ops import archive as archive_module
from shift_scheduler.ops.archive import create_archive, restore_archive
from shift_scheduler.ops.managed_erasure import erase_verified


def record(data):
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}


def build(path, members, *, manifest="auto", extra=()):
    """members: name -> bytes. extra: prepared TarInfo objects added as-is."""
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for info in extra:
            tar.addfile(info)
        if manifest is not None:
            body = (
                manifest
                if isinstance(manifest, bytes)
                else json.dumps(
                    {
                        "format": 1,
                        "sources": {},
                        "files": {n: record(d) for n, d in members.items()},
                    }
                ).encode()
            )
            info = tarfile.TarInfo("manifest.json")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return path


def refused(archive, target, match=None):
    with pytest.raises(ValueError, match=match):
        restore_archive(archive, target)
    # Nothing is left behind: no target, no staging directory.
    assert not os.path.lexists(target)
    assert not [
        p for p in target.parent.iterdir() if p.name.startswith("pharmshift-restore-")
    ]


def test_valid_archive_restores_and_target_is_private(tmp_path):
    good = build(tmp_path / "good.tar.gz", {"sources/0000/a.txt": b"alpha"})
    restore_archive(good, tmp_path / "out")
    assert (tmp_path / "out/sources/0000/a.txt").read_bytes() == b"alpha"


def special(name, kind):
    info = tarfile.TarInfo(name)
    info.type = kind
    if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
        info.linkname = "/etc/passwd"
    return info


@pytest.mark.parametrize(
    "kind",
    [
        tarfile.SYMTYPE,
        tarfile.LNKTYPE,
        tarfile.CHRTYPE,
        tarfile.BLKTYPE,
        tarfile.FIFOTYPE,
        tarfile.DIRTYPE,
    ],
)
def test_non_regular_members_are_refused(tmp_path, kind):
    bad = build(tmp_path / "bad.tar.gz", {}, extra=[special("x", kind)])
    refused(bad, tmp_path / "out", "Unsafe")


@pytest.mark.parametrize("name", ["./a", "a//b", "a/", ".", "a/./b"])
def test_non_normalised_names_are_refused(tmp_path, name):
    bad = build(tmp_path / "bad.tar.gz", {name: b"x"})
    refused(bad, tmp_path / "out", "Unsafe")


def test_duplicate_member_is_refused(tmp_path):
    info = tarfile.TarInfo("a")
    info.size = 1
    path = tmp_path / "dup.tar.gz"
    with tarfile.open(path, "w:gz") as tar:
        tar.addfile(info, io.BytesIO(b"1"))
        tar.addfile(info, io.BytesIO(b"2"))
    refused(path, tmp_path / "out", "duplicate")


@pytest.mark.parametrize("names", [("x", "x/y"), ("x/y", "x")])
def test_file_and_directory_clash_is_refused_before_any_write(tmp_path, names):
    bad = build(tmp_path / "bad.tar.gz", dict.fromkeys(names, b"x"))
    refused(bad, tmp_path / "out", "Unsafe or duplicate")


@pytest.mark.parametrize(
    "names",
    [
        ("A.txt", "a.txt"),
        (unicodedata.normalize("NFC", "é.txt"), unicodedata.normalize("NFD", "é.txt")),
        ("Dir/f", "dir"),
    ],
)
def test_names_differing_by_case_restore_distinctly_or_are_refused(tmp_path, names):
    # Valid on case-sensitive file systems (a backup made there must restore);
    # where the file system folds them, one must never overwrite the other.
    members = {n: n.encode() for n in names}
    archive = build(tmp_path / "case.tar.gz", members)
    target = tmp_path / "out"
    try:
        restore_archive(archive, target)
    except ValueError as error:
        assert "Unsafe or duplicate" in str(error)
        assert not os.path.lexists(target)
        return
    for name, data in members.items():
        assert (target / name).read_bytes() == data


@pytest.mark.parametrize(
    "manifest,match",
    [
        (None, "requires a manifest"),
        (b"{not json", "corrupt"),
        (b"[]", "mismatch"),
        (b'{"format": 1, "files": []}', "mismatch"),
        (b'{"format": 2, "files": {}}', "mismatch"),
        (b"\xff\xfe", "corrupt"),
    ],
)
def test_missing_or_malformed_manifest_is_refused(tmp_path, manifest, match):
    bad = build(tmp_path / "bad.tar.gz", {}, manifest=manifest)
    refused(bad, tmp_path / "out", match)


def test_manifest_member_set_and_checksum_must_match(tmp_path):
    body = json.dumps({"format": 1, "files": {"a": record(b"a")}}).encode()
    extra_member = build(
        tmp_path / "extra.tar.gz", {"a": b"a", "b": b"b"}, manifest=body
    )
    refused(extra_member, tmp_path / "out1", "mismatch")
    wrong = json.dumps({"format": 1, "files": {"a": record(b"A")}}).encode()
    tampered = build(tmp_path / "tampered.tar.gz", {"a": b"a"}, manifest=wrong)
    refused(tampered, tmp_path / "out2", "checksum")


def test_oversized_manifest_is_refused(tmp_path):
    bad = build(tmp_path / "big.tar.gz", {}, manifest=b" " * (20 * 1024**2 + 1))
    refused(bad, tmp_path / "out", "too large")


def test_resource_limits_use_declared_sizes(tmp_path, monkeypatch):
    many = build(tmp_path / "many.tar.gz", {f"f{i}": b"x" for i in range(3)})
    monkeypatch.setattr(archive_module, "MAX_FILES", 2)
    refused(many, tmp_path / "out1", "limit")
    monkeypatch.setattr(archive_module, "MAX_FILES", 100)
    monkeypatch.setattr(archive_module, "MAX_BYTES", 5)
    large = build(tmp_path / "large.tar.gz", {"f": b"123456"})
    refused(large, tmp_path / "out2", "limit")


def test_corrupt_or_truncated_archives_become_value_errors(tmp_path):
    noise = tmp_path / "noise.tar.gz"
    noise.write_bytes(os.urandom(512))
    refused(noise, tmp_path / "out1", "corrupt")
    good = build(tmp_path / "good.tar.gz", {"a": os.urandom(200_000)})
    truncated = tmp_path / "truncated.tar.gz"
    truncated.write_bytes(good.read_bytes()[: good.stat().st_size // 2])
    refused(truncated, tmp_path / "out2", "corrupt")


def test_dangling_symlink_and_existing_empty_directory_targets_are_refused(tmp_path):
    good = build(tmp_path / "good.tar.gz", {"a": b"a"})
    dangling = tmp_path / "dangling"
    dangling.symlink_to(tmp_path / "nowhere")
    with pytest.raises(ValueError, match="must not exist"):
        restore_archive(good, dangling)
    assert dangling.is_symlink() and not (tmp_path / "nowhere").exists()
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(ValueError, match="must not exist"):
        restore_archive(good, empty)
    assert list(empty.iterdir()) == []


def test_content_placed_into_the_target_during_restore_is_never_replaced(
    tmp_path, monkeypatch
):
    good = build(tmp_path / "good.tar.gz", {"a": b"a"})
    target = tmp_path / "out"
    real_rename = os.rename

    def racing_rename(src, dst, *args, **kwargs):
        if Path(dst) == target:
            target.mkdir(exist_ok=True)
            (target / "intruder").write_bytes(b"keep me")  # someone else writes first
        return real_rename(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "rename", racing_rename)
    with pytest.raises(ValueError, match="changed during restore"):
        restore_archive(good, target)
    assert (target / "intruder").read_bytes() == b"keep me"


def test_target_name_is_claimed_before_extraction(tmp_path, monkeypatch):
    # rename() silently replaces an empty directory, so another process that
    # creates the target just before the final rename must be refused the name.
    good = build(tmp_path / "good.tar.gz", {"a": b"a"})
    target = tmp_path / "out"
    real_rename = os.rename
    outcome = []

    def racing_rename(src, dst, *args, **kwargs):
        if Path(dst) == target:
            try:
                os.mkdir(target)
                outcome.append("other process got the name")
            except FileExistsError:
                outcome.append("name already claimed")
        return real_rename(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "rename", racing_rename)
    restore_archive(good, target)
    assert outcome == ["name already claimed"]


def test_create_archive_refuses_a_source_swapped_for_a_link(tmp_path, monkeypatch):
    source = tmp_path / "src"
    source.mkdir()
    (tmp_path / "secret").write_bytes(b"outside")
    (source / "file").symlink_to(tmp_path / "secret")
    # Model the swap happening after the path-based symlink check.
    monkeypatch.setattr(Path, "is_symlink", lambda self: False)
    with pytest.raises(ValueError, match="link"):
        create_archive([source], tmp_path / "backup.tar.gz")
    assert not (tmp_path / "backup.tar.gz").exists()


def managed(tmp_path, data=b"payload"):
    root = tmp_path / "root"
    (root / "dir").mkdir(parents=True)
    target = root / "dir" / "file"
    target.write_bytes(data)
    return root, target, hashlib.sha256(data).hexdigest()


def test_erasure_of_a_hardlinked_file_is_refused_and_both_copies_are_kept(tmp_path):
    root, target, digest = managed(tmp_path)
    other = tmp_path / "other-link"
    os.link(target, other)
    with pytest.raises(ValueError, match="exclusively managed"):
        erase_verified(root, "dir/file", "c1", digest)
    # Deleting one link would not erase the data: it stays quarantined, not unlinked.
    assert other.read_bytes() == b"payload"
    assert len(list((root / ".erasure").iterdir())) == 1


def test_erasure_does_not_follow_links(tmp_path):
    root, target, digest = managed(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file").write_bytes(b"payload")
    (root / "linked").symlink_to(outside, target_is_directory=True)
    with pytest.raises(OSError):
        erase_verified(root, "linked/file", "c2", digest)
    target.unlink()
    target.symlink_to(outside / "file")
    with pytest.raises(OSError):
        erase_verified(root, "dir/file", "c3", digest)
    assert (outside / "file").read_bytes() == b"payload"


@pytest.mark.parametrize("relative", ["../x", "/abs", ".erasure/x", ""])
def test_erasure_rejects_escaping_locations(tmp_path, relative):
    root, _, digest = managed(tmp_path)
    with pytest.raises(ValueError, match="Invalid"):
        erase_verified(root, relative, "c4", digest)


def test_erasure_requires_a_private_quarantine_and_matching_hash(tmp_path):
    root, target, digest = managed(tmp_path)
    (root / ".erasure").mkdir(mode=0o755)
    os.chmod(root / ".erasure", 0o755)
    with pytest.raises(ValueError, match="private"):
        erase_verified(root, "dir/file", "c5", digest)
    assert target.exists()
    os.chmod(root / ".erasure", 0o700)
    with pytest.raises(ValueError, match="differs"):
        erase_verified(root, "dir/file", "c5", "0" * 64)
    assert len(list((root / ".erasure").iterdir())) == 1  # preserved for review
    assert (
        erase_verified(root, "dir/file", "c5", digest) is True
    )  # retry with the right hash
    assert list((root / ".erasure").iterdir()) == []
