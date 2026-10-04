from scripts.benchmark_manifest import build_manifest


def test_manifest_freezes_frontend_and_threads_without_claiming_resource_acceptance(
    tmp_path,
):
    (tmp_path / "frontend").mkdir()
    p = tmp_path / "frontend" / "package-lock.json"
    p.write_text("{}")
    a = build_manifest(tmp_path, configuration={}, workload={}, search_threads=1)
    p.write_text('{"version":2}')
    b = build_manifest(tmp_path, configuration={}, workload={}, search_threads=1)
    assert a["manifest_hash"] != b["manifest_hash"]
    assert (
        not a["acceptance_ready"]
        and "resources_evidence_missing" in a["missing_evidence"]
    )
    assert (
        b["manifest_hash"]
        != build_manifest(tmp_path, configuration={}, workload={}, search_threads=2)[
            "manifest_hash"
        ]
    )
