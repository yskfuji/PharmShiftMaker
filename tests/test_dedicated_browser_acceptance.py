"""Pure runner tests: no server, browser, schema or application data touched."""

import os

import pytest
from scripts.dedicated_browser_acceptance import (
    FIXTURES,
    classify_result,
    clean_environment,
    flatten,
    validate_pg,
)


def case_report(status="passed", width="320"):
    return {
        "suites": [
            {
                "file": "x.spec.ts",
                "specs": [
                    {
                        "file": "x.spec.ts",
                        "line": 7,
                        "title": "workflow " + width,
                        "tests": [
                            {
                                "projectName": "chromium-linux",
                                "expectedStatus": "passed",
                                "results": [{"status": status}],
                            }
                        ],
                    }
                ],
            }
        ]
    }


def test_environment_removes_stale_fixture_and_control_settings(tmp_path, monkeypatch):
    import scripts.dedicated_browser_acceptance as runner

    monkeypatch.setattr(runner, "ARTIFACTS_ROOT", tmp_path)
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    env = clean_environment(
        {
            "PATH": "/usr/bin",
            "PHARMSHIFT_E2E_ACTUAL": "1",
            "PHARMSHIFT_E2E_GRANT_SERIES": "1",
            "PHARMSHIFT_CONTROL_URL": "http://wrong",
            "DATABASE_URL": "private",
            "AUTH_MODE": "production",
            "E2E_RUN": "old",
            "PW_TEST_CONNECT_WS_ENDPOINT": "remote",
            "E2E_RUNTIME_SITE_PACKAGES": str(runtime),
        },
        FIXTURES["grant-series.spec.ts"],
    )
    assert env["PATH"] == "/usr/bin"
    assert env["PHARMSHIFT_E2E_GRANT_SERIES"] == "1"
    assert env["PYTHONPATH"].split(os.pathsep)[0] == str(runtime.resolve())
    assert (
        not {
            "PHARMSHIFT_E2E_ACTUAL",
            "PHARMSHIFT_CONTROL_URL",
            "DATABASE_URL",
            "AUTH_MODE",
            "E2E_RUN",
            "PW_TEST_CONNECT_WS_ENDPOINT",
        }
        & env.keys()
    )


def test_environment_rejects_runtime_dependency_path_outside_artifacts(
    tmp_path, monkeypatch
):
    import scripts.dedicated_browser_acceptance as runner

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    monkeypatch.setattr(runner, "ARTIFACTS_ROOT", allowed)
    with pytest.raises(ValueError, match="E2E_RUNTIME_SITE_PACKAGES"):
        clean_environment({"E2E_RUNTIME_SITE_PACKAGES": str(tmp_path)})


def test_enumeration_preserves_actual_count_and_absent_width():
    report = case_report(width="without-width")
    cases = flatten(report)
    assert len(cases) == 1 and cases[0]["declared_width"] is None
    assert classify_result(report, cases[0])[0] == "PASSED"


@pytest.mark.parametrize("status", ["failed", "skipped", "timedOut", "interrupted"])
def test_failure_never_converted_to_success(status):
    report = case_report(status)
    assert classify_result(report, flatten(report)[0])[0] == "FAILED"


def test_identity_mismatch_duplicate_and_retry_rejected():
    report = case_report()
    case = flatten(report)[0]
    case["title"] = "different"
    assert classify_result(report, case)[0] == "FAILED"
    report = case_report()
    case = flatten(report)[0]
    report["suites"][0]["specs"][0]["tests"][0]["results"].append({"status": "passed"})
    assert classify_result(report, case)[0] == "FAILED"
    report = case_report()
    case = flatten(report)[0]
    report["suites"].append(report["suites"][0])
    assert classify_result(report, case)[0] == "FAILED"


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///real.db",
        "postgresql://x@127.0.0.1:5432/pharmshift_audit",
        "postgresql://x@example.org:55443/pharmshift_audit",
        "postgresql://x@127.0.0.1:55443/production",
        "postgresql://x@127.0.0.1:55443/pharmshift_audit?options=x",
    ],
)
def test_refuses_unowned_database(url):
    with pytest.raises(ValueError):
        validate_pg(url)


def test_pg_manifest_does_not_contain_password():
    assert validate_pg(
        "postgresql://audit:secret@127.0.0.1:55443/pharmshift_audit_remediation"
    ) == {
        "host": "127.0.0.1",
        "port": 55443,
        "database": "pharmshift_audit_remediation",
    }


def test_selected_specs_are_explicit_and_not_full_enumeration():
    from scripts.dedicated_browser_acceptance import select_cases

    cases = [{"file": "a.spec.ts"}, {"file": "b.spec.ts"}]
    assert select_cases(cases, ["a.spec.ts"]) == [cases[0]]
    assert select_cases(cases, None) == cases
    with pytest.raises(ValueError):
        select_cases(cases, ["missing.spec.ts"])


@pytest.mark.parametrize(
    ("environ", "expected"),
    [
        ({}, False),
        ({"PHARMSHIFT_E2E_FLEX": "1"}, False),
        ({"PHARMSHIFT_E2E_DEEP": "1"}, False),
        (
            {"PHARMSHIFT_E2E_FLEX": "1", "PHARMSHIFT_E2E_DEEP": "1"},
            True,
        ),
    ],
)
def test_historical_flex_seed_is_deep_u22_only(environ, expected):
    from scripts.remediation_test_server import seed_historical_flex_adoptions

    assert seed_historical_flex_adoptions(environ) is expected


def test_freeze_detects_add_change_remove_and_build_metadata(tmp_path, monkeypatch):
    import scripts.dedicated_browser_acceptance as runner

    root = tmp_path / "repository"
    front = root / "frontend"
    build = front / ".next-test"
    for path in (
        root / "src",
        root / "scripts",
        root / "certs",
        front / "src",
        front / "tests/remediation-e2e",
        build / "static/test-build",
    ):
        path.mkdir(parents=True)
    (root / "certs/dev-rootCA.pem").write_text("synthetic public CA")
    (root / "requirements-test.lock").write_text("package==1")
    (root / "src/a.py").write_text("old")
    (front / "src/a.ts").write_text("old")
    (front / "package-lock.json").write_text("{}")
    (build / "BUILD_ID").write_text("test-build")
    (build / "build-manifest.json").write_text("{}")
    (build / "static/test-build/_buildManifest.js").write_text("manifest")
    monkeypatch.setattr(runner, "ROOT", root)
    monkeypatch.setattr(runner, "FRONTEND", front)
    before = runner.freeze_files(build)
    assert "requirements-test.lock" in before
    assert "runtime/ca-certificate.pem" in before
    (root / "src/a.py").write_text("new")
    (front / "src/a.ts").unlink()
    (root / "src/b.py").write_text("added")
    (build / "build-manifest.json").write_text('{"changed":true}')
    changes = runner.hash_differences(before, runner.freeze_files(build))
    assert {v["path"] for v in changes} == {
        "src/a.py",
        "src/b.py",
        "frontend/src/a.ts",
        "frontend/.next-test/build-manifest.json",
    }


def test_running_build_bytes_must_match_local_artifact(tmp_path, monkeypatch):
    import scripts.dedicated_browser_acceptance as runner

    root = tmp_path
    build = root / "frontend/.next-test"
    (build / "static/abc").mkdir(parents=True)
    (build / "BUILD_ID").write_text("abc")
    (build / "static/abc/_buildManifest.js").write_bytes(b"expected")
    ca_cert = root / "external-ca.pem"
    ca_cert.write_text("synthetic public CA")
    monkeypatch.setattr(runner, "ROOT", root)
    observed_context = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self):
            return b"different"

    def create_default_context(**kwargs):
        observed_context.update(kwargs)
        return object()

    monkeypatch.setattr(runner.ssl, "create_default_context", create_default_context)
    monkeypatch.setattr(runner, "urlopen", lambda *args, **kwargs: Response())
    with pytest.raises(RuntimeError, match="differs"):
        runner.verify_served_build(build, ca_cert)
    assert observed_context["cafile"] == str(ca_cert)


def test_runtime_drift_uses_the_selected_ca_for_both_checks(monkeypatch, tmp_path):
    import scripts.dedicated_browser_acceptance as runner

    ca_cert = tmp_path / "selected-ca.pem"
    ca_cert.write_text("synthetic public CA")
    observed = []
    monkeypatch.setattr(
        runner,
        "freeze_files",
        lambda build, ca: observed.append(("freeze", build, ca)) or {"source": "same"},
    )
    monkeypatch.setattr(
        runner,
        "verify_served_build",
        lambda build, ca: observed.append(("serve", build, ca)) or {"build": "same"},
    )

    assert (
        runner.runtime_drift(
            tmp_path / "build", ca_cert, {"source": "same"}, {"build": "same"}
        )
        == []
    )
    assert observed == [
        ("freeze", tmp_path / "build", ca_cert),
        ("serve", tmp_path / "build", ca_cert),
    ]


def test_reject_hard_coded_test_api_path(tmp_path):
    import pytest
    from scripts.dedicated_browser_acceptance import verify_test_api_targets

    path = tmp_path / "case.ts"
    path.write_text("fetch('https://127.0.0.1:18510/planning/inputs')")
    with pytest.raises(ValueError, match="Hard-coded"):
        verify_test_api_targets(tmp_path)
    path.write_text("fetch(API + '/planning/inputs')")
    verify_test_api_targets(tmp_path)


def test_ideal_ui_flags_are_never_inherited_from_the_shell():
    env = clean_environment(
        {
            "PATH": "/usr/bin",
            "IDEAL_UI": "1",
            "IDEAL_PREVIEW": "1",
            "IDEAL_SHOWCASE": "1",
        },
        FIXTURES["ideal-workspace.spec.ts"],
    )
    assert not {"IDEAL_UI", "IDEAL_PREVIEW", "IDEAL_SHOWCASE"} & env.keys()
    assert env["PHARMSHIFT_E2E_PUBLICATION"] == "1"
