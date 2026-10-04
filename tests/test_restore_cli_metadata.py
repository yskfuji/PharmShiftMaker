"""Standalone CLI metadata regression."""

import json
import os
import subprocess
import sys

import pytest
from sqlalchemy import text

from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay

CHILD = """
import json,sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import scripts.erasure_manifest
from shift_scheduler.control.restore_verification import observe
value=json.load(sys.stdin)
engine=create_engine(value['url'])
try:
    result=observe(sessionmaker(engine),value['manifest_hash'])
    print(json.dumps({'accepted':True,'domains':sorted(result['observation_hashes'])}))
except ValueError as error:
    print(json.dumps({'accepted':False,'reason':str(error)}))
finally:
    engine.dispose()
"""


@pytest.mark.parametrize("unknown_table", [False, True])
def test_standalone_restore_cli_loads_supported_metadata_but_rejects_unknown_table(
    pg, tmp_path, monkeypatch, unknown_table
):
    root = tmp_path / "managed"
    root.mkdir()
    monkeypatch.setenv("PHARMSHIFT_MANAGED_STORAGE", str(root))
    secret = b"synthetic-standalone-verification-test"
    with pg.begin() as session:
        manifest = export_manifest(session, secret)
        quarantine(session)
        replay(session, manifest, content_hash(manifest), secret)
        if unknown_table:
            session.execute(
                text(
                    "CREATE TABLE unknown_product_copy (id text primary key,scope_id text)"
                )
            )
    result = subprocess.run(
        [sys.executable, "-c", CHILD],
        input=json.dumps(
            {
                "url": pg.kw["bind"].url.render_as_string(hide_password=False),
                "manifest_hash": content_hash(manifest),
            }
        ),
        text=True,
        capture_output=True,
        env=os.environ.copy(),
        check=True,
    )
    value = json.loads(result.stdout)
    if unknown_table:
        assert not value["accepted"]
        assert "unmapped_database_table" in value["reason"]
    else:
        assert value == {
            "accepted": True,
            "domains": ["application_database", "managed_files"],
        }
