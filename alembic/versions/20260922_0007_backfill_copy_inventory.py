"""Register pre-trigger rows without changing their application values.

Only missing identities are touched. Existing reviewed inventory is preserved.
Unknown subjects/scopes/retention remain UNVERIFIED by the existing trigger.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260922_0007"
down_revision = "20260922_0006"
branch_labels = None
depends_on = None


def backfill(connection):
    if connection.dialect.name != "postgresql":
        return {}
    # Limit to tables carrying our tracking trigger in the current schema.
    tables = (
        connection.execute(
            sa.text("""
        SELECT c.relname FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND t.tgname='pharmshift_copy_write'
        ORDER BY c.relname
    """)
        )
        .scalars()
        .all()
    )
    inspect = sa.inspect(connection)
    quote = connection.dialect.identifier_preparer.quote
    counts = {}
    # Stable order and transaction-wide locks prevent racing an unregistered row.
    for name in tables:
        connection.execute(
            sa.text(f"LOCK TABLE {quote(name)} IN SHARE ROW EXCLUSIVE MODE")
        )
    for name in tables:
        other = connection.scalar(
            sa.text("""
            SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=current_schema() AND c.relname=:name
              AND NOT t.tgisinternal AND t.tgname <> 'pharmshift_copy_write'
        """),
            {"name": name},
        )
        if other:
            raise RuntimeError(
                f"Additional row triggers require a reviewed backfill: {name}"
            )
        keys = inspect.get_pk_constraint(name)["constrained_columns"]
        if not keys:
            raise RuntimeError("Copy backfill requires an explicit primary key")
        key_sql = ",".join(
            "'" + k.replace("'", "''") + "',to_jsonb(r." + quote(k) + ")" for k in keys
        )
        # Same identity expression as 0006; values never enter SQL identifiers.
        result = connection.execute(
            sa.text(f"""
            UPDATE {quote(name)} AS r SET {quote(keys[0])}=r.{quote(keys[0])}
            WHERE NOT EXISTS (
                SELECT 1 FROM managed_copies m WHERE m.copy_id =
                encode(sha256(convert_to(:name || ':' || jsonb_build_object({key_sql})::text,'UTF8')),'hex')
            )
        """),
            {"name": name},
        )
        counts[name] = result.rowcount
    return counts


def upgrade():
    backfill(op.get_bind())


def downgrade():
    raise RuntimeError(
        "Copy provenance must be retained; restore to an isolated target"
    )
