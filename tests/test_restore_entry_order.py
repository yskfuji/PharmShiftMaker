from argparse import Namespace

import pytest
from scripts import backup_pipeline as pipeline

from shift_scheduler.control import client
from shift_scheduler.db.restore_lock import RestoreUnavailable


@pytest.mark.parametrize("failure", [None, "quarantine", "database"])
def test_no_file_extraction_before_authority_and_database_quarantine(
    tmp_path, monkeypatch, failure
):
    events = []

    class Authority:
        def request(self, method, path):
            events.append("quarantine")
            if failure == "quarantine":
                raise RestoreUnavailable("Unavailable control")

    def database(*args):
        events.append("database")
        if failure == "database":
            raise ValueError("Invalid isolated target")

    monkeypatch.setattr(client, "configured_client", lambda: Authority())
    monkeypatch.setenv("PHARMSHIFT_RESTORE_NODE", "isolated")
    monkeypatch.setattr(pipeline, "run_pg_restore", database)
    monkeypatch.setattr(
        pipeline, "extract_tarball", lambda *args: events.append("files")
    )
    args = Namespace(
        tarball="synthetic.tar",
        dump_file="synthetic.dump",
        target_dir=str(tmp_path / "restored"),
        db_url="postgresql://local/isolated_restore",
        pg_restore="pg_restore",
    )
    if failure:
        with pytest.raises((RestoreUnavailable, ValueError)):
            pipeline.restore_command(args)
        assert "files" not in events
    else:
        pipeline.restore_command(args)
        assert events == ["quarantine", "database", "files"]
