"""Summarise a visual-audit run (audit/visual-*/results.json) into summary.md and summary.json.

    python -m devtools.visual.summarize audit/visual-2026-09-28-s0-before-sb-r2

Counts optical findings per engine, target (story or screen) and check, and lists
the distinct findings of the chromium run (the other engines are counted).

The structural checks of the workspace (frontend/tests/visual/lib/structure.ts) attach
`structure-<name>` (findings, which fail the test) and `advisory-<name>` (measurements
that never fail). They are counted apart from the optical findings.
"""

from __future__ import annotations

import base64
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def findings(results: dict, prefix: str = "optical-") -> list[dict]:
    rows = []

    def walk(suite: dict):
        for spec in suite.get("specs", []):
            for test in spec["tests"]:
                for result in test["results"]:
                    for attachment in result.get("attachments", []):
                        if attachment["name"].startswith(prefix) and attachment.get(
                            "body"
                        ):
                            target = attachment["name"].removeprefix(prefix)
                            for item in json.loads(
                                base64.b64decode(attachment["body"])
                            ):
                                rows.append(
                                    {
                                        "engine": test["projectName"],
                                        "target": target,
                                        **item,
                                    }
                                )
        for child in suite.get("suites", []):
            walk(child)

    for suite in results.get("suites", []):
        walk(suite)
    return rows


def summarise(run: Path) -> dict:
    results = json.loads((run / "results.json").read_text())
    rows = findings(results)
    skipped = findings(results, "skipped-")
    structure = findings(results, "structure-")
    advisories = findings(results, "advisory-")
    stats = results.get("stats", {})
    per_check = Counter((r["engine"], r["check"]) for r in rows)
    per_target: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        per_target[r["target"].rsplit("-", 2)[0]][r["check"]] += 1
    return {
        "run": run.name,
        "tests_expected": stats.get("expected"),
        "tests_unexpected": stats.get("unexpected"),
        "findings": len(rows),
        "skipped": len(skipped),
        "skipped_reasons": dict(
            Counter(f"{r['check']}: {r['detail']}" for r in skipped)
        ),
        "per_engine_check": {f"{e} {c}": n for (e, c), n in sorted(per_check.items())},
        "per_target": {t: dict(c) for t, c in sorted(per_target.items())},
        "structure_findings": len(structure),
        "structure_per_engine_check": dict(
            sorted(Counter(f"{r['engine']} {r['check']}" for r in structure).items())
        ),
        "structure_distinct": sorted(
            {
                f"{r['check']}: {r['target'].rsplit('-', 2)[0]} {r['selector']} "
                f"\"{r['text']}\" {r['detail']}"
                for r in structure
            }
        ),
        "advisories": len(advisories),
        "advisories_per_engine_check": dict(
            sorted(Counter(f"{r['engine']} {r['check']}" for r in advisories).items())
        ),
        "chromium_distinct": sorted(
            {
                f"{r['check']}: {r['selector']} \"{r['text']}\" {r['detail']}"
                for r in rows
                if r["engine"] == "chromium-linux"
            }
        ),
    }


def markdown(summary: dict) -> str:
    lines = [
        f"# 視覚・光学の監査の集計：{summary['run']}",
        "",
        f"- 試験：成功 {summary['tests_expected']}・失敗 {summary['tests_unexpected']}",
        f"- 光学の検出：{summary['findings']} 件（全エンジン・全幅・全配色の延べ）",
        f"- 判定できず飛ばした件数：{summary['skipped']} 件（延べ）"
        + (
            "：" + "、".join(f"{k} {v}" for k, v in summary["skipped_reasons"].items())
            if summary["skipped"]
            else ""
        ),
        "",
        "## エンジン・検査ごと",
        "",
        "| エンジン・検査 | 件数 |",
        "|---|---|",
    ]
    lines += [f"| {k} | {v} |" for k, v in summary["per_engine_check"].items()]
    lines += ["", "## 対象ごと（延べ）", "", "| 対象 | 検査ごとの件数 |", "|---|---|"]
    lines += [
        f"| {t} | {'、'.join(f'{c} {n}' for c, n in counts.items())} |"
        for t, counts in summary["per_target"].items()
    ]
    lines += [
        "",
        "## 構造の検査（workspace）",
        "",
        f"- 検出（試験を失敗にする）：{summary['structure_findings']} 件（延べ）",
        f"- 注意（失敗にしない測定）：{summary['advisories']} 件（延べ）",
        "",
        "| エンジン・検査 | 検出 |",
        "|---|---|",
    ]
    lines += [
        f"| {k} | {v} |" for k, v in summary["structure_per_engine_check"].items()
    ]
    lines += ["", "| エンジン・検査 | 注意 |", "|---|---|"]
    lines += [
        f"| {k} | {v} |" for k, v in summary["advisories_per_engine_check"].items()
    ]
    lines += ["", "### 構造の検出（重複を除く）", ""] + [
        f"- {x}" for x in summary["structure_distinct"][:200]
    ]
    lines += ["", "## chromium での検出（重複を除く）", ""] + [
        f"- {x}" for x in summary["chromium_distinct"][:200]
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    run = Path(argv[0])
    summary = summarise(run)
    (run / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1) + "\n"
    )
    (run / "summary.md").write_text(markdown(summary))
    print(
        f"{summary['findings']} optical findings; "
        f"{summary['structure_findings']} structural findings; "
        f"{summary['advisories']} advisories; tests failed {summary['tests_unexpected']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
