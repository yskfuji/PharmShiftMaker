"""Separate partial history from usable solver inputs, with database copy tracking."""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0010"
down_revision = "20260923_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "preserved_archives",
        sa.Column("archive_id", sa.String(64), primary_key=True),
        sa.Column("scope_id", sa.String(256), nullable=False),
        sa.Column("source_digest", sa.String(64), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_preserved_archives_scope_id", "preserved_archives", ["scope_id"]
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "CREATE TRIGGER pharmshift_copy_write AFTER INSERT OR UPDATE OR DELETE ON preserved_archives FOR EACH ROW EXECUTE FUNCTION pharmshift_record_copy('archive_id')"
        )


def downgrade():
    raise RuntimeError(
        "Preserve replacement histories; restore only to an isolated target"
    )
