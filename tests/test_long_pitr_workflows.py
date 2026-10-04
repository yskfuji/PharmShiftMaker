"""Bridge guards; physical recovery is tested separately against owned PG."""

import hashlib
from datetime import UTC, datetime

import pytest
from scripts.long_pitr_workflows import file_catalogue, scoped_url
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shift_scheduler.db.base import Base
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy


@pytest.fixture
def catalogue(tmp_path):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    root = tmp_path / "files"
    root.mkdir()
    identity = "a" * 32
    (root / identity).write_bytes(b"original typed export")
    with factory.begin() as s:
        s.add(
            ManagedCopy(
                copy_id=identity,
                scope_id="hospital/a",
                category="exports",
                medium="file",
                locator={"relative_path": identity},
                content_hash=hashlib.sha256((root / identity).read_bytes()).hexdigest(),
                revision=1,
                state="PRESENT",
                subject_status="UNVERIFIED",
                anchor="last_activity",
                anchor_at=datetime.now(UTC),
                evidence={},
            )
        )
        s.flush()
        s.add(CopySubject(copy_id=identity, person_id="p0"))
    yield factory, root, identity
    engine.dispose()


def test_file_snapshot_does_not_promote_unknown_ownership(catalogue):
    factory, root, identity = catalogue
    observed = file_catalogue(factory, root)
    assert observed[0]["subject_status"] == "UNVERIFIED"
    assert observed[0]["people"] == ["p0"]
    (root / (".lock-" + identity)).touch()
    assert file_catalogue(factory, root) == observed
    (root / "unregistered.csv").write_bytes(b"p0")
    with pytest.raises(ValueError, match="Unregistered"):
        file_catalogue(factory, root)


@pytest.mark.parametrize("mutation", ["missing", "modified", "symlink", "lock-payload"])
def test_managed_file_faults_are_rejected(catalogue, mutation):
    factory, root, identity = catalogue
    path = root / identity
    if mutation == "missing":
        path.unlink()
    elif mutation == "modified":
        path.write_bytes(b"modified")
    elif mutation == "symlink":
        path.unlink()
        (root.parent / "outside").write_bytes(b"original typed export")
        path.symlink_to(root.parent / "outside")
    else:
        (root / (".lock-" + identity)).write_bytes(b"person information")
    with pytest.raises(ValueError):
        file_catalogue(factory, root)


def test_scoped_connection_preserves_other_settings_and_refuses_unsafe_schema():
    from sqlalchemy.engine import make_url

    result = make_url(
        scoped_url(
            "postgresql+psycopg://user:secret@127.0.0.1/app?sslmode=disable",
            "audit_123abc",
        )
    )
    assert result.query == {
        "sslmode": "disable",
        "options": "-csearch_path=audit_123abc",
    }
    with pytest.raises(ValueError):
        scoped_url(str(result), "public; DROP DATABASE app")


@pytest.mark.parametrize(
    "leftover", ["none", "bytes", "quarantine-file", "quarantine-mode", "foreign-lock"]
)
def test_settled_erasure_leftovers_are_bounded(catalogue, leftover):
    factory, root, identity = catalogue
    with factory.begin() as s:
        s.get(ManagedCopy, identity).state = "ERASED"
    (root / identity).unlink()
    (root / (".lock-" + identity)).touch()
    quarantine = root / ".erasure"
    quarantine.mkdir(mode=0o700)
    quarantine.chmod(0o700)
    if leftover == "none":
        assert file_catalogue(factory, root) == []
        return
    if leftover == "bytes":
        (root / identity).write_bytes(b"original typed export")
    elif leftover == "quarantine-file":
        (quarantine / identity).write_bytes(b"original typed export")
    elif leftover == "quarantine-mode":
        quarantine.chmod(0o755)
    else:
        (root / (".lock-" + "b" * 32)).touch()
    with pytest.raises(ValueError):
        file_catalogue(factory, root)
