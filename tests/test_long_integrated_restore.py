"""Canonical callbacks on real PG; physical dump/restore is a separate trial."""

from scripts.long_integrated_restore import content, setup, verify


def test_restore_callbacks_recheck_same_25_month_canonical_data(pg, tmp_path):
    proof = setup(pg, tmp_path)
    assert proof["subjects"] == ["long-p0", "long-p1"]
    assert len(proof["monthly_expected"]) == 25
    before = content(pg)
    result = verify(pg, proof, "readback_before_physical_restore")
    assert len(result["historical_checks"]) == 50
    assert before == content(pg)
    assert result["business_receipt"]["key"] == proof["business_receipt"]["key"]
    assert not result["full_specified_combined_acceptance"]
