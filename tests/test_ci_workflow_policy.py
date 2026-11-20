from pathlib import Path

import yaml
from devtools.ci.workflow_policy import check_directory, check_workflow

SHA = "a" * 40
GOOD = {
    "on": {"pull_request": {}},
    "permissions": {"contents": "read"},
    "jobs": {
        "build": {
            "runs-on": "ubuntu-latest",
            "timeout-minutes": 10,
            "steps": [
                {
                    "uses": f"actions/checkout@{SHA}",
                    "with": {"persist-credentials": False},
                },
                {"run": "true"},
            ],
        }
    },
}


def _variant(**changes):
    document = yaml.safe_load(yaml.safe_dump(GOOD))
    for path, value in changes.items():
        target = document
        keys = path.split(".")
        for key in keys[:-1]:
            target = target[int(key)] if key.isdigit() else target[key]
        last = keys[-1]
        if value is None:
            if last.isdigit():
                target.pop(int(last))
            else:
                target.pop(last)
        else:
            target[int(last) if last.isdigit() else last] = value
    return document


def test_compliant_workflow_passes():
    assert check_workflow("ok.yml", GOOD) == []


def test_each_policy_violation_is_reported():
    cases = {
        "tag pin": _variant(**{"jobs.build.steps.0.uses": "actions/checkout@v7"}),
        "no timeout": _variant(**{"jobs.build.timeout-minutes": None}),
        "credentials": _variant(**{"jobs.build.steps.0.with": {}}),
        "write token": _variant(permissions={"contents": "write"}),
        "no permissions": _variant(permissions=None),
        "prt": _variant(on={"pull_request_target": {}}),
        "workflow_run": _variant(on={"workflow_run": {"workflows": ["CI"]}}),
    }
    for label, document in cases.items():
        assert check_workflow("x.yml", document), label


def test_the_bare_on_key_parsed_as_true_is_understood():
    document = yaml.safe_load(
        "on: pull_request_target\npermissions: {contents: read}\njobs: {}\n"
    )
    assert any("forbidden trigger" in p for p in check_workflow("x.yml", document))


def test_repository_workflows_comply():
    root = Path(__file__).resolve().parents[1]
    assert check_directory(root / ".github" / "workflows") == []
