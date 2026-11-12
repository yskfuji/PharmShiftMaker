"""The personal print page: readable values, one hashed inline style, nothing else."""

import base64
import hashlib
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from shift_scheduler.api import print_page

TOKYO = ZoneInfo("Asia/Tokyo")


@dataclass
class Duty:
    start: datetime
    end: datetime
    kind: str
    location: str


def test_policy_allows_exactly_the_page_style_and_nothing_else():
    digest = base64.b64encode(
        hashlib.sha256(print_page.PRINT_STYLE.encode()).digest()
    ).decode()
    assert f"style-src 'sha256-{digest}'" in print_page.PRINT_CSP
    assert print_page.PRINT_CSP.startswith("default-src 'none';")
    for allowed in ("script-src", "unsafe-inline", "img-src", "connect-src"):
        assert allowed not in print_page.PRINT_CSP


def test_rows_use_tokyo_dates_and_duty_names_and_escape_text():
    duties = [
        Duty(
            datetime(2026, 1, 5, 0, tzinfo=ZoneInfo("UTC")),
            datetime(2026, 1, 5, 4, tzinfo=ZoneInfo("UTC")),
            "DAY",
            "<main>",
        ),
        Duty(
            datetime(2026, 1, 9, 22, tzinfo=TOKYO),
            datetime(2026, 1, 10, 7, tzinfo=TOKYO),
            "NIGHT_SHIFT",
            "病棟",
        ),
    ]
    html = print_page.render(3, "x", duties)
    assert "2026年1月5日（月）" in html and "9:00〜13:00" in html
    assert "22:00〜翌日 7:00" in html and "夜勤" in html and "日勤" in html
    assert "&lt;main&gt;" in html and "<main>" not in html
    assert "+09:00" not in html and "T09" not in html
    assert f"<style>{print_page.PRINT_STYLE}</style>" in html


def test_period_shows_the_last_included_day():
    start = datetime(2026, 1, 5, tzinfo=TOKYO)
    end = datetime(2026, 1, 12, tzinfo=TOKYO)
    assert (
        print_page.period_text(start, end) == "2026年1月5日（月）〜2026年1月11日（日）"
    )


def test_a_person_without_duties_is_told_so():
    assert "あなたの勤務はありません" in print_page.render(1, "x", [])
