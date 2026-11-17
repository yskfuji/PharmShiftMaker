import ast

from shift_scheduler.application.storage_routes import (
    discover,
    inspect_routes,
    writer_call,
)


def test_write_modes_and_native_producers_are_not_mistaken_for_reads():
    for expression in [
        "p.write_bytes(data)",
        "open(path, 'ab')",
        "p.open('xb')",
        "p.open(mode=mode)",
        "os.open(path, os.O_WRONLY | os.O_CREAT)",
        "subprocess.run(command)",
    ]:
        assert writer_call(ast.parse(expression).body[0].value), expression
    for expression in [
        "p.open('rb')",
        "open(path, 'r')",
        "os.open(path, os.O_RDONLY | os.O_NOFOLLOW)",
    ]:
        assert not writer_call(ast.parse(expression).body[0].value), expression


def test_new_or_changed_producer_requires_review(tmp_path):
    src = tmp_path / "src/shift_scheduler"
    src.mkdir(parents=True)
    (tmp_path / "scripts").mkdir()
    p = src / "surprise.py"
    p.write_text("def output(path, data):\n    path.write_bytes(data)\n")
    found = discover(tmp_path)
    assert len(found) == 1
    report = inspect_routes(tmp_path)
    assert not report["reviewed"] and len(report["missing"]) == 1
    old_key = next(iter(found))
    p.write_text("def output(path, data):\n    path.write_bytes(data + b'new')\n")
    assert old_key not in discover(tmp_path)


def test_checked_in_inventory_is_current_but_does_not_claim_runtime_completion():
    report = inspect_routes()
    assert report["missing"] == [] and report["obsolete"] == []
    assert report["pending"] and not report["reviewed"]


def test_inventory_fingerprint_is_stable_across_worker_hash_seeds():
    import os
    import subprocess
    import sys

    command = [
        sys.executable,
        "-c",
        "from shift_scheduler.application.storage_routes import inspect_routes; from shift_scheduler.domain.planning import content_hash; print(content_hash(inspect_routes()))",
    ]
    results = [
        subprocess.check_output(
            command, env={**os.environ, "PYTHONHASHSEED": str(seed)}, text=True
        ).strip()
        for seed in (1, 2)
    ]
    assert results[0] == results[1]


def test_classification_separates_evaluation_from_unresolved_product_handlers():
    report = inspect_routes()
    assert report["classification_counts"]["ISOLATED_EVALUATION"] > 0
    assert report["classification_counts"]["PRODUCT_PERSONAL"] > 0
    for key in report["pending"]:
        assert report["routes"][key]["classification"] in {
            "PRODUCT_PERSONAL",
            "DELEGATED_PROGRAM",
        }
    for item in report["routes"].values():
        proof = item["classification_evidence"]
        assert proof["expression_hash"] == item["expression_hash"] and proof["reason"]
    assert not report["reviewed"]  # Classification never silently approves handlers.
