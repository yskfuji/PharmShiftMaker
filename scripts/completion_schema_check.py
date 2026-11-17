"""Read-only verification of deployed physical columns and foreign keys."""

import json
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect

from shift_scheduler.db import models  # noqa: F401
from shift_scheduler.db.base import Base


def main():
    url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    if "pharmshift_audit" not in url:
        raise RuntimeError("Explicit audit database required")
    engine = create_engine(url)
    observed = inspect(engine)
    differences = []
    for table in Base.metadata.sorted_tables:
        if table.name not in observed.get_table_names():
            differences.append([table.name, "missing table"])
            continue
        actual = {c["name"]: c for c in observed.get_columns(table.name)}
        if set(actual) != set(table.columns.keys()):
            differences.append([table.name, "column set differs"])
        for c in table.columns:
            if c.name in actual and actual[c.name]["nullable"] != c.nullable:
                differences.append([table.name, c.name, "nullable differs"])
        expected_fk = {
            (fk.parent.name, fk.target_fullname) for fk in table.foreign_keys
        }
        actual_fk = {
            (column, f"{fk['referred_table']}.{target}")
            for fk in observed.get_foreign_keys(table.name)
            for column, target in zip(
                fk["constrained_columns"], fk["referred_columns"], strict=True
            )
        }
        if expected_fk != actual_fk:
            differences.append([table.name, "foreign keys differ"])
    Path("audit/completion-2026-09-22/physical-schema-check.json").write_text(
        json.dumps(
            {
                "tables_checked": len(Base.metadata.tables),
                "differences": differences,
                "scope": "column names/nullability/foreign keys only; type/check/index equivalence requires further inspection",
            },
            indent=2,
        )
    )
    engine.dispose()
    if differences:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
