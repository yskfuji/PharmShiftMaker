import os

import pytest
from scripts.owned_pitr import ARCHIVE, OwnedPITR
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError


def test_invalid_resource_labels():
    for label in ("../x", "x;rm", "", "x" * 41):
        with pytest.raises(ValueError):
            OwnedPITR.label(label)


@pytest.mark.skipif(
    os.environ.get("PHARMSHIFT_TEST_OWNED_PITR") != "1", reason="owned Docker opt-in"
)
def test_reusable_physical_recovery_and_archive(tmp_path):
    with OwnedPITR(tmp_path / "pitr") as p:
        engine = create_engine(p.source_url)
        with engine.begin() as c:
            c.execute(text("CREATE TABLE events(id integer PRIMARY KEY)"))
            c.execute(text("INSERT INTO events VALUES(1)"))
        base = p.backup("base")
        with engine.begin() as c:
            c.execute(text("INSERT INTO events VALUES(2)"))
        target = p.mark_target("accepted")
        with engine.begin() as c:
            c.execute(text("INSERT INTO events VALUES(3)"))
        restored = p.restore(base, target)
        assert p.sql("SELECT id FROM events ORDER BY id", restored) == "1\n2"
        blocked = create_engine(restored["application_url"])
        with pytest.raises(OperationalError), blocked.connect():
            pass
        assert not hasattr(p, "open_application")
        assert restored["timeline"] == "2"
        assert len(base["manifest_sha256"]) == 64
        assert len(target["wal_sha256"]) == 64
        p.cmd(
            "exec",
            p.source["container"],
            "bash",
            "-ec",
            "printf same > /tmp/archive-input",
        )

        def archive():
            return p.cmd(
                "exec",
                p.source["container"],
                "bash",
                "-c",
                ARCHIVE,
                "archive",
                "/tmp/archive-input",
                "retry-test",
                check=False,
            )

        assert archive().returncode == 0
        assert archive().returncode == 0
        p.cmd(
            "exec",
            p.source["container"],
            "bash",
            "-ec",
            "mkdir /tmp/sync-bin; printf '#!/bin/sh\nexit 55\n' > /tmp/sync-bin/sync; chmod +x /tmp/sync-bin/sync",
        )
        failed_sync = p.cmd(
            "exec",
            "-e",
            "PATH=/tmp/sync-bin:/usr/bin:/bin",
            p.source["container"],
            "bash",
            "-c",
            ARCHIVE,
            "archive",
            "/tmp/archive-input",
            "retry-test",
            check=False,
        )
        assert failed_sync.returncode == 55
        p.cmd(
            "exec",
            p.source["container"],
            "bash",
            "-ec",
            "printf changed > /tmp/archive-input",
        )
        assert archive().returncode != 0
        assert (
            p.cmd("exec", p.source["container"], "cat", "/archive/retry-test").stdout
            == "same"
        )
        engine.dispose()
        blocked.dispose()


@pytest.mark.skipif(
    os.environ.get("PHARMSHIFT_TEST_OWNED_PITR") != "1", reason="owned Docker opt-in"
)
def test_target_validation_and_wal_faults(tmp_path):
    with OwnedPITR(tmp_path / "faults") as p:
        p.sql("CREATE TABLE events(id integer); INSERT INTO events VALUES(1);")
        base = p.backup("base")
        p.sql("SELECT pg_switch_wal(); INSERT INTO events VALUES(2);")
        target = p.mark_target("good")
        with pytest.raises(ValueError, match="Invalid recovery target"):
            p.restore(base, {**target, "name": "bad';touch /tmp/x"})
        for fault in ("missing_wal", "corrupt_wal"):
            expected = (
                "recovery ended before configured recovery target was reached"
                if fault == "missing_wal"
                else "has wrong size"
            )
            with pytest.raises(RuntimeError, match=expected):
                p.restore(base, target, fault=fault)
