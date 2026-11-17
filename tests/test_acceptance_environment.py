from scripts.acceptance_environment import SERVICES, assess, prepare


def fixture():
    rows = []
    kernel = {}
    durability = {}
    for service in sorted(SERVICES):
        identity = service + "-id"
        c = {
            "Id": identity,
            "Image": "sha256:synthetic",
            "Config": {"Labels": {"com.docker.compose.service": service}},
            "HostConfig": {
                "NanoCpus": 500000000,
                "Memory": 1024**3,
                "MemorySwap": 1024**3,
            },
            "State": {"Running": True},
            "Mounts": [
                {
                    "Source": "/owned/" + service,
                    "Destination": "/var/lib/postgresql/data",
                    "Type": "volume",
                }
            ],
        }
        rows.append(c)
        kernel[identity] = {
            "cpu.max": "50000 100000",
            "memory.max": str(1024**3),
            "memory.swap.max": "0",
        }
        durability[service] = dict.fromkeys(
            ("fsync", "synchronous_commit", "full_page_writes"), "on"
        )
    return rows, kernel, durability


def test_actual_kernel_caps_differ_from_declared_limits_and_not_ssd_proof():
    rows, kernel, durability = fixture()
    result = assess(rows, durability, kernel=kernel)
    assert (
        result["development_stack_complete"]
        and result["aggregate_kernel_limits_verified"]
    )
    assert not result["acceptance_resources_verified"]
    kernel[rows[0]["Id"]]["cpu.max"] = "max 100000"
    result = assess(rows, durability, kernel=kernel)
    assert not result["aggregate_kernel_limits_verified"]
    assert any(i.startswith("KERNEL_CGROUP") for i in result["issues"])


def test_missing_service_shared_db_or_durability_off_fail():
    rows, kernel, durability = fixture()
    assert not assess(rows[:-1], durability, kernel=kernel)[
        "development_stack_complete"
    ]
    durability["db"]["fsync"] = "off"
    assert not assess(rows, durability, kernel=kernel)["development_stack_complete"]
    rows, kernel, durability = fixture()
    for row in rows:
        row["Mounts"][0]["Source"] = "/shared"
    assert not assess(rows, durability, kernel=kernel)["development_stack_complete"]


def test_development_keys_private_and_never_overwritten(tmp_path):
    import pytest

    p = tmp_path / "private.env"
    prepare(p)
    assert p.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        prepare(p)


def test_bootstrap_refuses_existing_project_even_if_stopped(tmp_path, monkeypatch):
    import pytest
    import scripts.acceptance_environment as env

    p = tmp_path / "secret.env"
    prepare(p)
    calls = []

    def query(args):
        calls.append(args)
        return "existing-container\n"

    monkeypatch.setattr(env, "command", query)
    with pytest.raises(ValueError, match="Existing project"):
        env.start("pharmshift-dev-test", p)
    assert len(calls) == 1


def test_bootstrap_command_order_and_digest_are_explicit(tmp_path, monkeypatch):
    import scripts.acceptance_environment as env

    p = tmp_path / "secret.env"
    prepare(p)
    calls = []

    def query(args):
        calls.append(args)
        if "authority_digest" in args[-1]:
            return "f" * 64 + "\n"
        if "exec" in args:
            return '{"allowed":true,"generation":0}'
        return ""

    monkeypatch.setattr(env, "command", query)
    result = env.start("pharmshift-dev-test", p)
    assert result["bootstrap_digest"] == "f" * 64
    bootstrap = next(c for c in calls if "--verified-bootstrap-digest" in c)
    assert bootstrap[-1] == "f" * 64
    assert calls[-1][-3:] == ["api", "worker", "frontend"]


def test_control_diagnostic_observer_rejects_production_and_never_outputs_payload(
    monkeypatch, capsys
):
    import pytest
    import scripts.control_authority as authority

    monkeypatch.delenv("PHARMSHIFT_WITNESS_URL", raising=False)
    monkeypatch.setenv("PHARMSHIFT_DIAGNOSTIC_CONTROL_TIMING", "1")
    monkeypatch.setenv("PHARMSHIFT_ENV", "production")
    with pytest.raises(ValueError, match="restricted to development"):
        authority.build_app()
    monkeypatch.setenv("PHARMSHIFT_ENV", "development")
    monkeypatch.setenv("PHARMSHIFT_AUTHORITY_DB_URL", "unused")
    monkeypatch.setenv("PHARMSHIFT_AUTHORITY_PRIVATE_KEY", "00" * 32)
    monkeypatch.setenv("PHARMSHIFT_AUTHORITY_CREDENTIALS", "{}")
    monkeypatch.setattr(authority, "independent_engine", lambda _: None)
    monkeypatch.setattr(authority, "sessionmaker", lambda _: None)
    captured = {}

    def create(*args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(authority, "create_app", create)
    authority.build_app()
    captured["timing_observer"](
        {
            "event": "control_witness_timing",
            "outcome": "committed",
            "total_seconds": 1,
            "stages": {"hash_before": 0.2},
            "private_payload": "must-not-log",
        }
    )
    assert "must-not-log" not in capsys.readouterr().out
