import json
from pathlib import Path

from shift_scheduler.api.main import app

ROOT = Path(__file__).parents[1]


def test_all_27_ideal_use_cases_have_complete_traceability() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    rows = document["use_cases"]
    assert [row["id"] for row in rows] == [f"U{number:02d}" for number in range(1, 28)]
    assert len({row["e2e"] for row in rows}) == 27
    required = {
        "id",
        "title",
        "screen",
        "view",
        "roles",
        "route",
        "transitions",
        "storybook_id",
        "apis",
        "entities",
        "states",
        "audit_events",
        "e2e",
    }
    for row in rows:
        expected = required | {"deep_e2e"}
        assert set(row) == expected
        assert row["route"].startswith("/workspace/")
        assert row["screen"] == row["route"].split("/")[2]
        assert row["view"] == (
            row["route"].split("/")[3] if len(row["route"].split("/")) > 3 else "index"
        )
        assert row["transitions"] and all(
            route.startswith("/workspace/") for route in row["transitions"]
        )
        assert row["storybook_id"].startswith("ideal-ui-v3-")
        assert row["roles"] and row["apis"] and row["entities"] and row["states"]
        assert "ALL MUTATIONS" not in row["apis"]
        assert row["deep_e2e"].startswith("ideal-deep-")


def test_workspace_route_contract_is_the_runtime_source() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    routes = document["workspace_routes"]
    assert len(routes) == 25
    assert len({row["route"] for row in routes}) == 25
    assert {row["screen"] for row in routes} == {
        row["key"] for row in document["workspace_screens"]
    }
    by_route = {row["route"]: row for row in routes}
    for use_case in document["use_cases"]:
        assert use_case["route"] in by_route
        assert set(use_case["roles"]) <= set(by_route[use_case["route"]]["roles"])
    views = (ROOT / "frontend/src/ideal/views.ts").read_text()
    model = (ROOT / "frontend/src/ideal/api/toModel.ts").read_text()
    shell = (
        ROOT / "frontend/src/features/workspace/shell/WorkspaceShell.tsx"
    ).read_text()
    assert "WORKSPACE_ROUTES" in views
    assert 'key: "input"' not in views
    assert "WORKSPACE_NAV" in model
    assert "WORKSPACE_NAV" in shell
    assert "const API_NAV: Record" not in model


def test_named_ideal_contracts_and_routes_are_in_openapi() -> None:
    schema = app.openapi()
    names = {
        "ScheduleCalendarView",
        "DailyOperationsSnapshot",
        "ScheduleStabilitySummary",
        "DashboardSummary",
        "WorkspaceNotification",
        "ScheduleChangeApprovalResult",
        "LifecycleTaskState",
    }
    assert names <= set(schema["components"]["schemas"])
    for path in (
        "/planning/schedule-calendar",
        "/planning/daily-operations",
        "/planning/schedule-stability",
        "/planning/change-cases/{case_id}/recommend",
        "/planning/change-cases/{case_id}/approve",
        "/planning/change-cases/{case_id}/reject",
        "/planning/lifecycle-cases/{case_id}/tasks/{task_key}/attest",
    ):
        assert path in schema["paths"]


def test_every_declared_api_method_exists_in_openapi() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    paths = app.openapi()["paths"]
    for row in document["use_cases"]:
        for operation in row["apis"]:
            method, path = operation.split(" ", 1)
            assert path in paths, (row["id"], operation)
            assert method.lower() in paths[path], (row["id"], operation)


def test_every_declared_entity_has_a_storage_and_erasure_classification() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    inventory = json.loads(
        (
            ROOT / "src/shift_scheduler/application/copy_schema_inventory.json"
        ).read_text()
    )
    for row in document["use_cases"]:
        for entity in row["entities"]:
            assert entity in inventory, (row["id"], entity)
            policy = inventory[entity]
            assert policy["policy"]
            assert policy["purpose"]
            assert isinstance(policy["retention_required"], bool)


def test_every_route_and_e2e_id_is_referenced_by_the_implementation() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    e2e = (ROOT / "frontend/tests/remediation-e2e/ideal-usecases.spec.ts").read_text()
    deep_e2e = "\n".join(
        path.read_text()
        for path in sorted(
            (ROOT / "frontend/tests/remediation-e2e").glob("ideal-deep-u*-u*.spec.ts")
        )
    )
    assert "usecases.json" in e2e
    assert (ROOT / "frontend/src/app/workspace/[screen]/page.tsx").is_file()
    assert (ROOT / "frontend/src/app/workspace/[screen]/[view]/page.tsx").is_file()
    for row in document["use_cases"]:
        parts = row["route"].strip("/").split("/")
        assert parts[0] == "workspace"
        assert row["deep_e2e"] in deep_e2e


def test_all_25_child_routes_are_declared_as_use_case_routes_or_transitions() -> None:
    document = json.loads((ROOT / "docs/ideal-ui/usecases.json").read_text())
    declared = {row["route"] for row in document["use_cases"]}
    declared |= {route for row in document["use_cases"] for route in row["transitions"]}
    screens = {
        "plan": ["input", "generate", "compare", "drafts", "publications"],
        "operations": ["today", "cases"],
        "requests": ["mine", "leave", "swap", "outside"],
        "people": ["directory", "memberships", "lifecycle", "contracts"],
        "governance": ["audit", "actuals", "privacy", "recovery"],
        "settings": ["appearance", "notifications", "absence-consent", "flextime"],
    }
    expected = {"/workspace/home", "/workspace/schedule"}
    expected |= {
        f"/workspace/{screen}/{view}"
        for screen, views in screens.items()
        for view in views
    }
    assert len(expected) == 25
    assert expected <= declared
    assert {row["route"] for row in document["workspace_routes"]} == expected


def test_generated_use_case_sequences_are_current() -> None:
    from devtools.er.usecase_sequences import OUT, render

    assert OUT.read_text(encoding="utf-8") == render()


def test_generated_workspace_routes_and_transitions_are_current() -> None:
    from devtools.ideal_ui.generate_routes import outputs

    for path, expected in outputs().items():
        assert path.read_text(encoding="utf-8") == expected


def test_ideal_matrix_accepts_only_the_exact_three_engine_three_width_result(
    tmp_path,
) -> None:
    from scripts.run_ideal_usecase_matrix import exact_result

    name = "ideal-u01-auth-scope"
    specs = []
    for project in ("chromium", "firefox", "webkit"):
        for width in (320, 768, 1440):
            specs.append(
                {
                    "title": f"{name} {width}",
                    "tests": [
                        {
                            "projectName": project,
                            "status": "expected",
                            "results": [{"status": "passed", "retry": 0}],
                        }
                    ],
                }
            )
    report = {
        "stats": {"expected": 9, "skipped": 0, "unexpected": 0, "flaky": 0},
        "suites": [{"specs": specs}],
    }
    path = tmp_path / "results.json"
    path.write_text(json.dumps(report))
    assert exact_result(path, name)
    report["suites"][0]["specs"][-1]["tests"][0]["projectName"] = "chromium"
    path.write_text(json.dumps(report))
    assert not exact_result(path, name)


def test_deep_matrix_accepts_only_exact_u19_u27_results(tmp_path) -> None:
    from scripts.run_ideal_deep_matrix import exact_result, exact_single_result

    name = "ideal-deep-u19-leave"
    specs = []
    for project in ("chromium", "firefox", "webkit"):
        for width in (320, 768, 1440):
            specs.append(
                {
                    "title": f"{name} {width}",
                    "tests": [
                        {
                            "projectName": project,
                            "status": "expected",
                            "results": [{"status": "passed", "retry": 0}],
                        }
                    ],
                }
            )
    report = {
        "stats": {"expected": 9, "skipped": 0, "unexpected": 0, "flaky": 0},
        "suites": [{"specs": specs}],
    }
    path = tmp_path / "results.json"
    path.write_text(json.dumps(report))
    assert exact_result(path, name)
    report["stats"]["flaky"] = 1
    path.write_text(json.dumps(report))
    assert not exact_result(path, name)

    single = {
        "stats": {"expected": 1, "skipped": 0, "unexpected": 0, "flaky": 0},
        "suites": [
            {
                "specs": [
                    {
                        "title": f"{name} 320",
                        "tests": [
                            {
                                "projectName": "chromium",
                                "status": "expected",
                                "results": [{"status": "passed", "retry": 0}],
                            }
                        ],
                    }
                ]
            }
        ],
    }
    path.write_text(json.dumps(single))
    assert exact_single_result(path, f"{name} 320", "chromium")
    single["suites"][0]["specs"][0]["tests"][0]["results"][0]["retry"] = 1
    path.write_text(json.dumps(single))
    assert not exact_single_result(path, f"{name} 320", "chromium")
