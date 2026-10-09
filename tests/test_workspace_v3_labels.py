"""The workspace's words for recorded events follow what the server records.

`frontend/src/features/workspace/shared/labels.ts` names the areas the server sorts an
event into (`CATEGORY`), the first part of a kind (`SUBJECT`) and single kinds
(`EVENT_LABEL`). The server's side is `application/audit_timeline.CATEGORIES` and the kinds
its code emits. A part added on the server and not in the frontend would be named by its
area only, and a kind worded in the frontend that the server never emits is a dead entry
that reads as covered. The TypeScript maps are read with a regular expression: they are
flat object literals of string keys.
"""

from __future__ import annotations

import re
from pathlib import Path

from shift_scheduler.application import audit_timeline

ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / "frontend/src/features/workspace/shared/labels.ts"
SERVER = ROOT / "src/shift_scheduler"


def keys_of(name: str, source: str | None = None) -> list[str]:
    """The keys of the object literal assigned to `name`, in order."""
    text = LABELS.read_text(encoding="utf-8") if source is None else source
    found = re.search(
        rf"const {name}(?::[^=]+)? = \{{(.*?)\n?\}};", text, flags=re.DOTALL
    )
    assert found, f"{name} is not an object literal in labels.ts"
    return re.findall(r'(?:^|[\s,{])"?([A-Za-z_][\w.]*)"?\s*:\s*"', found.group(1))


def emitted_patterns() -> list[re.Pattern[str]]:
    """Every string literal of the server's code that can be a kind, as a pattern: a plain
    literal matches itself, and an f-string matches with each `{…}` as one lower-case part.
    """
    patterns = []
    for path in sorted(SERVER.rglob("*.py")):
        for prefix, literal in re.findall(
            r'(?<![\w"])(f?)"([a-z_]+\.[a-z_.{}() ]+)"',
            path.read_text(encoding="utf-8"),
        ):
            parts = re.split(r"\{[^{}]*\}", literal) if prefix else [literal]
            patterns.append(re.compile("[a-z_]+".join(re.escape(p) for p in parts)))
    return patterns


def test_the_parser_reads_a_flat_map() -> None:
    sample = 'const SUBJECT: Record<string, string> = {\n  change: "a", "x.y": "b",\n  job: "c",\n};'
    assert keys_of("SUBJECT", sample) == ["change", "x.y", "job"]


def test_every_part_and_area_the_server_knows_has_a_word() -> None:
    prefixes = [prefix.rstrip(".") for prefix, _ in audit_timeline.CATEGORIES]
    areas = {area for _, area in audit_timeline.CATEGORIES}
    assert sorted(keys_of("SUBJECT")) == sorted(prefixes)
    # "other" is the server's own name for what it sorts nowhere (audit_timeline.category).
    assert audit_timeline.category("not-a-kind") == "other"
    assert sorted(keys_of("CATEGORY")) == sorted(areas | {"other"})


def test_every_kind_worded_in_the_frontend_is_one_the_server_emits() -> None:
    patterns = emitted_patterns()
    source = "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(SERVER.rglob("*.py"))
    )
    dead = []
    for kind in keys_of("EVENT_LABEL"):
        if any(pattern.fullmatch(kind) for pattern in patterns):
            continue
        # An administrative record is emitted as "compliance." + its kind
        # (application/compliance.py): the kind itself must be a literal of the server.
        prefix, _, rest = kind.partition(".")
        if (
            prefix == "compliance"
            and '"compliance." + kind' in source
            and f'"{rest}"' in source
        ):
            continue
        dead.append(kind)
    assert dead == [], f"worded in labels.ts but never emitted by the server: {dead}"
    # The check can fail: a kind nobody emits is reported.
    assert not any(p.fullmatch("lifecycle.created") for p in patterns)
    assert any(p.fullmatch("lifecycle.onboard.created") for p in patterns)
    assert any(p.fullmatch("change.absence.declined") for p in patterns)
