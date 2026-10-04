"""Bounded import of the application's existing actual-event JSON representation.

No inferred HR column mapping. Original byte hash, source revisions and observed
database versions bind the preview; the entire file commits or rolls back.
"""

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shift_scheduler.application.compliance import entity_key
from shift_scheduler.application.planning import Conflict
from shift_scheduler.db.compliance_models import ComplianceEntity
from shift_scheduler.db.planning_models import ActualWorkEvent
from shift_scheduler.domain.planning import content_hash


class ActualFileErrors(ValueError):
    """Bounded row errors without echoing the source's personal information."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors
        super().__init__(
            "実績原本にエラーがあります。保存せず、全行を確認してください。"
        )


def row_error(index: int, code: str, message: str) -> dict[str, Any]:
    return {"row": index + 1, "code": code, "message": message}


def inspect_actual_file(
    session: Session, scope: str, actor: str, source: str
) -> dict[str, Any]:
    if len(source.encode("utf-8")) > 2_000_000:
        raise ValueError("原本はUTF-8で2MB以内にしてください。")
    document = json.loads(source)
    if (
        not isinstance(document, dict)
        or set(document) != {"format", "events"}
        or document["format"] != "pharmshift-actuals-v1"
    ):
        raise ValueError(
            "対応する原本形式はpharmshift-actuals-v1です。未知の列を推測変換しません。"
        )
    events = document["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= 500:
        raise ValueError("1〜500件の実績を指定してください。")
    from shift_scheduler.api.routers.planning import ActualRequest
    from shift_scheduler.domain.compliance import WorkTerms

    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    versions, requests, seen_actuals, seen_duties, errors = [], [], set(), set(), []
    for index, event in enumerate(events):
        if not isinstance(event, dict) or set(event) != {
            "external_id",
            "revision",
            "duty",
            "work_terms",
        }:
            errors.append(
                row_error(index, "shape", "実績と所定内外区分の対応が必要です。")
            )
            continue
        try:
            parsed = ActualRequest.model_validate(
                {k: event[k] for k in ("external_id", "revision", "duty")}
            )
            terms = WorkTerms.model_validate(event["work_terms"])
        except ValueError:
            errors.append(
                row_error(
                    index, "validation", "形式・日時・所定区分を確認してください。"
                )
            )
            continue
        if parsed.external_id in seen_actuals or parsed.duty.duty_id in seen_duties:
            errors.append(
                row_error(index, "duplicate", "同じ実績または勤務が重複しています。")
            )
        seen_actuals.add(parsed.external_id)
        seen_duties.add(parsed.duty.duty_id)
        if terms.duty_id != parsed.duty.duty_id:
            errors.append(
                row_error(index, "mapping", "実績と所定内外区分の勤務が一致しません。")
            )
        latest = session.scalar(
            select(ActualWorkEvent)
            .where(
                ActualWorkEvent.scope_id == scope,
                ActualWorkEvent.external_id == parsed.external_id,
            )
            .order_by(ActualWorkEvent.revision.desc())
            .limit(1)
        )
        current = latest.revision if latest else 0
        old_terms = session.get(
            ComplianceEntity, entity_key(scope, "work_terms", terms.duty_id)
        )
        terms_revision = old_terms.revision if old_terms else 0
        if parsed.revision != current + 1:
            errors.append(
                row_error(
                    index,
                    "revision",
                    "原本改定番号と保存済み最新版が連続していません。",
                )
            )
        versions.append(
            {
                "external_id": parsed.external_id,
                "expected_revision": current,
                "expected_work_terms_revision": terms_revision,
                "person_id": parsed.duty.person_id,
                "start": parsed.duty.start.isoformat(),
                "end": parsed.duty.end.isoformat(),
                "row": index + 1,
            }
        )
        requests.append(
            {
                "expected_revision": current,
                "idempotency_key": content_hash([source_hash, index]),
                "payload": {
                    **parsed.model_dump(mode="json"),
                    "work_terms": terms.model_dump(mode="json"),
                    "expected_work_terms_revision": terms_revision,
                },
            }
        )
    if errors:
        # Preserve the existing CAS conflict response when only versions changed.
        if all(e["code"] == "revision" for e in errors):
            raise Conflict(
                "原本改定番号と保存済み最新版が連続していません。該当行："
                + ", ".join(str(e["row"]) for e in errors)
            )
        raise ActualFileErrors(errors)
    return {
        "source_hash": source_hash,
        "preview_hash": content_hash([scope, actor, source_hash, versions]),
        "rows": versions,
        "requests": requests,
    }
