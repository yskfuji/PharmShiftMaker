"""Utilities for exporting confirmed schedules to JSON/CSV for downstream systems."""

from __future__ import annotations

import csv
import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal, cast

import httpx

ISO_DATE_FORMAT = "%Y-%m-%d"


class ExporterError(RuntimeError):
    """Raised when schedule export fails due to HTTPエラーなど."""


@dataclass(slots=True)
class ExportOptions:
    """User provided parameters for the export helper."""

    base_url: str
    username: str
    password: str
    year: int
    month: int
    output_dir: Path
    scope_id: str = "hospital/pharmacy"
    generate: bool = False
    trial_mode: bool = True
    timeout: float = 30.0
    template_mode: Literal["long", "wide", "both"] = "both"


@dataclass(slots=True)
class ExportSummary:
    """Result metadata returned to callers."""

    json_path: Path
    csv_long_path: Path | None
    csv_wide_path: Path | None
    total_assignments: int
    total_warnings: int
    trial_mode: bool


def export_schedule(options: ExportOptions) -> ExportSummary:
    """Compatibility CLI: export reviewed publications through the managed API."""
    import hashlib
    import os
    from urllib.parse import urlencode

    if options.generate:
        raise ExporterError(
            "生成・確認・公開を勤務表画面で完了してから出力してください。CLIから公開を迂回できません。"
        )
    if not 1 <= options.month <= 12:
        raise ExporterError("month must be between 1 and 12")
    paths = _make_output_paths(options.output_dir, options.year, options.month)
    requested = [("json", paths[0])]
    if options.template_mode in ("long", "both"):
        requested.append(("csv", paths[1]))
    if options.template_mode in ("wide", "both"):
        requested.append(("csv-wide", paths[2]))
    if any(path.is_symlink() for _, path in requested):
        raise ExporterError(
            "既存の出力は上書きしません。新しい出力先を指定してください。"
        )
    scope = "?" + urlencode({"scope_id": options.scope_id})
    options.output_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(
        base_url=_normalize_base_url(options.base_url), timeout=options.timeout
    ) as client:
        token = _login(client, options.username, options.password)
        headers = _auth_headers(token)
        response = client.get("/planning/publications" + scope, headers=headers)
        response.raise_for_status()
        from datetime import datetime

        matches = []
        for row in response.json():
            try:
                start, end = (
                    datetime.fromisoformat(value) for value in row["period"].split("|")
                )
            except (ValueError, KeyError) as exc:
                raise ExporterError("公開期間の形式を照合できません。") from exc
            if start.tzinfo is None or end.tzinfo is None or end <= start:
                raise ExporterError("公開期間の日時が不正です。")
            if (start.year, start.month) == (options.year, options.month):
                matches.append(row)
        if len(matches) != 1:
            raise ExporterError("対象月の公開済み勤務表が一意に見つかりません。")
        published = matches[0]
        count = len(published["assignments"])
        for format, path in requested:
            # Content-derived keys: a rerun from another process after a crash resends the
            # same requests and receives the same registered artifact and transfer.
            key = hashlib.sha256(
                "|".join(
                    [
                        options.scope_id,
                        published["publication_id"],
                        str(published["version"]),
                        format,
                        str(path.absolute()),
                    ]
                ).encode()
            ).hexdigest()
            artifact = _request_json(
                client.post,
                "/planning/publications/"
                + published["publication_id"]
                + "/artifacts"
                + scope,
                headers=headers,
                json={
                    "expected_revision": published["version"],
                    "format": format,
                    "idempotency_key": "artifact-" + key[:48],
                },
            )
            if path.exists():
                # Resume: an output already written completely is kept; anything else stops.
                if (
                    not path.is_file()
                    or hashlib.sha256(path.read_bytes()).hexdigest()
                    != artifact["content_hash"]
                ):
                    raise ExporterError(
                        "既存の出力は上書きしません。新しい出力先を指定してください。"
                    )
                continue
            download = client.post(
                "/planning/artifacts/" + artifact["copy_id"] + "/download" + scope,
                headers=headers,
                json={
                    "expected_revision": artifact["revision"],
                    "idempotency_key": "download-" + key[:48],
                    "destination": str(path.absolute()),
                },
            )
            download.raise_for_status()
            if (
                not download.headers.get("X-Transfer-ID")
                or hashlib.sha256(download.content).hexdigest()
                != artifact["content_hash"]
            ):
                raise ExporterError(
                    "受渡し記録または出力ハッシュを照合できません。保存を停止しました。"
                )
            # Exclusive creation; partial files remain attributable to the registered destination.
            with path.open("xb") as stream:
                stream.write(download.content)
                stream.flush()
                os.fsync(stream.fileno())
    return ExportSummary(
        json_path=paths[0],
        csv_long_path=paths[1] if options.template_mode in ("long", "both") else None,
        csv_wide_path=paths[2] if options.template_mode in ("wide", "both") else None,
        total_assignments=count,
        total_warnings=0,
        trial_mode=False,
    )


def build_long_rows(assignments: Sequence[Mapping[str, Any]]) -> list[dict[str, str]]:
    """Return sorted rows with keys date/shift_id/person_id for CSV writing."""

    rows: list[dict[str, str]] = []
    for assignment in assignments:
        assignment_date = assignment.get("assignment_date")
        iso_date = _ensure_iso_date(assignment_date)
        rows.append(
            {
                "date": iso_date,
                "shift_id": str(assignment.get("shift_id", "")),
                "person_id": str(assignment.get("person_id", "")),
            }
        )

    rows.sort(key=lambda item: (item["date"], item["shift_id"], item["person_id"]))
    return rows


def build_wide_rows(
    assignments: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, str]], list[str]]:
    """Pivot assignments so each shift_id becomes a column (病棟別カラム)."""

    shift_ids = sorted(
        {str(item.get("shift_id", "")) for item in assignments if item.get("shift_id")}
    )
    assignments_by_date: dict[str, dict[str, list[str]]] = {}
    for assignment in assignments:
        iso_date = _ensure_iso_date(assignment.get("assignment_date"))
        shift_id = str(assignment.get("shift_id", ""))
        person_id = str(assignment.get("person_id", ""))
        assignments_by_date.setdefault(iso_date, {}).setdefault(shift_id, []).append(
            person_id
        )

    rows: list[dict[str, str]] = []
    for iso_date in sorted(assignments_by_date.keys()):
        row: dict[str, str] = {
            "date": iso_date,
            "weekday": _weekday_label(iso_date),
        }
        for shift_id in shift_ids:
            persons = assignments_by_date[iso_date].get(shift_id, [])
            row[shift_id] = " / ".join(sorted(persons)) if persons else ""
        rows.append(row)

    return rows, shift_ids


def _ensure_iso_date(value: Any) -> str:
    if isinstance(value, date):
        return value.strftime(ISO_DATE_FORMAT)
    if isinstance(value, str):
        return value
    raise ExporterError("assignment_date は ISO8601 文字列 or date を想定しています")


def _weekday_label(iso_date: str) -> str:
    weekday_names = ["月", "火", "水", "木", "金", "土", "日"]
    dt = date.fromisoformat(iso_date)
    return weekday_names[dt.weekday() % 7]


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    from shift_scheduler.ops.legacy_storage import require_development_storage

    require_development_storage()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_csv(
    path: Path, rows: Iterable[Mapping[str, str]], fieldnames: Sequence[str]
) -> None:
    from shift_scheduler.ops.legacy_storage import require_development_storage

    require_development_storage()
    with path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writerow({name: spreadsheet_cell(name) for name in fieldnames})
        for row in rows:
            writer.writerow(
                {name: spreadsheet_cell(row.get(name, "")) for name in fieldnames}
            )


def _make_output_paths(
    output_dir: Path, year: int, month: int
) -> tuple[Path, Path, Path]:
    suffix = f"{year}_{month:02d}"
    return (
        output_dir / f"schedule_{suffix}.json",
        output_dir / f"schedule_{suffix}.csv",
        output_dir / f"schedule_{suffix}_template.csv",
    )


def _normalize_base_url(base_url: str) -> str:
    normalized = base_url.strip()
    if normalized.endswith("/"):
        normalized = normalized[:-1]
    return normalized or "http://127.0.0.1:8000"


def _login(client: httpx.Client, username: str, password: str) -> str:
    response = _request_json(
        client.post,
        "/auth/login",
        json={"username": username, "password": password},
    )
    token = response.get("access_token")
    if not isinstance(token, str) or not token:
        raise ExporterError("access_token を取得できませんでした")
    return token


def _fetch_lock_version(client: httpx.Client, token: str, year: int, month: int) -> int:
    response = client.get(
        f"/schedules/{year}/{month}",
        headers=_auth_headers(token),
    )
    if response.status_code == 404:
        return 0
    response.raise_for_status()
    payload = response.json()
    return int(payload.get("lock_version") or 0)


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _request_json(
    method: Callable[..., httpx.Response],
    url: str,
    **kwargs: Any,
) -> dict[str, Any]:
    try:
        response = method(url, **kwargs)
    except httpx.HTTPError as exc:
        raise ExporterError(f"HTTP リクエストに失敗しました: {exc}") from exc
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ExporterError("JSON レスポンスが dict ではありません")
    return cast(dict[str, Any], data)


__all__ = [
    "ExportOptions",
    "ExportSummary",
    "ExporterError",
    "build_long_rows",
    "build_wide_rows",
    "export_schedule",
]


def spreadsheet_cell(value: str) -> str:
    """Human-view CSV only; machine JSON and typed attendance IDs stay unchanged."""
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(
        ("\t", "\r", "\n")
    ):
        return "'" + value
    return value
