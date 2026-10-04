"""Owned local physical PITR fixture. Release authorization remains caller's responsibility."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import subprocess
import time
import uuid
from pathlib import Path

LABEL = "pharmshift.pitr-owner"
# Atomic no-overwrite publication, retry equality, durable file and directory.
ARCHIVE = 'set -eu; src=$1; dst=/archive/$2; if test -f "$dst"; then cmp -s "$src" "$dst"; sync -f "$dst"; sync -f /archive; exit; fi; tmp=$(mktemp /archive/.pending.XXXXXX); trap \'rm -f "$tmp"\' EXIT; cp "$src" "$tmp"; sync -f "$tmp"; if ! ln "$tmp" "$dst"; then cmp -s "$tmp" "$dst"; fi; sync -f /archive'


class OwnedPITR:
    def __init__(self, output: Path, image="postgres:16"):
        self.output = Path(output).resolve()
        self.output.mkdir(parents=True, exist_ok=False)
        self.owner = uuid.uuid4().hex
        self.prefix = "pharmshift-pitr-" + self.owner[:12]
        self.password = secrets.token_hex(24)
        self.image = image
        self.volumes, self.containers, self.commands = [], [], []

    def cmd(self, *args, check=True, input=None):
        p = subprocess.run(
            ["docker", *args], input=input, capture_output=True, text=True
        )

        def redact(s):
            return s.replace(self.password, "[REDACTED]")

        self.commands.append(
            {
                "args": [redact(x) for x in args],
                "rc": p.returncode,
                "stdout": redact(p.stdout),
                "stderr": redact(p.stderr),
            }
        )
        (self.output / "commands.json").write_text(json.dumps(self.commands, indent=2))
        if check and p.returncode:
            raise RuntimeError(redact(p.stderr))
        return p

    def owned(self, kind, name):
        value = json.loads(self.cmd(kind, "inspect", name).stdout)[0]
        labels = (
            value.get("Labels", {})
            if kind == "volume"
            else value["Config"].get("Labels", {})
        )
        if labels.get(LABEL) != self.owner:
            raise RuntimeError("Ownership mismatch")
        return value

    def volume(self, suffix):
        name = self.prefix + "-" + suffix
        self.cmd("volume", "create", "--label", f"{LABEL}={self.owner}", name)
        self.volumes.append(name)
        self.owned("volume", name)
        return name

    def helper(self, mounts, code):
        args = [
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--label",
            f"{LABEL}={self.owner}",
        ]
        for name, destination, readonly in mounts:
            self.owned("volume", name)
            args += ["-v", f"{name}:{destination}" + (":ro" if readonly else "")]
        self.cmd(*args, "--entrypoint", "bash", self.image, "-es", input=code)

    def helper_output(self, mounts, code):
        self.helper(mounts, code)
        return self.commands[-1]["stdout"]

    def sql(self, query, node=None):
        name = (node or self.source)["container"]
        self.owned("container", name)
        return self.cmd(
            "exec",
            "-i",
            "-u",
            "postgres",
            name,
            "psql",
            "-XAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            "app",
            input=query,
        ).stdout.strip()

    def launch(self, suffix, data, archive, recovering=False):
        name = self.prefix + "-" + suffix
        for vol in (data, archive):
            self.owned("volume", vol)
        self.containers.append(name)
        archive_command = (
            "bash -c '" + ARCHIVE.replace("'", "'\"'\"'") + "' archive %p %f"
        )
        self.cmd(
            "run",
            "-d",
            "--name",
            name,
            "--label",
            f"{LABEL}={self.owner}",
            "-p",
            "127.0.0.1::5432",
            "-e",
            "POSTGRES_PASSWORD=" + self.password,
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=scram-sha-256",
            "-e",
            "POSTGRES_DB=app",
            "-v",
            data + ":/var/lib/postgresql/data",
            "-v",
            archive + ":/archive",
            self.image,
            "postgres",
            "-c",
            "archive_mode=" + ("off" if recovering else "on"),
            "-c",
            "archive_command=" + archive_command,
            "-c",
            "wal_level=replica",
            "-c",
            "fsync=on",
            "-c",
            "synchronous_commit=on",
            "-c",
            "full_page_writes=on",
            "-c",
            "hot_standby=off",
        )
        info = self.owned("container", name)
        bindings = info["NetworkSettings"]["Ports"]["5432/tcp"]
        if len(bindings) != 1 or bindings[0]["HostIp"] != "127.0.0.1":
            raise RuntimeError("Unsafe host binding")
        port = int(bindings[0]["HostPort"])
        node = {
            "container": name,
            "port": port,
            "data": data,
            "archive": archive,
            "maintenance_url": f"postgresql+psycopg://postgres:{self.password}@127.0.0.1:{port}/app",
            "application_url": f"postgresql+psycopg://audit_app:{self.password}@127.0.0.1:{port}/app",
        }
        from sqlalchemy import create_engine, text

        engine = create_engine(
            node["maintenance_url"], connect_args={"connect_timeout": 1}
        )
        deadline = time.monotonic() + 45
        try:
            while True:
                try:
                    with engine.connect() as connection:
                        connection.execute(text("SELECT 1"))
                    break
                except Exception:
                    state = self.owned("container", name)["State"]
                    if not state["Running"] or time.monotonic() >= deadline:
                        logs = self.cmd("logs", name, check=False)
                        raise RuntimeError(
                            "PostgreSQL readiness failed: " + logs.stdout + logs.stderr
                        )
                    time.sleep(0.25)
        finally:
            engine.dispose()
        return node

    def __enter__(self):
        try:
            self.image = json.loads(self.cmd("image", "inspect", self.image).stdout)[0][
                "Id"
            ]
            data, self.archive = self.volume("source"), self.volume("archive")
            self.helper(
                [(self.archive, "/archive", False)], "chown postgres:postgres /archive"
            )
            self.source = self.launch("source", data, self.archive)
            self.sql(
                f"CREATE ROLE audit_app LOGIN PASSWORD '{self.password}' NOSUPERUSER; ALTER DATABASE app OWNER TO audit_app;"
            )
            self.source_url = self.source["application_url"]
            self.maintenance_url = self.source["maintenance_url"]
            return self
        except BaseException:
            self.close()
            raise

    @staticmethod
    def label(value):
        if not re.fullmatch("[a-zA-Z0-9_-]{1,40}", value):
            raise ValueError("Invalid backup or target label")
        return value

    def backup(self, label):
        label = self.label(label)
        volume = self.volume("base-" + label)
        # Physical backup connects over the private container network namespace, without publishing credentials.
        self.helper(
            [(volume, "/base", False)], "chown postgres:postgres /base; chmod 700 /base"
        )
        self.owned("container", self.source["container"])
        self.cmd(
            "run",
            "--rm",
            "--label",
            f"{LABEL}={self.owner}",
            "--network",
            "container:" + self.source["container"],
            "-e",
            "PGPASSWORD=" + self.password,
            "-v",
            volume + ":/base",
            "--user",
            "postgres",
            "--entrypoint",
            "pg_basebackup",
            self.image,
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
            "-D",
            "/base",
            "-X",
            "stream",
            "--checkpoint=fast",
        )
        self.helper([(volume, "/base", True)], "pg_verifybackup /base")
        manifest = self.helper_output(
            [(volume, "/base", True)], "sha256sum /base/backup_manifest"
        ).split()[0]
        durability = self.sql(
            "SHOW fsync; SHOW synchronous_commit; SHOW full_page_writes; SHOW archive_mode;"
        )
        config = self.sql(
            "SELECT name || '=' || setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','archive_mode','archive_command','wal_level') ORDER BY name;"
        )
        return {
            "volume": volume,
            "label": label,
            "owner": self.owner,
            "manifest_sha256": manifest,
            "image_id": self.image,
            "durability": durability.splitlines(),
            "config_sha256": hashlib.sha256(config.encode()).hexdigest(),
        }

    def mark_target(self, label):
        name = self.label(label) + "_" + self.owner
        lsn = self.sql(f"SELECT pg_create_restore_point('{name}');")
        segment = self.sql(f"SELECT pg_walfile_name('{lsn}'::pg_lsn);")
        self.sql("SELECT pg_switch_wal();")
        deadline = time.monotonic() + 30
        while self.cmd(
            "exec",
            self.source["container"],
            "test",
            "-f",
            "/archive/" + segment,
            check=False,
        ).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError("Archive target not durable")
            time.sleep(0.2)
        inventory = self.helper_output(
            [(self.archive, "/archive", True)],
            'find /archive -maxdepth 1 -type f ! -name ".pending.*" -exec sha256sum {} \\; | sort',
        )
        wal_hash = self.cmd(
            "exec", self.source["container"], "sha256sum", "/archive/" + segment
        ).stdout.split()[0]
        return {
            "name": name,
            "lsn": lsn,
            "segment": segment,
            "owner": self.owner,
            "wal_sha256": wal_hash,
            "archive_inventory": inventory.splitlines(),
        }

    def restore(self, base, target, *, fault=None):
        if base["owner"] != self.owner or target["owner"] != self.owner:
            raise ValueError("Foreign restore references")
        if not re.fullmatch("[a-zA-Z0-9_-]{1,80}", target["name"]) or not re.fullmatch(
            "[0-9A-F]{24}", target["segment"]
        ):
            raise ValueError("Invalid recovery target")
        if fault not in (None, "missing_wal", "corrupt_wal"):
            raise ValueError("Unknown isolated fault")
        suffix = "restore-" + uuid.uuid4().hex[:8]
        data, archive = self.volume(suffix), self.volume(suffix + "-wal")
        self.helper(
            [
                (base["volume"], "/base", True),
                (data, "/data", False),
                (self.archive, "/original", True),
                (archive, "/archive", False),
            ],
            "cp -a /base/. /data/; cp -a /original/. /archive/; "
            + "printf \"restore_command = 'cp /archive/%%f %%p'\\nrecovery_target_name = '"
            + target["name"]
            + "'\\nrecovery_target_action = 'promote'\\n\" >> /data/postgresql.auto.conf; "
            + "printf 'local all all trust\\nhost all audit_app 0.0.0.0/0 reject\\nhost all postgres 0.0.0.0/0 scram-sha-256\\n' > /data/pg_hba.conf; "
            + "touch /data/recovery.signal; chown -R postgres:postgres /data; chmod 700 /data",
        )
        if fault:
            action = (
                "rm /archive/" if fault == "missing_wal" else "truncate -s 0 /archive/"
            ) + target["segment"]
            self.helper([(archive, "/archive", False)], action)
        node = self.launch(suffix, data, archive, recovering=True)
        if self.sql("SELECT pg_is_in_recovery();", node) != "f":
            raise RuntimeError("Recovery did not reach target")
        node["timeline"] = self.sql(
            "SELECT timeline_id FROM pg_control_checkpoint();", node
        )
        node["target"] = target
        node["base_manifest_sha256"] = base["manifest_sha256"]
        node["opened"] = False
        return node

    def close(self):
        for name in reversed(self.containers):
            self.owned("container", name)
            self.cmd("rm", "-f", name)
        self.containers.clear()
        for name in reversed(self.volumes):
            self.owned("volume", name)
            self.cmd("volume", "rm", name)
        self.volumes.clear()

    def __exit__(self, *args):
        self.close()
