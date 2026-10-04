from scripts.remediation_schema import compare_server_default
from sqlalchemy import JSON, Column, Integer


def test_json_server_default_comparison_does_not_require_postgres_json_equality():
    column = Column("evidence", JSON())
    assert (
        compare_server_default(None, None, column, "'{}'::json", None, "'{}'") is False
    )
    assert (
        compare_server_default(None, None, column, "'{\"a\":1}'::json", None, "'{}'")
        is True
    )


def test_non_json_server_default_uses_alembic_native_comparison():
    assert (
        compare_server_default(
            None, None, Column("revision", Integer()), "1", None, "1"
        )
        is None
    )
