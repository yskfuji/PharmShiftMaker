"""Test-only native bridge cannot override its owned database target."""

import json

import pytest
from scripts import audit_pg_client as bridge


@pytest.mark.parametrize(
    "extra",
    [
        ["--host=external.invalid"],
        ["--dbname", "unrelated"],
        ["--role=other"],
        ["--clean"],
    ],
)
def test_native_override_is_rejected_before_program_launch(monkeypatch, extra):
    monkeypatch.setenv("PGDATABASE", "pharmshift_audit_full_20260923")
    monkeypatch.setenv("PGHOST", "127.0.0.1")
    monkeypatch.setenv("PGPORT", "55443")
    monkeypatch.setenv("PGUSER", "audit_full_20260923")
    monkeypatch.setenv(
        "PHARMSHIFT_AUDIT_PG_CONTAINER", "pharmshift-storage-closure-20260923-r1"
    )
    inspection = [
        {
            "Config": {"Labels": {"pharmshift.synthetic-audit": "true"}},
            "NetworkSettings": {
                "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55443"}]}
            },
        }
    ]
    monkeypatch.setattr(
        bridge.subprocess, "check_output", lambda *a, **kw: json.dumps(inspection)
    )
    monkeypatch.setattr(
        bridge.subprocess,
        "run",
        lambda *a, **kw: pytest.fail("Native program must not launch"),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "audit_pg_client",
            "--format=custom",
            "--no-owner",
            "--no-privileges",
            "--strict-names",
            '--schema="audit_' + "a" * 32 + '"',
            "--snapshot=00000001-00000001-1",
            *extra,
        ],
    )
    with pytest.raises(RuntimeError):
        bridge.main()
