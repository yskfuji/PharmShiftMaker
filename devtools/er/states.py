"""State diagrams of the ideal workflows, generated from the transition tables in the code.

The tables in shift_scheduler.application.ideal_workflows are the single source; the
diagrams draw no transition the code does not have. Each machine is its own diagram (no
state name is shared between machines) with an accessible title and description, and the
same transitions as a text table (screen readers do not read diagram edges).

    PYTHONPATH=src:. python -m devtools.er.states [--write | --check]
"""

from __future__ import annotations

import sys
from pathlib import Path

from shift_scheduler.application import ideal_workflows as workflows

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "architecture" / "er"
NAME = "ideal-states.md"
MACHINES = (
    ("membership", "本人アカウントの紐付け", workflows.MEMBERSHIP_TRANSITIONS),
    ("change", "欠勤・勤務交換のケース", workflows.CHANGE_TRANSITIONS),
    ("lifecycle", "入職・退職のケース", workflows.LIFECYCLE_TRANSITIONS),
)


def mermaid(title: str, transitions: tuple[tuple[str, str, str], ...]) -> str:
    states = sorted({s for a, b, _ in transitions for s in (a, b) if s != "START"})
    lines = [
        "stateDiagram-v2",
        f"  accTitle: {title}の状態遷移",
        f"  accDescr: 状態は {'、'.join(states)}。遷移はコードの遷移表から生成し、下の表と同じ内容です。",
    ]
    for source, target, reason in transitions:
        lines.append(
            f"  {'[*]' if source == 'START' else source} --> {target}: {reason}"
        )
    return "\n".join(lines)


def markdown() -> str:
    parts = [
        "# 理想UIの業務状態（コードの遷移表から生成）",
        "",
        "`PYTHONPATH=src:. python -m devtools.er.states --write` で生成する。手で編集しない。",
        "ここにない遷移はコードにない。図の読み上げは題と説明だけなので、各図の下に同じ内容の表を置く。",
        "",
    ]
    for _key, title, transitions in MACHINES:
        parts += [
            f"## {title}",
            "",
            "```mermaid",
            mermaid(title, transitions),
            "```",
            "",
            "| 遷移前 | 遷移後 | 条件 |",
            "|---|---|---|",
        ]
        parts += [
            f"| {'（作成）' if a == 'START' else a} | {b} | {reason} |"
            for a, b, reason in transitions
        ]
        parts.append("")
    return "\n".join(parts)


def outputs() -> dict[str, str]:
    return {NAME: markdown()}


def main(argv: list[str]) -> int:
    if "--check" in argv:
        stale = [
            n
            for n, t in outputs().items()
            if not (OUT / n).exists() or (OUT / n).read_text() != t
        ]
        print("stale: " + ", ".join(stale) if stale else "state diagrams are current")
        return 1 if stale else 0
    if "--write" in argv:
        for name, text in outputs().items():
            (OUT / name).write_text(text)
        print(f"wrote {NAME} to {OUT}")
        return 0
    sys.stdout.write(markdown())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
