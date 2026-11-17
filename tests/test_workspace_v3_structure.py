from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


def test_workspace_shell_is_server_rendered_and_routes_use_it() -> None:
    shell = (
        ROOT / "frontend/src/features/workspace/shell/WorkspaceShell.tsx"
    ).read_text()
    layout = (ROOT / "frontend/src/app/workspace/layout.tsx").read_text()
    assert '"use client"' not in shell
    assert '"use client"' not in layout
    for page in (
        ROOT / "frontend/src/app/workspace/[screen]/page.tsx",
        ROOT / "frontend/src/app/workspace/[screen]/[view]/page.tsx",
    ):
        text = page.read_text()
        assert "WorkspaceShell" in text
        assert "IdealWorkspace" not in text


def test_next_type_declarations_never_capture_a_local_build_directory() -> None:
    declarations = (ROOT / "frontend/next-env.d.ts").read_text(encoding="utf-8")
    assert 'import "./.next/types/routes.d.ts";' in declarations
    assert 'import "./.next/types/root-params.d.ts";' in declarations
    assert "/private/" not in declarations
    assert "NEXT_DIST_DIR" not in declarations


def test_new_workspace_imports_no_legacy_business_components() -> None:
    files = list((ROOT / "frontend/src/features/workspace").rglob("*.tsx"))
    files += list((ROOT / "frontend/src/features/workspace").rglob("*.ts"))
    files += [ROOT / "frontend/src/ideal/screens/live/IntegratedFeatureView.tsx"]
    for path in files:
        text = path.read_text()
        imports = [
            line
            for line in text.splitlines()
            if "@/components/" in line
            and "@/components/ui/" not in line
            and '"@/components/ThemeToggle"' not in line
        ]
        assert imports == [], (path, imports)

    # Old routes keep stable import paths, but those files are wrappers only; the
    # implementation has one owner under features/workspace.
    moved = {
        "CopyManagement",
        "SubjectControlWorkflow",
        "ContractWorkflow",
        "GovernanceForms",
        "OutsideDeclarationForm",
        "LedgerHistory",
        "LeaveCorrections",
        "GrantAssessment",
        "ActualFileImport",
        "WorkflowNavigation",
        "MonthlySchedule",
        "PublicationExport",
        "FlexSettlementPanel",
    }
    for name in moved:
        wrapper = ROOT / f"frontend/src/components/{name}.tsx"
        assert wrapper.read_text().strip().splitlines()[0].startswith("export ")
        assert len(wrapper.read_text().strip().splitlines()) <= 2


def test_workspace_has_eight_domains_and_no_classic_navigation() -> None:
    expected = {
        "shell",
        "home",
        "schedule",
        "planning",
        "operations",
        "requests",
        "people",
        "governance",
        "settings",
        "shared",
    }
    root = ROOT / "frontend/src/features/workspace"
    present = {path.name for path in root.iterdir() if path.is_dir()}
    assert expected <= present
    assert (
        "従来の画面へ"
        not in (
            ROOT / "frontend/src/features/workspace/shell/WorkspaceShell.tsx"
        ).read_text()
    )
    assert present <= expected | {"generated", "showcase"}


def test_mobile_brand_keeps_an_accessible_name_when_visual_text_is_hidden() -> None:
    shell = (
        ROOT / "frontend/src/features/workspace/shell/WorkspaceShell.tsx"
    ).read_text()
    assert (
        'className="ideal-v3-brand" href={hrefFor("home")} aria-label="PharmShiftMaker 今日へ"'
        in shell
    )


def test_mobile_header_does_not_occlude_workspace_controls() -> None:
    css = (ROOT / "frontend/src/app/globals.css").read_text()
    mobile = css.rsplit("@media (max-width: 820px)", 1)[1].split(
        "@media (max-width: 520px)", 1
    )[0]
    header_rule = mobile.split(".ideal-v3-mobile-header {", 1)[1].split("}", 1)[0]
    assert "position: relative" in header_rule
    assert "position: sticky" not in header_rule
    assert "position: fixed" not in header_rule


def test_v3_package_requires_every_release_verification_gate() -> None:
    from devtools.ideal_ui.package_showcase import (
        REQUIRED_VERIFICATION_CHECKS,
        validate_verification,
    )

    manifest = {
        "source_commit": "a" * 40,
        "source_state_sha256": "different-until-mocked",
        "required_checks": dict.fromkeys(REQUIRED_VERIFICATION_CHECKS, "passed"),
    }
    with pytest.raises(SystemExit, match="source state"):
        validate_verification(manifest, "a" * 40)
    manifest["source_commit"] = "b" * 40
    with pytest.raises(SystemExit, match="current commit"):
        validate_verification(manifest, "a" * 40)


def test_v3_package_rejects_links_and_binds_scans_to_exact_artifacts(tmp_path) -> None:
    from devtools.ideal_ui.package_showcase import (
        REQUIRED_VERIFICATION_CHECKS,
        artifact_bundle_digest,
        digest,
        require_regular_file,
        safe_tree_inventory,
        validate_artifact_evidence,
    )

    tree = tmp_path / "artifact"
    tree.mkdir()
    (tree / "index.html").write_text("synthetic", encoding="utf-8")
    inventory = safe_tree_inventory(tree)
    inventories = {"storybook": inventory}
    bundle = artifact_bundle_digest(inventories)
    source = "a" * 64
    verification_assets = tmp_path / "verification"
    verification_assets.mkdir()
    for check in REQUIRED_VERIFICATION_CHECKS:
        (verification_assets / f"{check}.json").write_text(
            f'{{"check":"{check}","status":"passed"}}\n', encoding="utf-8"
        )
    manifest = {
        "source_state_sha256": source,
        "artifact_trees": inventories,
        "required_check_evidence": {
            check: {
                "source_state_sha256": source,
                "artifact_bundle_sha256": bundle,
                "path": f"{check}.json",
                "sha256": digest(verification_assets / f"{check}.json"),
            }
            for check in REQUIRED_VERIFICATION_CHECKS
        },
    }
    validate_artifact_evidence(manifest, inventories, verification_assets)
    manifest["required_check_evidence"]["secret_scan"][
        "artifact_bundle_sha256"
    ] = "wrong"
    with pytest.raises(SystemExit, match="exact package inputs"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    manifest["required_check_evidence"]["secret_scan"][
        "artifact_bundle_sha256"
    ] = bundle
    manifest["required_check_evidence"]["secret_scan"]["path"] = "../outside.txt"
    with pytest.raises(SystemExit, match="escapes"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    manifest["required_check_evidence"].pop("secret_scan")
    with pytest.raises(SystemExit, match="exactly cover"):
        validate_artifact_evidence(manifest, inventories, verification_assets)

    outside = tmp_path / "outside.txt"
    outside.write_text("must not be copied", encoding="utf-8")
    (tree / "linked.txt").symlink_to(outside)
    with pytest.raises(SystemExit, match="symbolic link"):
        safe_tree_inventory(tree)
    with pytest.raises(SystemExit, match="regular file"):
        require_regular_file(tree, "artifact manifest")
