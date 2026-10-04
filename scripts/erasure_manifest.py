"""Local operator tool. Restore gate must be committed before a replay is attempted."""

from __future__ import annotations

import argparse
import json
import os
from contextlib import nullcontext
from pathlib import Path

from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain.planning import content_hash
from shift_scheduler.ops.erasure_replay import export_manifest, quarantine, replay


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "operation", choices=["export", "quarantine", "apply", "inspect-target"]
    )
    parser.add_argument("--file", type=Path)
    parser.add_argument("--expected-hash")
    parser.add_argument("--result", type=Path)
    parser.add_argument(
        "--control-dir",
        type=Path,
        help="Independent current-control directory, never restored from backup",
    )
    parser.add_argument("--control-generation", type=int)
    parser.add_argument(
        "--restore-node",
        help="Independent service identity of the isolated restore target",
    )
    parser.add_argument(
        "--preservation-artifacts",
        type=Path,
        help="Separately retained partial histories required by V5 controls",
    )
    args = parser.parse_args()
    secret = os.environ.get("PHARMSHIFT_ERASURE_MANIFEST_KEY", "").encode()
    if args.operation not in {"quarantine", "inspect-target"} and len(secret) < 32:
        raise ValueError(
            "Separate manifest signing key (at least 32 bytes) required in secret environment"
        )
    factory = get_session_factory()
    if args.operation in {"quarantine", "apply", "inspect-target"}:
        # Privileged offline maintenance path; ordinary engines cannot bypass quarantine.
        from sqlalchemy import create_engine
        from sqlalchemy.engine import make_url
        from sqlalchemy.orm import sessionmaker

        from shift_scheduler.db.settings import DatabaseSettings

        url = make_url(DatabaseSettings.from_environment().url)
        if url.get_backend_name() == "postgresql" and not any(
            label in (url.database or "") for label in ("audit", "restore")
        ):
            raise ValueError(
                "Replay requires an explicitly isolated audit/restore target"
            )
        factory = sessionmaker(create_engine(url))
    if args.operation == "inspect-target":
        from shift_scheduler.control.restore_verification import target_description

        print(json.dumps(target_description(factory), sort_keys=True))
        return
    if args.operation == "export":
        # Reject the obsolete authority writer BEFORE serializing a manifest.
        # advance() also guards this, but is reached only after file commit.
        from shift_scheduler.ops.legacy_storage import require_development_storage

        require_development_storage()
    from shift_scheduler.control.client import configured_client

    client = configured_client()
    if client is not None:
        if args.operation == "export":
            raise ValueError(
                "Authority controls are prepared with application commits; standalone exports cannot advance them"
            )
        if not args.restore_node:
            raise ValueError("--restore-node is required with the independent service")
        if args.operation == "quarantine":
            client.request("POST", f"/nodes/{args.restore_node}/quarantine")
            with factory.begin() as session:
                quarantine(session)
            result = {"state": "QUARANTINED"}
        else:
            from shift_scheduler.control.recovery import restore_with_authority

            result = restore_with_authority(
                factory,
                client,
                args.restore_node,
                secret,
                (
                    json.loads(args.preservation_artifacts.read_text())
                    if args.preservation_artifacts
                    else None
                ),
            )
        if args.result:
            with args.result.open("x") as stream:
                json.dump(result, stream, ensure_ascii=False, indent=2)
            args.result.chmod(0o600)
        print(json.dumps(result, ensure_ascii=False))
        return
    from shift_scheduler.ops.erasure_control import advance, restore_authority

    if args.operation in {"export", "apply"} and (
        args.control_dir is None or args.control_generation is None
    ):
        raise ValueError(
            "Independent --control-dir and --control-generation are required"
        )
    authority = (
        restore_authority(
            args.control_dir, args.expected_hash, secret, args.control_generation
        )
        if args.operation == "apply"
        else nullcontext()
    )
    with authority, factory.begin() as session:
        if args.operation == "quarantine":
            quarantine(session)
            result = {"state": "QUARANTINED"}
        elif args.operation == "export":
            if args.file is None:
                raise ValueError("--file is required")
            manifest = export_manifest(session, secret)
            # Never overwrite a prior evidence generation or follow an existing link.
            fd = os.open(args.file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(manifest, stream, ensure_ascii=False, indent=2)
            result = {"manifest_hash": content_hash(manifest), "file": str(args.file)}
        else:
            if args.file is None or not args.expected_hash:
                raise ValueError(
                    "Current independently recorded --expected-hash and --file are required"
                )
            result = replay(
                session,
                json.loads(args.file.read_text()),
                args.expected_hash,
                secret,
                (
                    json.loads(args.preservation_artifacts.read_text())
                    if args.preservation_artifacts
                    else None
                ),
            )
    if args.operation == "export":
        control = advance(
            args.control_dir, result["manifest_hash"], secret, args.control_generation
        )
        result["control_generation"] = control["payload"]["generation"]
    if args.result:
        with args.result.open("x") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
        args.result.chmod(0o600)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
