"""F08/S05 follow-ups: formula check on codes, resumable exports, signed archives.

No database is needed except where the SQLite fixture is used.
"""

import hashlib
import io
import json
import tarfile

import httpx
import pytest

from shift_scheduler.ops import exporter
from shift_scheduler.ops.archive import create_archive, restore_archive
from shift_scheduler.ops.attendance_adapter import (
    AdapterConfig,
    AttendanceAdapterError,
    PersonMapping,
    ShiftMapping,
    build_attendance_rows,
    formula_like,
)

# --- formula check ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,refused",
    [
        ("​=1", True),
        ("﻿@SUM(A1)", True),
        ("⁠+HYPERLINK(1)", True),  # invisible prefixes
        ("a;=HYPERLINK(1)", True),
        ("x;@SUM(A1)", True),
        ("a; -SUM(A1)", True),  # ';' separated parts
        ("a;b", False),
        ("- 応援;備考", False),
        ("EMP;001", False),
    ],
)
def test_formula_check_sees_through_invisible_prefixes_and_semicolons(text, refused):
    assert formula_like(text) is refused


@pytest.mark.parametrize(
    "field", ["employee_code", "attendance_code", "department_code", "location_code"]
)
def test_code_columns_are_checked_too(field):
    person = PersonMapping(employee_code="E1")
    shift = ShiftMapping(start_time="09:00", end_time="17:00")
    if field == "employee_code":
        person.employee_code = "=cmd|' /C calc'!A0"
    elif field == "attendance_code":
        shift.attendance_code = "@SUM(A1)"
    elif field == "department_code":
        person.department_code = "+HYPERLINK(1)"
    else:
        shift.location_code = "-cmd|x"
    config = AdapterConfig(people={"p": person}, shifts={"S": shift})
    with pytest.raises(AttendanceAdapterError, match="spreadsheet formula"):
        build_attendance_rows(
            [{"assignment_date": "2026-04-01", "person_id": "p", "shift_id": "S"}],
            config,
        )


# --- exporter resume across processes ------------------------------------------------------


class FakeServer:
    """Publication API stub: artifacts and transfers are idempotent by key."""

    def __init__(self):
        self.content = {"json": b'{"schema_version": 1}', "csv": b"date,person\n"}
        self.keys, self.fail_download = [], set()

    def handler(self, request):
        path, body = request.url.path, json.loads(request.content or b"{}")
        if path == "/auth/login":
            return httpx.Response(200, json={"access_token": "t"})
        if path == "/planning/publications":
            return httpx.Response(
                200,
                json=[
                    {
                        "publication_id": "pub1",
                        "version": 3,
                        "assignments": [],
                        "period": "2026-04-01T00:00:00+09:00|2026-05-01T00:00:00+09:00",
                    }
                ],
            )
        if path.endswith("/artifacts"):
            self.keys.append(body["idempotency_key"])
            data = self.content[body["format"]]
            return httpx.Response(
                200,
                json={
                    "copy_id": "c-" + body["format"],
                    "revision": 1,
                    "content_hash": hashlib.sha256(data).hexdigest(),
                },
            )
        if path.endswith("/download"):
            self.keys.append(body["idempotency_key"])
            fmt = path.split("/")[-2].removeprefix("c-")
            if fmt in self.fail_download:
                return httpx.Response(503)
            return httpx.Response(
                200, content=self.content[fmt], headers={"X-Transfer-ID": "tr-" + fmt}
            )
        return httpx.Response(404)


def run_export(monkeypatch, server, output_dir):
    real = httpx.Client
    monkeypatch.setattr(
        exporter.httpx,
        "Client",
        lambda **kw: real(**{**kw, "transport": httpx.MockTransport(server.handler)}),
    )
    options = exporter.ExportOptions(
        base_url="https://api.example.invalid",
        username="u",
        password="p",
        year=2026,
        month=4,
        output_dir=output_dir,
        template_mode="long",
    )
    return exporter.export_schedule(options)


def test_export_resumes_after_a_crash_with_the_same_keys(monkeypatch, tmp_path):
    server = FakeServer()
    server.fail_download = {"csv"}
    with pytest.raises(httpx.HTTPStatusError):
        run_export(monkeypatch, server, tmp_path)  # JSON written, CSV failed
    first_keys = list(server.keys)
    server.fail_download, server.keys = set(), []
    summary = run_export(monkeypatch, server, tmp_path)  # "another process" reruns
    assert summary.csv_long_path.read_bytes() == server.content["csv"]
    assert summary.json_path.read_bytes() == server.content["json"]
    # The rerun reuses the artifact keys; the finished JSON is not downloaded again.
    assert server.keys[0] == first_keys[0] and server.keys[1] == first_keys[2]
    assert not any(
        k.startswith("download-") and k == first_keys[1] for k in server.keys
    )


def test_export_still_refuses_to_overwrite_a_different_existing_file(
    monkeypatch, tmp_path
):
    server = FakeServer()
    run_export(monkeypatch, server, tmp_path)
    json_path = next(tmp_path.glob("*.json"))
    json_path.write_bytes(b"changed by someone")
    with pytest.raises(exporter.ExporterError, match="上書きしません"):
        run_export(monkeypatch, server, tmp_path)


# --- signed archive manifests ---------------------------------------------------------------

KEY = "k" * 32


def archive_of(tmp_path, monkeypatch, key=KEY):
    source = tmp_path / "src"
    source.mkdir()
    (source / "a.txt").write_bytes(b"alpha")
    if key:
        monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", key)
    else:
        monkeypatch.delenv("PHARMSHIFT_ARCHIVE_KEY", raising=False)
    path = tmp_path / "backup.tar.gz"
    create_archive([source], path)
    return path


def rewrite(path, change):
    """Rebuild the archive with `change(members)` applied (an attacker's edit)."""
    with tarfile.open(path, "r:gz") as tar:
        members = {m.name: tar.extractfile(m).read() for m in tar}
    change(members)
    path.unlink()
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def test_signed_archive_restores_with_the_key(tmp_path, monkeypatch):
    path = archive_of(tmp_path, monkeypatch)
    with tarfile.open(path, "r:gz") as tar:
        assert "manifest.sig" in tar.getnames()
    restore_archive(path, tmp_path / "out")
    assert (tmp_path / "out/sources/0000/src/a.txt").read_bytes() == b"alpha"


def test_recomputed_manifest_without_the_key_is_refused(tmp_path, monkeypatch):
    path = archive_of(tmp_path, monkeypatch)

    def tamper(members):
        members["sources/0000/src/a.txt"] = b"forged"
        manifest = json.loads(members["manifest.json"])
        manifest["files"]["sources/0000/src/a.txt"] = {
            "sha256": hashlib.sha256(b"forged").hexdigest(),
            "size": 6,
        }
        members["manifest.json"] = json.dumps(manifest, sort_keys=True).encode()

    rewrite(path, tamper)
    with pytest.raises(ValueError, match="signature"):
        restore_archive(path, tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_unsigned_or_other_key_archives_are_refused_when_a_key_is_configured(
    tmp_path, monkeypatch
):
    unsigned = archive_of(tmp_path, monkeypatch, key=None)
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", KEY)
    with pytest.raises(ValueError, match="signature"):
        restore_archive(unsigned, tmp_path / "out1")
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY_ID", "rotated")
    signed_default = tmp_path / "second"
    signed_default.mkdir()
    monkeypatch.delenv("PHARMSHIFT_ARCHIVE_KEY_ID")
    other = archive_of(signed_default, monkeypatch)
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY_ID", "rotated")
    with pytest.raises(ValueError, match="signature"):
        restore_archive(other, tmp_path / "out2")


def test_production_requires_a_key_and_short_keys_are_refused(tmp_path, monkeypatch):
    path = archive_of(tmp_path, monkeypatch, key=None)
    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    with pytest.raises(ValueError, match="require PHARMSHIFT_ARCHIVE_KEY"):
        restore_archive(path, tmp_path / "out")
    monkeypatch.delenv("PHARMSHIFT_ENV")
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", "short")
    with pytest.raises(ValueError, match="at least 32 bytes"):
        restore_archive(path, tmp_path / "out")


# --- managed attendance conversion resumes under the same operation identity ------------------


def test_managed_attendance_conversion_is_resumable_by_a_derived_identity(
    sqlite_session_factory, tmp_path, monkeypatch
):
    from shift_scheduler.ops import managed_writer as writer
    from shift_scheduler.ops.attendance_adapter import (
        convert_managed_schedule_to_attendance,
        managed_attendance_copy_id,
    )
    from tests.test_managed_writer import SCOPE, reservation

    schedule = json.dumps(
        {
            "assignments": [
                {"assignment_date": "2026-04-01", "person_id": "p0", "shift_id": "DAY"}
            ]
        }
    ).encode()
    root = tmp_path / "managed"
    root.mkdir()
    source = reservation(sqlite_session_factory, root, monkeypatch, data=schedule)
    writer.publish_bytes(sqlite_session_factory, SCOPE, source.copy_id, schedule)
    mapping = tmp_path / "mapping.yaml"
    mapping.write_text(
        json.dumps(
            {
                "people": {"p0": {"employee_code": "E0"}},
                "shifts": {"DAY": {"start_time": "09:00", "end_time": "17:00"}},
            }
        )
    )
    source_hash = hashlib.sha256(schedule).hexdigest()
    copy_id = managed_attendance_copy_id(SCOPE, source.copy_id, source_hash, mapping)
    assert copy_id == managed_attendance_copy_id(
        SCOPE, source.copy_id, source_hash, mapping
    )
    first = convert_managed_schedule_to_attendance(
        sqlite_session_factory, SCOPE, source.copy_id, source_hash, mapping, copy_id
    )
    again = convert_managed_schedule_to_attendance(
        sqlite_session_factory, SCOPE, source.copy_id, source_hash, mapping, copy_id
    )
    assert first == again and b"E0" in first.read_bytes()
    mapping.write_text(
        json.dumps(
            {
                "people": {"p0": {"employee_code": "E9"}},
                "shifts": {"DAY": {"start_time": "09:00", "end_time": "17:00"}},
            }
        )
    )
    assert (
        managed_attendance_copy_id(SCOPE, source.copy_id, source_hash, mapping)
        != copy_id
    )


# --- review follow-ups ---------------------------------------------------------------------


@pytest.mark.parametrize("text", [" ​=1", " ﻿@SUM(A1)", "　​+HYPERLINK(1)"])
def test_spaces_and_invisible_characters_in_any_order_do_not_hide_a_formula(text):
    assert formula_like(text)


def test_a_short_or_missing_key_fails_before_any_archive_is_written(
    tmp_path, monkeypatch
):
    source = tmp_path / "src"
    source.mkdir()
    (source / "a.txt").write_bytes(b"alpha")
    monkeypatch.setenv("PHARMSHIFT_ARCHIVE_KEY", "short")
    with pytest.raises(ValueError, match="at least 32 bytes"):
        create_archive([source], tmp_path / "backup.tar.gz")
    assert not (tmp_path / "backup.tar.gz").exists()


def test_a_malformed_signature_is_a_value_error(tmp_path, monkeypatch):
    path = archive_of(tmp_path, monkeypatch)
    rewrite(
        path,
        lambda members: members.update(
            {
                "manifest.sig": json.dumps(
                    {"key_id": "default", "algorithm": "HMAC-SHA256", "mac": "é"}
                ).encode()
            }
        ),
    )
    with pytest.raises(ValueError, match="signature"):
        restore_archive(path, tmp_path / "out")


def test_export_refuses_a_directory_at_the_output_path(monkeypatch, tmp_path):
    server = FakeServer()
    run_export(monkeypatch, server, tmp_path)
    json_path = next(tmp_path.glob("*.json"))
    json_path.unlink()
    json_path.mkdir()
    with pytest.raises(exporter.ExporterError, match="上書きしません"):
        run_export(monkeypatch, server, tmp_path)


def test_managed_cli_reports_failures_without_a_traceback(
    tmp_path, monkeypatch, capsys
):
    from scripts.attendance_adapter import managed_main

    import shift_scheduler.db.session as database

    monkeypatch.setattr(database, "get_session_factory", lambda: None)
    code = managed_main(
        [
            "--scope",
            "hospital/pharmacy",
            "--source-copy-id",
            "x" * 32,
            "--source-hash",
            "0" * 64,
            "--mapping",
            str(tmp_path / "missing.yaml"),
        ]
    )
    assert code == 1 and "変換に失敗しました" in capsys.readouterr().err
