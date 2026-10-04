from pathlib import Path

import yaml
from devtools.release.public_tree import included, policy

ROOT = Path(__file__).parents[1]


def test_checked_in_sbom_is_current() -> None:
    from devtools.release.generate_sbom import OUTPUT, render

    assert OUTPUT.read_text(encoding="utf-8") == render()


def test_checked_in_third_party_license_bundle_is_current() -> None:
    from devtools.release.collect_licenses import validate_current

    assert validate_current() == []


def test_public_tree_excludes_private_work_history_and_keeps_release_sources() -> None:
    rules = policy()
    for path in (
        "CHAT_HISTORY.md",
        "ARCHITECTURE.md",
        "audit/run/results.json",
        ".agents/skills/private/SKILL.md",
        "docs/HANDOFF_CLAUDE_CODE_2026-09-23.md",
        "frontend/node_modules",
        "ops/kubernetes/pharmshift-api.yaml",
        "ops/operations.md",
        "ops/reviewed-planning.md",
        "ops/runbook.md",
        "ops/security_and_dr.md",
        "ops/systemd/pharmshift-api.service",
        "ops/upgrade.md",
        "ops/ux_research.md",
        "shift_arch_manifest.yaml",
    ):
        assert not included(path, rules)
    for path in (
        "LICENSE",
        "README.md",
        "src/shift_scheduler/api/main.py",
        "frontend/src/app/layout.tsx",
        "frontend/tests/visual/__screenshots__/chromium-linux/example.png",
        "docs/ideal-ui/verification.md",
    ):
        assert included(path, rules)


def test_public_tree_policy_has_release_documents_and_size_limit() -> None:
    rules = policy()
    required = set(rules["required"])
    assert {
        "LICENSE",
        "SECURITY.md",
        "PRIVACY.md",
        "THIRD_PARTY_NOTICES.md",
        "TRADEMARKS.md",
        "docs/legal/development-provenance.md",
        "docs/release/THIRD_PARTY_LICENSES/manifest.json",
    } <= required
    assert rules["maximum_file_bytes"] == 50_000_000


def test_published_markdown_cannot_link_to_excluded_source() -> None:
    from devtools.release.check_markdown_links import broken_links

    failures = broken_links()
    assert not any("excluded from public tree" in item for item in failures), failures


def test_public_sample_staff_are_explicitly_synthetic() -> None:
    config = ROOT / "src/shift_scheduler/config"
    people = yaml.safe_load((config / "staff_people.yaml").read_text(encoding="utf-8"))[
        "people"
    ]
    person_ids = {person["person_id"] for person in people}
    assert len(person_ids) == len(people) == 21
    assert all(person_id.startswith("synthetic-") for person_id in person_ids)
    assert all(person["name"].startswith("合成") for person in people)

    referenced: set[str] = set()
    for filename, key in (
        ("staff_timeline.yaml", "timeline"),
        ("staff_leave_quotas.yaml", "leave_quotas"),
        ("holiday_requests_2025_02.yaml", "requests"),
        ("holiday_requests_2025_11.yaml", "requests"),
    ):
        rows = yaml.safe_load((config / filename).read_text(encoding="utf-8"))[key]
        referenced.update(row["person_id"] for row in rows)
    assert referenced <= person_ids

    mapping = yaml.safe_load(
        (ROOT / "ops/attendance_mapping.example.yaml").read_text(encoding="utf-8")
    )
    assert set(mapping["people"]) <= person_ids
    assert all(
        person["person_name"].startswith("合成")
        for person in mapping["people"].values()
    )

    demo = ROOT / "ops/demo_config"
    demo_people = yaml.safe_load(
        (demo / "staff_people.yaml").read_text(encoding="utf-8")
    )["people"]
    demo_ids = {person["person_id"] for person in demo_people}
    assert all(person_id.startswith("demo-") for person_id in demo_ids)
    assert all(person["name"].startswith("合成") for person in demo_people)
    demo_timeline = yaml.safe_load(
        (demo / "staff_timeline.yaml").read_text(encoding="utf-8")
    )["timeline"]
    assert {row["person_id"] for row in demo_timeline} <= demo_ids


def test_showcase_package_has_an_explicit_document_allowlist_and_canonical_sbom() -> (
    None
):
    from devtools.ideal_ui.package_showcase import (
        CANONICAL_SBOM,
        PACKAGE_IDEAL_UI_FILES,
    )
    from devtools.release.public_tree import policy

    excluded = {
        Path(item).relative_to("docs/ideal-ui").as_posix()
        for item in policy()["excluded_ideal_ui_documents"]
    }
    assert excluded.isdisjoint(PACKAGE_IDEAL_UI_FILES)
    assert Path(__file__).parents[1] / "docs/release/SBOM.cdx.json" == CANONICAL_SBOM
