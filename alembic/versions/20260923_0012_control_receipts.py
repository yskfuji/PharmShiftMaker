"""Add receipts for the independent control authority; no existing row changes."""
from alembic import op
import sqlalchemy as sa

revision = "20260923_0012"
down_revision = "20260923_0011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("control_commits",
        sa.Column("operation_id", sa.String(64), primary_key=True),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("expected_generation", sa.Integer(), nullable=False),
        sa.Column("manifest_hash", sa.String(64), nullable=False),
        sa.Column("receipt_hash", sa.String(64), nullable=False))


def downgrade():
    raise RuntimeError("Preserve independent control receipts; use forward recovery")
