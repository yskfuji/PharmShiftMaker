"""Fail when a published Markdown document has a broken repository-local link.

External references are deliberately not treated as a deterministic CI result:
availability, redirects and bot controls can change independently of this source
tree.  Their publisher and access date are reviewed in the legal/evidence
documents.  This check covers the part controlled by the repository.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

from devtools.release.public_tree import included, policy

ROOT = Path(__file__).resolve().parents[2]
INLINE_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")


def published_markdown() -> list[Path]:
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "*.md"], cwd=ROOT
    ).split(b"\0")
    rules = policy()
    return [
        ROOT / name.decode("utf-8")
        for name in names
        if name and included(name.decode("utf-8"), rules)
    ]


def local_target(raw: str) -> str | None:
    value = raw.strip()
    if value.startswith("<") and ">" in value:
        value = value[1 : value.index(">")]
    else:
        # An optional Markdown title follows whitespace. Repository filenames in
        # this project do not contain unescaped spaces.
        value = value.split(maxsplit=1)[0]
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    return unquote(parsed.path)


def broken_links() -> list[str]:
    failures: list[str] = []
    root = ROOT.resolve()
    rules = policy()
    for document in published_markdown():
        for line_number, line in enumerate(
            document.read_text(encoding="utf-8").splitlines(), 1
        ):
            for match in INLINE_LINK.finditer(line):
                target = local_target(match.group(1))
                if target is None:
                    continue
                candidate = (
                    root / target.lstrip("/")
                    if target.startswith("/")
                    else document.parent / target
                ).resolve()
                if root != candidate and root not in candidate.parents:
                    failures.append(
                        f"{document.relative_to(ROOT)}:{line_number}: outside repository: {target}"
                    )
                elif not candidate.exists():
                    failures.append(
                        f"{document.relative_to(ROOT)}:{line_number}: missing: {target}"
                    )
                else:
                    relative = candidate.relative_to(root).as_posix()
                    # A link that only works in the private source tree is broken
                    # in the exported repository even when its local target exists.
                    if not included(relative, rules):
                        failures.append(
                            f"{document.relative_to(ROOT)}:{line_number}: excluded from public tree: {target}"
                        )
    return failures


def main() -> None:
    failures = broken_links()
    if failures:
        raise SystemExit(
            "Broken repository-local Markdown links:\n" + "\n".join(failures)
        )
    print(
        f"Checked repository-local links in {len(published_markdown())} published Markdown files"
    )


if __name__ == "__main__":
    main()
