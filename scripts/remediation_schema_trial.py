"""Apply migrations in a new isolated schema, inspect it, then discard only that schema."""

import os
import sys
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from scripts.remediation_schema import export_schema
from sqlalchemy import create_engine, text


def main():
    url = os.environ["PHARMSHIFT_TEST_PG_URL"]
    if "pharmshift_audit" not in url:
        raise ValueError("An explicitly isolated audit DB is required")
    output = Path(sys.argv[1])
    if output.exists():
        raise ValueError("Existing evidence cannot be overwritten")
    schema = "audit_schema_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = url + "?options=-csearch_path%3D" + schema
    os.environ["DATABASE_URL"] = scoped
    os.environ["SHIFT_SCHEDULER_DB_URL"] = scoped
    engine = create_engine(scoped)
    try:
        command.upgrade(Config("alembic.ini"), "head")
        result = export_schema(engine, output)
        print(
            {
                "tables": len(result["tables"]),
                "orm_match": result["orm_match"],
                "differences": result["orm_differences"],
            }
        )
        if not result["orm_match"]:
            raise ValueError("Migrated database differs from ORM metadata")
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__ == "__main__":
    main()
