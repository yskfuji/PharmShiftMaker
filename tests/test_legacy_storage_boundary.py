"""Legacy compatibility may not create an unregistered operational copy."""

import pytest

from shift_scheduler.ops.archive import create_archive
from shift_scheduler.ops.attendance_adapter import write_attendance_csv
from shift_scheduler.ops.erasure_control import advance
from shift_scheduler.ops.exporter import _write_csv, _write_json
from shift_scheduler.ops.legacy_storage import require_development_storage


@pytest.mark.parametrize("environment", ["production", "independent-authority"])
def test_legacy_file_writers_refuse_operational_mode_before_bytes(
    tmp_path, monkeypatch, environment
):
    if environment == "production":
        monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    else:
        monkeypatch.setenv("PHARMSHIFT_CONTROL_URL", "http://isolated.invalid")
    destination = tmp_path / "never-created"
    actions = [
        lambda: _write_csv(destination, [{"person_id": "p0"}], ["person_id"]),
        lambda: _write_json(destination, {"person_id": "p0"}),
        lambda: write_attendance_csv(
            destination, [{"employee_code": "p0"}], ["employee_code"]
        ),
        lambda: create_archive([tmp_path / "missing"], destination),
    ]
    for action in actions:
        with pytest.raises(RuntimeError, match="legacy storage is disabled"):
            action()
        assert not destination.exists()
    with pytest.raises(ValueError, match="migration-read-only"):
        advance(tmp_path, "a" * 64, b"x" * 32, 0)
    assert not list(tmp_path.iterdir())


def test_development_compatibility_is_explicit_and_no_prod_bypass_flag(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("PHARMSHIFT_CONTROL_URL", raising=False)
    monkeypatch.setenv("PHARMSHIFT_ENV", "development")
    _write_json(tmp_path / "development.json", {"synthetic": True})
    assert (tmp_path / "development.json").exists()
    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    monkeypatch.setenv("ALLOW_LEGACY_STORAGE", "true")
    with pytest.raises(RuntimeError):
        require_development_storage()


def test_legacy_audit_file_and_stdout_are_blocked_before_any_personal_bytes(
    tmp_path, monkeypatch, capsys
):
    from shift_scheduler.audit.logger import AuditEvent, JSONAuditLogger

    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    path = tmp_path / "absent" / "audit.jsonl"
    with pytest.raises(RuntimeError):
        JSONAuditLogger(path)
    assert not path.parent.exists()
    with pytest.raises(RuntimeError):
        JSONAuditLogger().log(
            AuditEvent(
                event_type="synthetic", actor_id="p0", actor_role="ADMIN", action="test"
            )
        )
    output = capsys.readouterr()
    assert "p0" not in output.out + output.err


def test_legacy_yaml_json_stores_cannot_write_in_operational_mode(
    tmp_path, monkeypatch
):
    import shift_scheduler.data.holiday_request_store as requests
    import shift_scheduler.data.leave_quota_store as quotas
    import shift_scheduler.data.schedule_store as schedules

    monkeypatch.setenv("PHARMSHIFT_CONTROL_URL", "http://isolated-authority.invalid")
    for module in (schedules, requests, quotas):
        monkeypatch.setattr(module, "USE_DB_BACKEND", False)
    with pytest.raises(RuntimeError):
        schedules.ScheduleStore(storage_dir=tmp_path).save(2026, 1, [], 1, "operator")
    with pytest.raises(RuntimeError):
        requests.HolidayRequestStore(config_dir=tmp_path).save_requests(2026, 1, [])
    with pytest.raises(RuntimeError):
        quotas.LeaveQuotaStore(config_dir=tmp_path)._write_yaml_entries([])
    assert not [p for p in tmp_path.rglob("*") if p.is_file()]


def test_manifest_export_rejects_before_serializing_old_authority(
    tmp_path, monkeypatch
):
    import scripts.erasure_manifest as cli

    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    monkeypatch.delenv("PHARMSHIFT_CONTROL_URL", raising=False)
    monkeypatch.setenv("PHARMSHIFT_ERASURE_MANIFEST_KEY", "synthetic-key-" * 4)
    monkeypatch.setattr(cli, "get_session_factory", lambda: object())
    destination = tmp_path / "not-created.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "erasure_manifest",
            "export",
            "--file",
            str(destination),
            "--control-dir",
            str(tmp_path),
            "--control-generation",
            "0",
        ],
    )
    with pytest.raises(RuntimeError, match="legacy storage is disabled"):
        cli.main()
    assert not destination.exists()
