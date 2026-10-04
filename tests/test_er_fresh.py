"""The ER diagrams and the IA map in docs/architecture/er follow the code.

Regenerate with `PYTHONPATH=src:. python -m devtools.er.<physical|logical|ia_map|states> --write`.
The test only reads the stored files; it never writes them.
"""

from pathlib import Path

import pytest
from devtools.er import ia_map, logical, physical, states

OUT = Path(__file__).resolve().parents[1] / "docs" / "architecture" / "er"


@pytest.mark.parametrize(
    "generator",
    [physical, logical, ia_map, states],
    ids=["physical", "logical", "ia_map", "states"],
)
def test_stored_diagrams_are_current(generator):
    for name, text in generator.outputs().items():
        assert (OUT / name).read_text() == text, f"{name} is stale; regenerate it"


def test_every_physical_table_and_key_is_drawn():
    tables = physical.tables()
    text = physical.mermaid(tables)
    # 37 + the four ideal-workflow tables (planning_change_cases/events, staff_lifecycle_cases/events).
    assert len(tables) == 41
    for t in tables:
        assert f"    {t['name']} {{" in text
        for column, target, _ in t["foreign_keys"]:
            assert f"    {target} " in text and f"{t['name']} : \"{column}\"" in text


def test_every_reference_field_of_a_logical_kind_is_described():
    # logical.entities() refuses a *_id field that refs.toml does not describe.
    kinds = {e["kind"]: e for e in logical.entities()}
    assert kinds["flex_enrollment"]["links"] == [
        ("adoption_id", "flex_adoption"),
        ("person_id", "person"),
    ]
    assert kinds["flex_adoption"]["route"] == "2人確認の手続だけ"
    assert kinds["capability"]["key"] == "content_hash"
