"""Add display names, revisioned memberships and reviewed workflow cases."""

import sqlalchemy as sa
from alembic import op

revision = "20260930_0015"
down_revision = "20260923_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("planning_scopes", sa.Column("display_name", sa.String(256), nullable=True))
    op.add_column("account_memberships", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("account_memberships", sa.Column("evidence", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.add_column("account_memberships", sa.Column("created_by", sa.String(128), nullable=False, server_default="migration"))
    op.add_column("account_memberships", sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.add_column("account_memberships", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "planning_change_cases",
        sa.Column("case_id", sa.String(64), primary_key=True),
        sa.Column("scope_id", sa.String(256), sa.ForeignKey("planning_scopes.scope_id"), nullable=False),
        sa.Column("publication_id", sa.String(64), sa.ForeignKey("planning_publications.publication_id"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("affected_assignments", sa.JSON(), nullable=False),
        sa.Column("proposed_assignments", sa.JSON(), nullable=False),
        sa.Column("validation", sa.JSON(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_change_cases_scope_status", "planning_change_cases", ["scope_id", "status"])
    op.create_table(
        "planning_change_events",
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("case_id", sa.String(64), sa.ForeignKey("planning_change_cases.case_id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "staff_lifecycle_cases",
        sa.Column("case_id", sa.String(64), primary_key=True),
        sa.Column("scope_id", sa.String(256), sa.ForeignKey("planning_scopes.scope_id"), nullable=False),
        sa.Column("person_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("tasks", sa.JSON(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_lifecycle_scope_status", "staff_lifecycle_cases", ["scope_id", "status"])
    op.create_table(
        "staff_lifecycle_events",
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("case_id", sa.String(64), sa.ForeignKey("staff_lifecycle_cases.case_id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("task_key", sa.String(64), nullable=True),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    raise RuntimeError("Workflow provenance is immutable; rollback through an isolated restore")
