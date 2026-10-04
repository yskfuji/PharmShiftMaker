"""Separate commit acknowledgement from the result's pre-commit preparation time."""
from alembic import op
import sqlalchemy as sa

revision = '20260923_0009'
down_revision = '20260923_0008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('planning_jobs', sa.Column('persisted_observed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    raise RuntimeError('Keep measurement evidence; use an isolated compatible reader for rollback')
