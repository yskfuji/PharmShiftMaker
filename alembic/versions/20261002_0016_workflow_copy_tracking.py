"""Track workflow cases and events in the database copy ledger.

The workflow tables were added after the original all-table trigger migration.
Attach the same fail-closed trigger without rewriting the historical migration,
and resolve event ownership through each event's physical case foreign key.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "20261002_0016"
down_revision = "20260930_0015"
branch_labels = None
depends_on = None

WORKFLOW_TABLES = (
    "planning_change_cases",
    "planning_change_events",
    "staff_lifecycle_cases",
    "staff_lifecycle_events",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    definition = bind.scalar(
        text("SELECT pg_get_functiondef('pharmshift_record_copy()'::regprocedure)")
    )
    anchor = (
        "IF parent_document IS NOT NULL THEN people_values := people_values || "
        "pharmshift_structured_people(parent_document); END IF;"
    )
    if not definition or definition.count(anchor) != 1:
        raise RuntimeError("Unrecognized copy trigger; do not infer workflow ownership")
    workflow_parent = """IF TG_TABLE_NAME='planning_change_events' THEN
 SELECT to_jsonb(c),c.scope_id INTO parent_document,parent_scope
 FROM planning_change_cases c WHERE c.case_id=document->>'case_id';
ELSIF TG_TABLE_NAME='staff_lifecycle_events' THEN
 SELECT to_jsonb(c),c.scope_id INTO parent_document,parent_scope
 FROM staff_lifecycle_cases c WHERE c.case_id=document->>'case_id';
END IF;
"""
    op.execute(definition.replace(anchor, workflow_parent + anchor))

    inspector = sa.inspect(bind)
    quote = bind.dialect.identifier_preparer.quote
    available = set(inspector.get_table_names())
    if not set(WORKFLOW_TABLES) <= available:
        raise RuntimeError(
            "Workflow copy tracking requires every reviewed workflow table"
        )
    for table_name in WORKFLOW_TABLES:
        keys = inspector.get_pk_constraint(table_name)["constrained_columns"]
        if not keys:
            raise RuntimeError(
                "Workflow copy tracking requires an explicit row identity"
            )
        arguments = ",".join("'" + key.replace("'", "''") + "'" for key in keys)
        op.execute(
            f"CREATE TRIGGER pharmshift_copy_write AFTER INSERT OR UPDATE OR DELETE "
            f"ON {quote(table_name)} FOR EACH ROW "
            f"EXECUTE FUNCTION pharmshift_record_copy({arguments})"
        )

    # Cases precede events so a historical event obtains scope and people from
    # its parent. The update changes no application value; the trigger records
    # the canonical hash. If an erased subject is found, the existing barrier
    # aborts the migration instead of silently certifying the old row.
    for table_name in WORKFLOW_TABLES:
        bind.execute(
            text(f"LOCK TABLE {quote(table_name)} IN SHARE ROW EXCLUSIVE MODE")
        )
    for table_name in WORKFLOW_TABLES:
        key = inspector.get_pk_constraint(table_name)["constrained_columns"][0]
        bind.execute(
            text(f"UPDATE {quote(table_name)} AS r " f"SET {quote(key)}=r.{quote(key)}")
        )


def downgrade() -> None:
    raise RuntimeError(
        "Workflow copy provenance and erasure barriers are immutable; restore only "
        "to an isolated target"
    )
