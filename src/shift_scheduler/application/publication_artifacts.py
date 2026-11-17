"""Deterministic published artifacts, reserved before any managed bytes exist.

Rendering uses only a published revision. This module never generates a roster.
Downloads are separately registered external copies; managed erasure cannot
claim that a file already handed to a recipient has disappeared.
"""

import csv
import hashlib
import io
import json
from datetime import UTC
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.application.planning import Conflict, lock_facility
from shift_scheduler.db.compliance_models import CopySubject, ManagedCopy
from shift_scheduler.db.planning_models import PlanningPublication, PlanningReceipt
from shift_scheduler.domain.copies import CopyRegistration
from shift_scheduler.domain.planning import Duty, Evidence, content_hash
from shift_scheduler.ops.exporter import spreadsheet_cell
from shift_scheduler.ops.managed_writer import registered_copy, reserve_in_session

JST = ZoneInfo("Asia/Tokyo")
FORMATS = {
    "json": "application/json",
    "csv": "text/csv; charset=utf-8",
    "csv-wide": "text/csv; charset=utf-8",
}


def render(publication: PlanningPublication, format: str) -> bytes:
    if format not in FORMATS:
        raise ValueError("Unsupported publication export format")
    duties = [Duty.model_validate(d) for d in publication.payload["assignments"]]
    value = {
        "schema_version": 1,
        "publication_id": publication.publication_id,
        "period": publication.period_key,
        "version": publication.version,
        "input_hash": publication.payload["input_hash"],
        "rule_revision": publication.payload["rule_revision"],
        "assignments": [d.model_dump(mode="json") for d in duties],
        "count": len(duties),
        "work_seconds": sum(d.work_seconds for d in duties),
    }
    if format == "json":
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    if format == "csv-wide":
        # Human viewing only: no payroll duration or implicit night-shift splitting.
        kinds = sorted({d.kind for d in duties})
        writer.writerow(["date", *[spreadsheet_cell(k) for k in kinds]])
        for day in sorted({d.start.astimezone(JST).date() for d in duties}):
            writer.writerow(
                [
                    day.isoformat(),
                    *[
                        spreadsheet_cell(
                            " / ".join(
                                sorted(
                                    d.person_id
                                    for d in duties
                                    if d.start.astimezone(JST).date() == day
                                    and d.kind == k
                                )
                            )
                        )
                        for k in kinds
                    ],
                ]
            )
        return out.getvalue().encode("utf-8")
    writer.writerow(
        [
            "publication_id",
            "version",
            "person_id",
            "duty_id",
            "start",
            "end",
            "work_seconds",
        ]
    )
    for d in duties:
        writer.writerow(
            [
                spreadsheet_cell(str(v))
                for v in (
                    publication.publication_id,
                    publication.version,
                    d.person_id,
                    d.duty_id,
                    d.start.isoformat(),
                    d.end.isoformat(),
                    d.work_seconds,
                )
            ]
        )
    return out.getvalue().encode("utf-8")


def prepare(
    session: Session,
    scope: str,
    actor: str,
    publication_id: str,
    expected: int,
    format: str,
    key: str,
) -> tuple[dict[str, Any], bytes]:
    lock_facility(session, scope)
    publication = session.get(PlanningPublication, publication_id)
    if not publication or publication.scope_id != scope:
        raise LookupError("Published revision not found")
    if publication.version != expected:
        raise Conflict("Published revision changed")
    data = render(publication, format)
    fingerprint = content_hash([publication_id, expected, format])
    receipt_id = content_hash([scope, actor, "publication.artifact", key])
    receipt = session.get(PlanningReceipt, receipt_id)
    if receipt and receipt.fingerprint != fingerprint:
        raise Conflict("Idempotency key reused for a different artifact")
    copy_id = receipt_id[:32]
    item = CopyRegistration(
        copy_id=copy_id,
        category="exports",
        medium="file",
        relative_path=copy_id,
        content_hash=hashlib.sha256(data).hexdigest(),
        person_ids=tuple(
            sorted({d["person_id"] for d in publication.payload["assignments"]})
        ),
        anchor="last_activity",
        anchor_at=(
            publication.created_at.replace(tzinfo=UTC)
            if publication.created_at.tzinfo is None
            else publication.created_at
        ),
        subject_status="VERIFIED",
        evidence=Evidence(
            reference="publication:" + publication_id,
            status="verified",
            verified_by="typed-publication-export",
        ),
    )
    # SQLite does not retain timezone metadata; the publication clock is UTC.
    reserve_in_session(
        session,
        scope,
        item,
        "publication.json" if format == "json" else "schedule.csv",
        content_hash(publication.payload),
    )
    row = registered_copy(session, copy_id)  # reserved just above
    row.locator = {
        **row.locator,
        "source_publication_id": publication_id,
        "source_version": expected,
        "format": format,
        "hash_scheme": "sha256-bytes",
    }
    result = {
        "copy_id": copy_id,
        "content_hash": item.content_hash,
        "publication_id": publication_id,
        "version": expected,
        "format": format,
    }
    if not receipt:
        session.add(
            PlanningReceipt(
                receipt_id=receipt_id, fingerprint=fingerprint, response=result
            )
        )
    return result, data


def read_registered(
    session: Session, scope: str, copy_id: str
) -> tuple[ManagedCopy, tuple[str, ...], bytes]:
    """Read exact bytes under the facility lock; never stream after the check."""
    import os

    from shift_scheduler.application.copies import storage_root
    from shift_scheduler.ops.managed_writer import allowed_subjects, file_lock

    lock_facility(session, scope)
    row = session.get(ManagedCopy, copy_id)
    if not row or row.scope_id != scope or row.locator.get("format") not in FORMATS:
        raise LookupError("Published artifact not found")
    if row.state != "PRESENT" or row.evidence.get("writer_format") != 1:
        raise Conflict("Artifact is unavailable or restricted")
    people = tuple(
        session.scalars(
            select(CopySubject.person_id).where(CopySubject.copy_id == copy_id)
        )
    )
    allowed_subjects(session, scope, people)
    with file_lock(storage_root(), copy_id) as directory:
        fd = os.open(
            row.locator["relative_path"], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory
        )
        with os.fdopen(fd, "rb") as stream:
            data = stream.read()
        if hashlib.sha256(data).hexdigest() != row.content_hash:
            raise Conflict("Artifact bytes no longer match the registered hash")
    return row, people, data
