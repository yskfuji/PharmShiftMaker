"""Inspect the migrated PostgreSQL catalogue, including constraints absent from ER notation."""

import argparse
import json
import re
from pathlib import Path

from sqlalchemy import JSON, create_engine, inspect

from shift_scheduler.domain.planning import content_hash


def compare_server_default(
    _context,
    _inspected_column,
    metadata_column,
    inspected_default,
    _metadata_default,
    rendered_metadata_default,
):
    """Compare JSON defaults without asking PostgreSQL to apply ``=`` to JSON.

    PostgreSQL has no equality operator for ``json`` (as opposed to ``jsonb``).
    Alembic's default comparator otherwise emits ``SELECT <json> = <json>`` and
    aborts the schema audit. Other types keep Alembic's native comparison.
    """
    if not isinstance(metadata_column.type, JSON):
        return None

    def canonical(value):
        text_value = re.sub(r"\s+", "", str(value or "")).lower()
        text_value = re.sub(r"::jsonb?$", "", text_value)
        while text_value.startswith("(") and text_value.endswith(")"):
            text_value = text_value[1:-1]
        return text_value.strip("'")

    return canonical(inspected_default) != canonical(rendered_metadata_default)


def export_schema(engine, target, metadata=None):
    inspector = inspect(engine)
    tables = {}
    for name in sorted(inspector.get_table_names()):
        tables[name] = {
            "columns": [
                {
                    "name": c["name"],
                    "type": str(c["type"]),
                    "nullable": c["nullable"],
                    "default": c.get("default"),
                }
                for c in inspector.get_columns(name)
            ],
            "primary_key": inspector.get_pk_constraint(name),
            "foreign_keys": inspector.get_foreign_keys(name),
            "unique": inspector.get_unique_constraints(name),
            "checks": inspector.get_check_constraints(name),
            "indexes": inspector.get_indexes(name),
        }
    target.mkdir(parents=True, exist_ok=True)
    document = {
        "dialect": engine.dialect.name,
        "schema_hash": content_hash(tables),
        "tables": tables,
    }
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from shift_scheduler.db.base import Base

    metadata = Base.metadata if metadata is None else metadata
    with engine.connect() as connection:
        differences = compare_metadata(
            MigrationContext.configure(
                connection,
                opts={
                    "compare_type": True,
                    "compare_server_default": compare_server_default,
                },
            ),
            metadata,
        )
    document["orm_differences"] = [str(difference) for difference in differences]
    document["orm_match"] = not differences
    (target / "physical-schema.json").write_text(
        json.dumps(document, ensure_ascii=False, indent=2, default=str)
    )
    er = ["erDiagram"]
    for name, table in tables.items():
        er.append(f"    {name} {{")
        fk_columns = {
            c for fk in table["foreign_keys"] for c in fk["constrained_columns"]
        }
        for column in table["columns"]:
            flag = (
                " PK"
                if column["name"] in table["primary_key"]["constrained_columns"]
                else " FK" if column["name"] in fk_columns else ""
            )
            # Full SQL types and all composite constraints are retained in JSON.
            kind = "json" if "JSON" in column["type"] else "value"
            er.append(f'        {kind} {column["name"]}{flag}')
        er.append("    }")
        for fk in table["foreign_keys"]:
            optional = any(
                c["nullable"]
                for c in table["columns"]
                if c["name"] in fk["constrained_columns"]
            )
            cardinality = "|o" if optional else "||"
            er.append(
                f'    {fk["referred_table"]} {cardinality}--o{{ {name} : "FK {",".join(fk["constrained_columns"])}"'
            )
    (target / "physical-after.mmd").write_text("\n".join(er) + "\n")
    return document


def main():
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    if "pharmshift_audit" not in url:
        raise ValueError("Explicit isolated audit database required")
    target = Path(args.output)
    if target.exists():
        raise ValueError("Do not overwrite prior schema evidence")
    engine = create_engine(url)
    try:
        result = export_schema(engine, target)
        print(
            json.dumps(
                {"tables": len(result["tables"]), "schema_hash": result["schema_hash"]}
            )
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
