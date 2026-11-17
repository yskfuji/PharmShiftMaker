"""監査ログ出力の薄いアブストラクション層.

本番運用では SIEM / 外部ログ基盤に連携する予定だが、フェーズ7では
JSON 形式での標準出力またはファイル出力に留める。インターフェイスを
定義しておくことで将来差し替えやすい構成とする。
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger("shift_scheduler.audit")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("%(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


class AuditLogger(Protocol):
    """監査イベントを永続化するロガーのプロトコル."""

    def log(self, event: AuditEvent) -> None:  # pragma: no cover - interface only
        ...


def _empty_dict() -> dict[str, Any]:
    return {}


@dataclass(frozen=True)
class AuditEvent:
    """監査対象イベントの共通フォーマット."""

    event_type: str
    actor_id: str
    actor_role: str
    action: str
    target_year: int | None = None
    target_month: int | None = None
    metadata: dict[str, Any] = field(default_factory=_empty_dict)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class JSONAuditLogger:
    """JSON 文字列として監査情報を記録するロガー."""

    def __init__(self, destination: Path | None = None) -> None:
        self._destination = destination
        if destination:
            from shift_scheduler.ops.legacy_storage import require_development_storage

            require_development_storage()
            destination.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event: AuditEvent) -> None:
        # Production business audit is the transactionally registered PlanningOutbox.
        # Legacy JSON/stdout logging cannot create an untracked personal-data copy.
        from shift_scheduler.ops.legacy_storage import require_development_storage

        require_development_storage()
        payload = asdict(event)
        payload["occurred_at"] = event.occurred_at.isoformat()
        serialized = json.dumps(payload, ensure_ascii=False)
        if self._destination:
            with self._destination.open("a", encoding="utf-8") as fp:
                fp.write(serialized + "\n")
        else:
            logger.info(serialized)


_DEFAULT_AUDIT_LOGGER: AuditLogger = JSONAuditLogger()


def get_audit_logger() -> AuditLogger:
    """アプリ全体で共有する監査ロガーを取得."""

    return _DEFAULT_AUDIT_LOGGER


def record_audit_event(**kwargs: Any) -> None:
    """簡易ヘルパー: dict 引数から AuditEvent を生成して記録する."""

    event = AuditEvent(**kwargs)
    get_audit_logger().log(event)


__all__ = [
    "AuditEvent",
    "AuditLogger",
    "JSONAuditLogger",
    "record_audit_event",
    "get_audit_logger",
]
