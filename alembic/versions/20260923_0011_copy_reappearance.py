"""Track lawful row reappearance; retain the approved ERASED identity barrier."""

from alembic import op
from sqlalchemy import text

revision = "20260923_0011"
down_revision = "20260923_0010"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    definition = bind.scalar(
        text("SELECT pg_get_functiondef('pharmshift_record_copy()'::regprocedure)")
    )
    old = "IF FOUND AND existing_record.content_hash=copied_hash AND NOT is_removal THEN RETURN NEW; END IF;"
    if not definition or definition.count(old) != 1:
        raise RuntimeError("Unrecognized copy trigger; no inferred migration")
    new = "IF FOUND AND existing_record.state='PRESENT' AND existing_record.content_hash=copied_hash AND NOT is_removal THEN RETURN NEW; END IF;"
    op.execute(definition.replace(old, new))


def downgrade():
    raise RuntimeError("Preserve copy history; restore only into isolation")
