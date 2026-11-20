from devtools.ci.risk_matrix import check


def test_every_risk_row_names_existing_tests():
    assert check() == []


def test_a_missing_or_renamed_test_is_reported(tmp_path):
    matrix = tmp_path / "matrix.md"
    matrix.write_text(
        "| R-01 | 認証 | x | `tests/test_ci_risk_matrix.py::test_does_not_exist` |\n"
        "| R-02 | 認証 | y | `tests/nope.py::test_x` |\n"
        "| R-03 | 認証 | z | なし |\n",
        encoding="utf-8",
    )
    problems = check(matrix)
    assert len(problems) == 3
