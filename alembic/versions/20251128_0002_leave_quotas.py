"""Add leave quota table for annual PTO tracking."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251128_0002"
down_revision = "20251128_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leave_quotas",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=32), nullable=False),
        sa.Column("total_days", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["people.person_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("person_id", "year", "leave_type", name="uq_leave_quota_person_year_kind"),
    )


def downgrade() -> None:
    op.drop_table("leave_quotas")
