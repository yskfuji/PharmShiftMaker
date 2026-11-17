"""Owned, isolated PostgreSQL PITR diagnostic; never an application acceptance proof."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
import uuid
from pathlib import Path

LABEL = "pharmshift.pitr-owner"


def run_trial(output: Path, image: str = "postgres:16") -> dict:
    output.mkdir(parents=True, exist_ok=False)
    owner = uuid.uuid4().hex
    prefix = "pharmshift-pitr-" + owner[:12]
    containers: list[str] = []
    volumes: list[str] = []
    transcript = []

    def cmd(*args, check=True):
        result = subprocess.run(["docker", *args], text=True, capture_output=True)
        transcript.append(
            {
                "args": list(args),
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        )
        (output / "commands.json").write_text(json.dumps(transcript, indent=2))
        if check and result.returncode:
            raise RuntimeError(f"Docker command failed: {args[:3]}: {result.stderr}")
        return result

    def owned(kind, name):
        info = json.loads(cmd(kind, "inspect", name).stdout)[0]
        labels = (
            info.get("Labels", {})
            if kind == "volume"
            else info["Config"].get("Labels", {})
        )
        if labels.get(LABEL) != owner:
            raise RuntimeError("Ownership mismatch: " + name)

    def volume(suffix):
        name = prefix + "-" + suffix
        cmd("volume", "create", "--label", f"{LABEL}={owner}", name)
        volumes.append(name)
        owned("volume", name)
        return name

    def sql(name, query):
        owned("container", name)
        return cmd(
            "exec",
            "-u",
            "postgres",
            name,
            "psql",
            "-XAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
        ).stdout.strip()

    def wait_ready(name, seconds=45):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            result = cmd("exec", "-u", "postgres", name, "pg_isready", check=False)
            if result.returncode == 0:
                return
            time.sleep(0.5)
        raise RuntimeError("PostgreSQL readiness timeout: " + name)

    def helper(mounts, shell):
        args = ["run", "--rm", "--network", "none", "--label", f"{LABEL}={owner}"]
        for mount in mounts:
            args += ["-v", mount]
        cmd(*args, "--entrypoint", "bash", image, "-ec", shell)

    result = {
        "owner": owner,
        "application_acceptance": False,
        "limitations": [
            "synthetic event table only",
            "no independent erasure control replay",
            "no application file catalogue",
            "not the 25-month scenario",
        ],
    }
    try:
        image_info = json.loads(cmd("image", "inspect", image).stdout)[0]
        result["image_id"] = image_info["Id"]
        source_data, archive, base = [volume(x) for x in ("source", "archive", "base")]
        helper(
            [f"{archive}:/archive", f"{base}:/base"],
            "chown postgres:postgres /archive /base; chmod 700 /base",
        )
        source = prefix + "-source"
        containers.append(source)
        cmd(
            "run",
            "-d",
            "--name",
            source,
            "--label",
            f"{LABEL}={owner}",
            "--network",
            "none",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "-v",
            f"{source_data}:/var/lib/postgresql/data",
            "-v",
            f"{archive}:/archive",
            "-v",
            f"{base}:/base",
            image,
            "postgres",
            "-c",
            "archive_mode=on",
            "-c",
            "archive_command=test ! -f /archive/%f && cp %p /archive/%f",
            "-c",
            "wal_level=replica",
            "-c",
            "fsync=on",
            "-c",
            "synchronous_commit=on",
            "-c",
            "full_page_writes=on",
        )
        owned("container", source)
        wait_ready(source)
        result["durability"] = sql(
            source,
            "SHOW fsync; SHOW synchronous_commit; SHOW full_page_writes; SHOW archive_mode;",
        )
        sql(
            source,
            "CREATE TABLE events(id integer PRIMARY KEY, payload text NOT NULL, committed_at timestamptz NOT NULL DEFAULT clock_timestamp()); INSERT INTO events VALUES(1,'before-base',clock_timestamp());",
        )
        cmd(
            "exec",
            "-u",
            "postgres",
            source,
            "pg_basebackup",
            "-h",
            "/var/run/postgresql",
            "-D",
            "/base",
            "-X",
            "stream",
            "--checkpoint=fast",
        )
        cmd("exec", "-u", "postgres", source, "pg_verifybackup", "/base")
        result["base_manifest_sha256"] = cmd(
            "exec", source, "sha256sum", "/base/backup_manifest"
        ).stdout.split()[0]
        sql(
            source,
            "SELECT pg_switch_wal(); INSERT INTO events VALUES(2,'recover-me',clock_timestamp());",
        )
        expected = sql(source, "SELECT id,payload FROM events ORDER BY id;")
        target = "accepted_" + owner
        target_lsn = sql(source, f"SELECT pg_create_restore_point('{target}');")
        target_wal = sql(source, f"SELECT pg_walfile_name('{target_lsn}'::pg_lsn);")
        sql(
            source,
            "INSERT INTO events VALUES(3,'after-target',clock_timestamp()); SELECT pg_switch_wal();",
        )
        deadline = time.monotonic() + 30
        while cmd(
            "exec", source, "test", "-f", "/archive/" + target_wal, check=False
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("Target WAL not archived")
            time.sleep(0.2)
        result.update(
            target_name=target,
            target_lsn=target_lsn,
            target_wal=target_wal,
            source_rows=sql(source, "SELECT id,payload FROM events ORDER BY id;"),
        )

        def restore(suffix, missing):
            data, restore_archive = volume(suffix + "-data"), volume(
                suffix + "-archive"
            )
            helper(
                [
                    f"{base}:/base:ro",
                    f"{data}:/data",
                    f"{archive}:/original:ro",
                    f"{restore_archive}:/archive",
                ],
                "cp -a /base/. /data/; cp -a /original/. /archive/; "
                + (f"rm /archive/{target_wal}; " if missing else "")
                + "printf \"restore_command = 'cp /archive/%%f %%p'\\nrecovery_target_name = '"
                + target
                + "'\\nrecovery_target_action = 'promote'\\n\" >> /data/postgresql.auto.conf; "
                + "touch /data/recovery.signal; chown -R postgres:postgres /data; chmod 700 /data",
            )
            name = prefix + "-" + suffix
            containers.append(name)
            cmd(
                "run",
                "-d",
                "--name",
                name,
                "--label",
                f"{LABEL}={owner}",
                "--network",
                "none",
                "-v",
                f"{data}:/var/lib/postgresql/data",
                "-v",
                f"{restore_archive}:/archive:ro",
                image,
                "postgres",
                "-c",
                "archive_mode=off",
                "-c",
                "hot_standby=off",
            )
            owned("container", name)
            return name

        started = time.monotonic()
        good = restore("restored", False)
        wait_ready(good)
        recovered = sql(good, "SELECT id,payload FROM events ORDER BY id;")
        if recovered != expected or sql(good, "SELECT pg_is_in_recovery();") != "f":
            raise AssertionError(
                "Recovery target did not match independently fixed rows"
            )
        result["restored_rows"] = recovered
        result["target_rows_sha256"] = hashlib.sha256(recovered.encode()).hexdigest()
        result["limited_restore_seconds"] = time.monotonic() - started
        result["timeline"] = sql(
            good, "SELECT timeline_id FROM pg_control_checkpoint();"
        )
        bad = restore("missing-wal", True)
        deadline = time.monotonic() + 15
        stopped = False
        while time.monotonic() < deadline:
            state = json.loads(cmd("container", "inspect", bad).stdout)[0]["State"]
            if not state["Running"]:
                stopped = True
                break
            time.sleep(0.5)
        logs = cmd("logs", bad).stdout + transcript[-1]["stderr"]
        (output / "missing-wal.log").write_text(logs)
        if (
            not stopped
            or "recovery ended before configured recovery target was reached"
            not in logs
        ):
            raise AssertionError(
                "Missing target WAL did not produce explicit fail-closed recovery"
            )
        result["missing_wal_rejected"] = True
        result["status"] = "passed_limited_diagnostic"
        return result
    except BaseException as exc:
        result.update(status="failed", error=str(exc))
        raise
    finally:
        (output / "result.json").write_text(json.dumps(result, indent=2))
        for name in reversed(containers):
            owned("container", name)
            cmd("rm", "-f", name)
        for name in reversed(volumes):
            owned("volume", name)
            cmd("volume", "rm", name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--image", default="postgres:16")
    args = parser.parse_args()
    print(json.dumps(run_trial(args.output, args.image), indent=2))
