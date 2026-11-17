"""Inspect an owned development stack; declarations alone never certify acceptance."""

import argparse
import json
import os
import re
import secrets
import subprocess
from pathlib import Path

SERVICES = {
    "db",
    "control-db",
    "witness-db",
    "control",
    "witness",
    "api",
    "worker",
    "frontend",
}


def assess(
    containers,
    durability,
    *,
    storage_evidence=None,
    aggregate_evidence=None,
    kernel=None,
):
    issues, rows = [], []
    seen = []
    for c in containers:
        service = c["Config"]["Labels"].get("com.docker.compose.service")
        seen.append(service)
        config = c["HostConfig"]
        cpu = config.get("NanoCpus", 0) / 1e9
        if not cpu and config.get("CpuQuota", 0) > 0 and config.get("CpuPeriod", 0) > 0:
            cpu = config["CpuQuota"] / config["CpuPeriod"]
        memory = config.get("Memory", 0)
        swap = config.get("MemorySwap", 0)
        if cpu <= 0 or memory <= 0:
            issues.append("UNBOUNDED_SERVICE:" + str(service))
        if swap != memory:
            issues.append("SWAP_NOT_DISABLED:" + str(service))
        if not c["State"]["Running"]:
            issues.append("NOT_RUNNING:" + str(service))
        rows.append(
            {
                "service": service,
                "container_id": c["Id"],
                "image_id": c["Image"],
                "cpus": cpu,
                "memory_bytes": memory,
                "memory_swap_bytes": swap,
                "cgroup_parent": config.get("CgroupParent"),
                "cgroup_namespace": config.get("CgroupnsMode"),
                "running": c["State"]["Running"],
                "mounts": [
                    {
                        "source": m["Source"],
                        "destination": m["Destination"],
                        "type": m["Type"],
                    }
                    for m in c["Mounts"]
                ],
            }
        )
    if set(seen) != SERVICES or len(seen) != len(SERVICES):
        issues.append("EXACT_EIGHT_RUNTIME_SERVICES_REQUIRED")
    cpu = sum(r["cpus"] for r in rows)
    mem = sum(r["memory_bytes"] for r in rows)
    if cpu > 4 or mem > 8 * 1024**3:
        issues.append("AGGREGATE_DECLARED_LIMIT_EXCEEDED")
    db_sources = []
    for row in rows:
        if row["service"] in {"db", "control-db", "witness-db"}:
            sources = [
                m["source"]
                for m in row["mounts"]
                if m["destination"] == "/var/lib/postgresql/data"
            ]
            if len(sources) != 1:
                issues.append("DATABASE_VOLUME_UNVERIFIED:" + row["service"])
            db_sources.extend(sources)
            values = durability.get(row["service"], {})
            if any(
                values.get(key) != "on"
                for key in ("fsync", "synchronous_commit", "full_page_writes")
            ):
                issues.append("DURABILITY_UNVERIFIED:" + row["service"])
    if len(db_sources) != 3 or len(set(db_sources)) != 3:
        issues.append("DATABASE_STORAGE_NOT_INDEPENDENT")
    # External statements are retained for review, not blindly trusted as evidence.
    issues.append("HOST_SSD_AND_VOLUME_BACKING_NOT_INDEPENDENTLY_VERIFIED")
    kernel = kernel or {}
    kernel_rows = []
    for row in rows:
        actual = kernel.get(row["container_id"], {})
        try:
            quota, period = actual["cpu.max"].split()
            actual_cpu = int(quota) / int(period)
            actual_mem = int(actual["memory.max"])
            actual_swap = int(actual["memory.swap.max"])
            if (
                actual_cpu <= 0
                or actual_mem <= 0
                or actual_swap != 0
                or abs(actual_cpu - row["cpus"]) > 0.00001
                or actual_mem != row["memory_bytes"]
            ):
                raise ValueError("Kernel/inspect mismatch")
            kernel_rows.append(
                {
                    "container_id": row["container_id"],
                    "cpus": actual_cpu,
                    "memory_bytes": actual_mem,
                    "swap_bytes": actual_swap,
                }
            )
        except (KeyError, ValueError, TypeError, ZeroDivisionError):
            issues.append(
                "KERNEL_CGROUP_PROOF_MISSING_OR_MISMATCH:" + str(row["service"])
            )
    aggregate_verified = (
        len(kernel_rows) == len(SERVICES)
        and len(seen) == len(SERVICES)
        and set(seen) == SERVICES
        and sum(r["cpus"] for r in kernel_rows) <= 4
        and sum(r["memory_bytes"] for r in kernel_rows) <= 8 * 1024**3
    )
    return {
        "schema_version": 1,
        "services": sorted(rows, key=lambda r: str(r["service"])),
        "kernel_readings": kernel,
        "kernel_limits": kernel_rows,
        "aggregate_kernel_limits_verified": aggregate_verified,
        "cpu_limit_sum": cpu,
        "memory_limit_sum": mem,
        "durability": durability,
        "issues": sorted(set(issues)),
        "storage_evidence_supplied": storage_evidence,
        "aggregate_evidence_supplied": aggregate_evidence,
        "development_stack_complete": not any(
            x.startswith(
                ("NOT_RUNNING", "EXACT_EIGHT", "DURABILITY", "DATABASE_", "UNBOUNDED")
            )
            for x in issues
        ),
        "acceptance_resources_verified": False,
        "boundary": "Eight direct kernel cgroup ceilings are summed only after matching live containers; SSD backing and full acceptance remain independent",
    }


def command(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE)


def inspect_project(project):
    if not re.fullmatch(r"pharmshift-dev-[a-z0-9-]+", project):
        raise ValueError("Dedicated pharmshift-dev- project required")
    ids = command(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            "label=com.docker.compose.project=" + project,
        ]
    ).split()
    containers = json.loads(command(["docker", "inspect", *ids])) if ids else []
    durability = {}
    for c in containers:
        service = c["Config"]["Labels"].get("com.docker.compose.service")
        if service in {"db", "control-db", "witness-db"} and c["State"]["Running"]:
            database = {
                "db": "pharmshift_audit_remediation",
                "control-db": "pharmshift_control_development",
                "witness-db": "pharmshift_witness_development",
            }[service]
            sql = "SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes') ORDER BY name"
            try:
                text = command(
                    [
                        "docker",
                        "exec",
                        c["Id"],
                        "psql",
                        "-U",
                        "audit",
                        "-d",
                        database,
                        "-At",
                        "-F",
                        "=",
                        "-c",
                        sql,
                    ]
                )
                durability[service] = dict(
                    line.split("=", 1) for line in text.splitlines()
                )
            except subprocess.CalledProcessError:
                durability[service] = {}
    kernel = {}
    for c in containers:
        if c["State"]["Running"]:
            try:
                reading = command(
                    [
                        "docker",
                        "exec",
                        c["Id"],
                        "sh",
                        "-c",
                        "cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max",
                    ]
                ).splitlines()
                if len(reading) == 3:
                    kernel[c["Id"]] = dict(
                        zip(
                            ("cpu.max", "memory.max", "memory.swap.max"),
                            reading,
                            strict=False,
                        )
                    )
            except subprocess.CalledProcessError:
                pass
    result = assess(containers, durability, kernel=kernel)
    result["project"] = project
    api = next(
        (
            c
            for c in containers
            if c["Config"]["Labels"].get("com.docker.compose.service") == "api"
        ),
        None,
    )
    worker = next(
        (
            c
            for c in containers
            if c["Config"]["Labels"].get("com.docker.compose.service") == "worker"
        ),
        None,
    )
    control = next(
        (
            c
            for c in containers
            if c["Config"]["Labels"].get("com.docker.compose.service") == "control"
        ),
        None,
    )
    connected = True
    for c, key, value in (
        (api, "PHARMSHIFT_CONTROL_URL", "http://control:8000"),
        (worker, "PHARMSHIFT_CONTROL_URL", "http://control:8000"),
        (control, "PHARMSHIFT_WITNESS_URL", "http://witness:8000"),
    ):
        if c is None or key + "=" + value not in c["Config"].get("Env", []):
            connected = False
    if not connected:
        result["issues"].append("CONTROL_OR_WITNESS_NOT_CONNECTED")
    result["signed_control_probe"] = None
    if api and api["State"]["Running"]:
        try:
            probe = json.loads(
                command(
                    [
                        "docker",
                        "exec",
                        api["Id"],
                        "python",
                        "-c",
                        "import json; from shift_scheduler.control.client import configured_client; print(json.dumps(configured_client().require_access()))",
                    ]
                )
            )
            result["signed_control_probe"] = probe
            if not probe.get("allowed"):
                connected = False
        except (subprocess.CalledProcessError, ValueError):
            connected = False
    else:
        connected = False
    bindings = (
        api["HostConfig"].get("PortBindings", {}).get("8000/tcp", []) if api else []
    )
    if {"HostIp": "127.0.0.1", "HostPort": "18522"} not in bindings:
        result["issues"].append("DIAGNOSTIC_API_PORT_NOT_BOUND_TO_OWNED_PROJECT")
        connected = False
    if not connected:
        result["issues"].append("SIGNED_CONTROL_ACCESS_NOT_VERIFIED")
        result["development_stack_complete"] = False
    result["docker_info"] = json.loads(
        command(["docker", "info", "--format", "{{json .}}"])
    )
    # Docker info can contain unrelated installation configuration. Keep hardware/backend only.
    result["docker_info"] = {
        k: result["docker_info"].get(k)
        for k in (
            "Architecture",
            "OSType",
            "OperatingSystem",
            "NCPU",
            "MemTotal",
            "Driver",
            "CgroupDriver",
            "CgroupVersion",
            "DockerRootDir",
            "ServerVersion",
        )
    }
    if result["docker_info"].get("MemTotal", 0) < 8 * 1024**3:
        result["issues"].append("DOCKER_VM_MEMORY_BELOW_CONFIGURED_8_GIB")
        result["issues"].sort()
    return result


def prepare(path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    authority = Ed25519PrivateKey.generate()
    witness = Ed25519PrivateKey.generate()
    source_token = secrets.token_hex(32)
    operator_token = secrets.token_hex(32)
    values = {
        "AUTHORITY_PRIVATE_KEY": authority.private_bytes_raw().hex(),
        "AUTHORITY_PUBLIC_KEY": authority.public_key().public_bytes_raw().hex(),
        "WITNESS_PRIVATE_KEY": witness.private_bytes_raw().hex(),
        "WITNESS_PUBLIC_KEY": witness.public_key().public_bytes_raw().hex(),
        "SOURCE_TOKEN": source_token,
        "OPERATOR_TOKEN": operator_token,
        "WITNESS_TOKEN": secrets.token_hex(32),
        "AUTHORITY_CREDENTIALS": json.dumps(
            {
                "source": {"role": "source", "token": source_token},
                "operator": {"role": "operator", "token": operator_token},
            },
            separators=(",", ":"),
        ),
    }
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as output:
        for key, value in values.items():
            output.write(key + "='" + value + "'\n")
    return {
        "state": "PREPARED_DEVELOPMENT_SECRETS",
        "path": str(path),
        "warning": "Synthetic local service credentials; do not publish this file",
    }


def start(project, env_file):
    """Explicit one-time bootstrap of a new owned project; never resets generations."""
    if not re.fullmatch(r"pharmshift-dev-[a-z0-9-]+", project):
        raise ValueError("Dedicated development project required")
    env_file = Path(env_file).resolve()
    if env_file.stat().st_mode & 0o077:
        raise ValueError("Private environment file must deny group/other access")
    if command(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            "label=com.docker.compose.project=" + project,
        ]
    ).strip():
        raise ValueError(
            "Existing project: refuse rebootstrap; use compose up for an initialized project"
        )
    if command(
        [
            "docker",
            "volume",
            "ls",
            "-q",
            "--filter",
            "label=com.docker.compose.project=" + project,
        ]
    ).strip():
        raise ValueError(
            "Existing project volumes: preserve generations; do not rebootstrap"
        )
    compose = [
        "docker",
        "compose",
        "-p",
        project,
        "--env-file",
        str(env_file),
        "-f",
        str(
            Path(__file__).resolve().parents[1]
            / "ops/acceptance-development-compose.yml"
        ),
    ]
    command(compose + ["config", "--quiet"])
    command(compose + ["up", "-d", "--wait", "db", "control-db", "witness-db"])
    command(
        compose
        + [
            "run",
            "--rm",
            "--no-deps",
            "control",
            "python",
            "-m",
            "scripts.control_authority",
        ]
    )
    digest_code = 'import os; from scripts.control_authority import independent_engine; from sqlalchemy.orm import sessionmaker; from shift_scheduler.control.witness import authority_digest; factory=sessionmaker(independent_engine(os.environ["PHARMSHIFT_AUTHORITY_DB_URL"])); session=factory(); print(authority_digest(session)); session.close()'
    digest = command(
        compose + ["run", "--rm", "--no-deps", "control", "python", "-c", digest_code]
    ).strip()
    if not re.fullmatch("[a-f0-9]{64}", digest):
        raise ValueError("Unexpected authority digest output")
    command(
        compose
        + [
            "run",
            "--rm",
            "--no-deps",
            "witness",
            "python",
            "-m",
            "scripts.control_witness",
            "--verified-bootstrap-digest",
            digest,
        ]
    )
    command(compose + ["up", "-d", "--wait", "witness", "control"])
    enroll = 'import os,json; from shift_scheduler.control.client import AuthorityClient; from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey; key=Ed25519PrivateKey.from_private_bytes(bytes.fromhex(os.environ["PHARMSHIFT_AUTHORITY_PRIVATE_KEY"])); credentials=json.loads(os.environ["PHARMSHIFT_AUTHORITY_CREDENTIALS"]); c=AuthorityClient("http://127.0.0.1:8000","operator",credentials["operator"]["token"],key.public_key().public_bytes_raw().hex()); c.request("POST","/nodes",{"node_id":"source","role":"source"}); source=AuthorityClient("http://127.0.0.1:8000","source",credentials["source"]["token"],key.public_key().public_bytes_raw().hex()); print(json.dumps(source.require_access()))'
    probe = json.loads(
        command(compose + ["exec", "-T", "control", "python", "-c", enroll])
    )
    if not probe.get("allowed"):
        raise ValueError("Initial signed authority access denied")
    command(compose + ["up", "-d", "--wait", "api", "worker", "frontend"])
    return {
        "project": project,
        "bootstrap_digest": digest,
        "control_probe": probe,
        "state": "DEVELOPMENT_STARTED_NOT_ACCEPTED",
        "frontend_image": "historical; rebuild/freeze required for acceptance",
    }


def diagnose(project, directory):
    import sys

    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    result = inspect_project(project)
    (directory / "runtime.json").write_text(json.dumps(result, indent=2))
    if not result["development_stack_complete"]:
        return {"state": "BLOCKED", "issues": result["issues"]}
    cmd = [
        sys.executable,
        "-m",
        "scripts.acceptance_workload",
        "--base",
        "http://127.0.0.1:18522",
        "--split",
        "tuning",
        "--samples",
        "1",
        "--people",
        "30",
        "--days",
        "28",
        "--budget",
        "20",
        "--lookahead",
        "14",
        "--search-threads",
        "1",
        "--seed-base",
        "700001",
        "--resource-evidence",
        str(directory / "runtime.json"),
        "--journal",
        str(directory / "development.sqlite"),
        "--output",
        str(directory / "development.jsonl"),
    ]
    with (directory / "console.txt").open("x") as log:
        completed = subprocess.run(
            cmd,
            cwd=Path(__file__).resolve().parents[1],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    return {
        "state": (
            "DEVELOPMENT_DIAGNOSTIC_COMPLETE"
            if completed.returncode == 0
            else "DEVELOPMENT_DIAGNOSTIC_FAILED"
        ),
        "exit_code": completed.returncode,
        "acceptance": False,
        "directory": str(directory),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "inspect", "start", "diagnose"])
    parser.add_argument("--project")
    parser.add_argument("--output", required=True)
    parser.add_argument("--secret-env")
    args = parser.parse_args(argv)
    if args.action == "prepare":
        print(json.dumps(prepare(args.output)))
        return 0
    if not args.project:
        parser.error("--project required")
    if args.action == "diagnose":
        result = diagnose(args.project, args.output)
        print(json.dumps(result))
        return result.get("exit_code", 1)
    if Path(args.output).exists():
        raise FileExistsError(args.output)
    if args.action == "start":
        if not args.secret_env:
            parser.error("--secret-env required")
        result = start(args.project, args.secret_env)
    else:
        result = inspect_project(args.project)
    with Path(args.output).open("x") as file:
        json.dump(result, file, indent=2)
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key
                in (
                    "issues",
                    "state",
                    "development_stack_complete",
                    "acceptance_resources_verified",
                )
            }
        )
    )
    return (
        0
        if result.get("development_stack_complete")
        or result.get("state") == "DEVELOPMENT_STARTED_NOT_ACCEPTED"
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
