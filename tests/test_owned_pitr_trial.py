"""Explicitly opt-in physical PITR diagnostic, independent of application PG URL."""

import json
import os

import pytest
from scripts.owned_pitr_trial import run_trial


@pytest.mark.skipif(
    os.environ.get("PHARMSHIFT_TEST_OWNED_PITR") != "1",
    reason="owned Docker PITR opt-in required",
)
def test_physical_base_wal_target_and_missing_segment(tmp_path):
    result = run_trial(tmp_path / "evidence")
    assert result["status"] == "passed_limited_diagnostic"
    assert result["application_acceptance"] is False
    assert result["source_rows"] == "1|before-base\n2|recover-me\n3|after-target"
    assert result["restored_rows"] == "1|before-base\n2|recover-me"
    assert result["missing_wal_rejected"] is True
    assert result["durability"].splitlines() == ["on"] * 4
    assert json.loads((tmp_path / "evidence" / "result.json").read_text()) == result


def test_existing_evidence_is_not_overwritten(tmp_path):
    target = tmp_path / "existing"
    target.mkdir()
    marker = target / "original"
    marker.write_text("retained")
    with pytest.raises(FileExistsError):
        run_trial(target)
    assert marker.read_text() == "retained"
