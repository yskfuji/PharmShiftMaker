"""The personal schedule print page: the only HTML page the API serves.

The API's default policy (``default-src 'none'``) blocks every stylesheet, so this page
carries one fixed inline style that its own policy allows by hash. Nothing else may
load or run on the page.
"""

from __future__ import annotations

import base64
import hashlib
from collections.abc import Iterable
from datetime import datetime, timedelta
from html import escape
from typing import Protocol
from zoneinfo import ZoneInfo

TOKYO = ZoneInfo("Asia/Tokyo")
WEEKDAYS = "月火水木金土日"
# Same labels as the web schedule (frontend/src/features/workspace/planning/MonthlySchedule.tsx).
KIND_LABELS = {
    "DAY_SHIFT": "日勤",
    "EVENING_SHIFT": "遅番",
    "NIGHT_SHIFT": "夜勤",
    "DAY": "日勤",
    "NIGHT": "夜勤",
}

PRINT_STYLE = (
    ":root{color-scheme:light;font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic',"
    "system-ui,sans-serif;color:#1a1a1a;background:#fff;line-height:1.6}"
    "body{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 2.5rem}"
    "h1{margin:0 0 .25rem;font-size:1.5rem}"
    ".meta{margin:0 0 1.25rem;color:#4d4d4d}"
    "table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}"
    "caption{text-align:left;font-weight:700;padding:0 0 .5rem}"
    "th,td{padding:.55rem .7rem;border:1px solid #b3b3b3;text-align:left;vertical-align:top}"
    "th,td:nth-child(3){white-space:nowrap}"
    "thead th{background:#f2f2f2}"
    "tbody tr:nth-child(even) td{background:#fafafa}"
    ".empty{padding:1rem;border:1px solid #b3b3b3}"
    ".note{margin-top:1.25rem;color:#4d4d4d;font-size:.9rem}"
    "@media (max-width:30rem){body{padding:1rem .75rem}th,td{padding:.45rem .5rem}}"
    "@media print{body{max-width:none;padding:0}.note{display:none}"
    "thead{display:table-header-group}tr{break-inside:avoid}}"
    "@page{margin:15mm}"
)
_STYLE_HASH = base64.b64encode(hashlib.sha256(PRINT_STYLE.encode()).digest()).decode()
PRINT_CSP = (
    "default-src 'none'; "
    f"style-src 'sha256-{_STYLE_HASH}'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


class Duty(Protocol):
    start: datetime
    end: datetime
    kind: str
    location: str


def _day(value: datetime) -> str:
    local = value.astimezone(TOKYO)
    return f"{local.year}年{local.month}月{local.day}日（{WEEKDAYS[local.weekday()]}）"


def _time(value: datetime) -> str:
    local = value.astimezone(TOKYO)
    return f"{local.hour}:{local.minute:02d}"


def _hours(start: datetime, end: datetime) -> str:
    finish = _time(end)
    if end.astimezone(TOKYO).date() != start.astimezone(TOKYO).date():
        finish = f"翌日 {finish}"
    return f"{_time(start)}〜{finish}"


def period_text(start: datetime, end: datetime) -> str:
    """A half-open period [start, end) shown with its last included day."""
    last = (end - timedelta(microseconds=1)).astimezone(TOKYO)
    return f"{_day(start)}〜{_day(last)}"


def render(version: int, period: str, duties: Iterable[Duty]) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(_day(d.start))}</td>"
        f"<td>{escape(_hours(d.start, d.end))}</td>"
        f"<td>{escape(KIND_LABELS.get(d.kind, d.kind))}</td>"
        f"<td>{escape(d.location)}</td>"
        "</tr>"
        for d in duties
    )
    body = (
        "<table><caption>公開済みの勤務（日本時間）</caption>"
        '<thead><tr><th scope="col">日付</th><th scope="col">時間</th>'
        f'<th scope="col">勤務</th><th scope="col">場所</th></tr></thead><tbody>{rows}</tbody></table>'
        if rows
        else '<p class="empty">この公開版に、あなたの勤務はありません。</p>'
    )
    return (
        '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>自分の勤務表</title><style>{PRINT_STYLE}</style></head><body>"
        f'<h1>自分の勤務表</h1><p class="meta">公開版 {version} ・ 期間 {escape(period)}</p>'
        f"{body}"
        '<p class="note">印刷するには、ブラウザーの印刷機能を使ってください。</p>'
        "</body></html>"
    )
