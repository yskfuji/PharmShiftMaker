"""Trusted operator CLI; DATABASE_URL is resolved exactly as the API/worker.

No automatic inference, destructive conversion, or implicit verification of legacy data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import select

from shift_scheduler.application.planning import emit, register_input
from shift_scheduler.db.planning_models import AccountMembership
from shift_scheduler.db.session import get_session_factory
from shift_scheduler.domain.planning import SolverSnapshot, content_hash


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("schema")
    member = sub.add_parser("membership")
    for key in ("issuer", "subject", "person", "scope", "actor", "evidence"):
        member.add_argument("--" + key, required=True)
    member.add_argument(
        "--role", choices=("ADMIN", "LEADER", "PHARMACIST"), required=True
    )
    member.add_argument("--disable", action="store_true")
    load = sub.add_parser("import-input")
    load.add_argument("file", type=Path)
    load.add_argument("--expected-revision", type=int, required=True)
    load.add_argument("--actor", required=True)
    inventory = sub.add_parser("inventory-legacy")
    inventory.add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.operation == "schema":
        print(
            json.dumps(SolverSnapshot.model_json_schema(), ensure_ascii=False, indent=2)
        )
        return
    if args.operation == "inventory-legacy":
        records = []
        for path in sorted(args.directory.rglob("*")):
            if path.is_symlink():
                raise ValueError("Legacy inventory refuses links")
            if path.is_file():
                if path.stat().st_size > 100 * 1024**2:
                    raise ValueError("File exceeds inventory limit")
                records.append(
                    {
                        "path": str(path.relative_to(args.directory)),
                        "bytes": path.stat().st_size,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    }
                )
        print(
            json.dumps(
                {
                    "files": records,
                    "count": len(records),
                    "status": "UNVERIFIED",
                    "requires": [
                        "stable person IDs",
                        "contract evidence",
                        "exact duty intervals",
                        "reconciled history",
                    ],
                },
                indent=2,
            )
        )
        return
    with get_session_factory().begin() as session:
        if args.operation == "import-input":
            if args.file.stat().st_size > 5 * 1024**2:
                raise ValueError("Input exceeds 5 MiB")
            snapshot = SolverSnapshot.model_validate_json(args.file.read_text())
            print(
                json.dumps(
                    register_input(
                        session, snapshot, args.actor, args.expected_revision
                    )
                )
            )
        else:
            key = content_hash([args.issuer, args.subject, args.scope])
            row = session.scalar(
                select(AccountMembership)
                .where(
                    AccountMembership.issuer == args.issuer,
                    AccountMembership.subject == args.subject,
                    AccountMembership.scope_id == args.scope,
                )
                .with_for_update()
            )
            if row is None:
                row = AccountMembership(
                    membership_id=key,
                    issuer=args.issuer,
                    subject=args.subject,
                    scope_id=args.scope,
                    person_id=args.person,
                    role=args.role,
                )
                session.add(row)
            elif row.person_id != args.person:
                raise ValueError(
                    "Existing account identity cannot be silently reassigned"
                )
            row.role, row.active = args.role, not args.disable
            emit(
                session,
                args.scope,
                args.actor,
                "membership.changed",
                {
                    "membership_id": row.membership_id,
                    "role": row.role,
                    "active": row.active,
                    "evidence": args.evidence,
                },
            )
            print(
                json.dumps({"membership_id": row.membership_id, "active": row.active})
            )


if __name__ == "__main__":
    main()
