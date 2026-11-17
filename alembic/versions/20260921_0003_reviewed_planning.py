"""Add immutable reviewed-planning storage; legacy tables remain untouched."""

from alembic import op
import sqlalchemy as sa

revision = "20260921_0003"
down_revision = "20251128_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_memberships",
        sa.Column(
            "membership_id", sa.String(length=64), primary_key=True, nullable=False
        ),
        sa.Column("issuer", sa.String(length=512), primary_key=False, nullable=False),
        sa.Column("subject", sa.String(length=256), primary_key=False, nullable=False),
        sa.Column("person_id", sa.String(length=64), primary_key=False, nullable=False),
        sa.Column("scope_id", sa.String(length=256), primary_key=False, nullable=False),
        sa.Column("role", sa.String(length=32), primary_key=False, nullable=False),
        sa.Column("active", sa.Boolean(), primary_key=False, nullable=False),
        sa.UniqueConstraint("issuer", "subject", "scope_id", name=None),
    )
    op.create_table(
        "actual_work_events",
        sa.Column("key", sa.String(length=256), primary_key=True, nullable=False),
        sa.Column("scope_id", sa.String(length=256), primary_key=False, nullable=False),
        sa.Column(
            "external_id", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column("revision", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
        sa.UniqueConstraint("scope_id", "external_id", "revision", name=None),
    )
    op.create_table(
        "planning_leave_balances",
        sa.Column("grant_id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column("person_id", sa.String(length=64), primary_key=False, nullable=False),
        sa.Column(
            "employer_id", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column("amount", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("consumed", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("reserved", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("revision", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
    )
    op.create_table(
        "planning_outbox",
        sa.Column("event_id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("kind", sa.String(length=64), primary_key=False, nullable=False),
        sa.Column("scope_id", sa.String(length=256), primary_key=False, nullable=False),
        sa.Column("actor", sa.String(length=128), primary_key=False, nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
        sa.Column(
            "delivered_at", sa.DateTime(timezone=True), primary_key=False, nullable=True
        ),
    )
    op.create_table(
        "planning_receipts",
        sa.Column(
            "receipt_id", sa.String(length=256), primary_key=True, nullable=False
        ),
        sa.Column(
            "fingerprint", sa.String(length=64), primary_key=False, nullable=False
        ),
        sa.Column("response", sa.JSON(), primary_key=False, nullable=False),
    )
    op.create_table(
        "planning_requests",
        sa.Column("request_id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("scope_id", sa.String(length=256), primary_key=False, nullable=False),
        sa.Column("person_id", sa.String(length=64), primary_key=False, nullable=False),
        sa.Column("version", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("kind", sa.String(length=32), primary_key=False, nullable=False),
        sa.Column("status", sa.String(length=32), primary_key=False, nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
        sa.Column("decision", sa.JSON(), primary_key=False, nullable=True),
    )
    op.create_table(
        "planning_scopes",
        sa.Column("source_fingerprint", sa.String(64), nullable=True),
        sa.Column("scope_id", sa.String(length=256), primary_key=True, nullable=False),
        sa.Column("input_revision", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("data_revision", sa.Integer(), nullable=False),
    )
    op.create_table(
        "revoked_sessions",
        sa.Column(
            "session_id", sa.String(length=128), primary_key=True, nullable=False
        ),
        sa.Column(
            "revoked_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
    )
    op.create_table(
        "planning_inputs",
        sa.Column("input_hash", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column(
            "scope_id",
            sa.String(length=256),
            sa.ForeignKey("planning_scopes.scope_id"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column("input_revision", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("data_revision", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
        sa.Column(
            "created_by", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
    )
    op.create_table(
        "planning_notification_reads",
        sa.Column("key", sa.String(length=256), primary_key=True, nullable=False),
        sa.Column(
            "event_id",
            sa.String(length=64),
            sa.ForeignKey("planning_outbox.event_id"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column("person_id", sa.String(length=64), primary_key=False, nullable=False),
        sa.Column(
            "read_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
    )
    op.create_table(
        "planning_drafts",
        sa.Column("draft_id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column(
            "input_hash",
            sa.String(length=64),
            sa.ForeignKey("planning_inputs.input_hash"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("proposal", sa.JSON(), primary_key=False, nullable=False),
        sa.Column("validation", sa.JSON(), primary_key=False, nullable=True),
        sa.Column(
            "reviewed_hash", sa.String(length=64), primary_key=False, nullable=True
        ),
        sa.Column(
            "reviewed_by", sa.String(length=128), primary_key=False, nullable=True
        ),
        sa.Column(
            "created_by", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column("status", sa.String(length=32), primary_key=False, nullable=False),
    )
    op.create_table(
        "planning_jobs",
        sa.Column("job_id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column(
            "input_hash",
            sa.String(length=64),
            sa.ForeignKey("planning_inputs.input_hash"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), primary_key=False, nullable=False),
        sa.Column(
            "requested_by", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column(
            "request_key", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column("budget_seconds", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("attempts", sa.Integer(), primary_key=False, nullable=False, server_default="0"),
        sa.Column(
            "lease_token", sa.String(length=64), primary_key=False, nullable=True
        ),
        sa.Column(
            "lease_until", sa.DateTime(timezone=True), primary_key=False, nullable=True
        ),
        sa.Column("result", sa.JSON(), primary_key=False, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
        sa.UniqueConstraint("request_key", name=None),
    )
    op.create_table(
        "planning_publications",
        sa.Column(
            "publication_id", sa.String(length=64), primary_key=True, nullable=False
        ),
        sa.Column(
            "draft_id",
            sa.String(length=64),
            sa.ForeignKey("planning_drafts.draft_id"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column(
            "scope_id",
            sa.String(length=256),
            sa.ForeignKey("planning_scopes.scope_id"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column(
            "period_key", sa.String(length=64), primary_key=False, nullable=False
        ),
        sa.Column("version", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("payload", sa.JSON(), primary_key=False, nullable=False),
        sa.Column(
            "published_by", sa.String(length=128), primary_key=False, nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
        sa.UniqueConstraint("scope_id", "period_key", "version", name=None),
        sa.UniqueConstraint("draft_id", name=None),
    )
    op.create_table(
        "planning_heads",
        sa.Column("key", sa.String(length=384), primary_key=True, nullable=False),
        sa.Column("version", sa.Integer(), primary_key=False, nullable=False),
        sa.Column(
            "publication_id",
            sa.String(length=64),
            sa.ForeignKey("planning_publications.publication_id"),
            primary_key=False,
            nullable=True,
        ),
    )
    op.create_table(
        "planning_leave_events",
        sa.Column("event_id", sa.String(length=128), primary_key=True, nullable=False),
        sa.Column(
            "grant_id",
            sa.String(length=128),
            sa.ForeignKey("planning_leave_balances.grant_id"),
            primary_key=False,
            nullable=False,
        ),
        sa.Column(
            "publication_id",
            sa.String(length=64),
            sa.ForeignKey("planning_publications.publication_id"),
            primary_key=False,
            nullable=True,
        ),
        sa.Column("kind", sa.String(length=32), primary_key=False, nullable=False),
        sa.Column("amount", sa.Integer(), primary_key=False, nullable=False),
        sa.Column("actor", sa.String(length=128), primary_key=False, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), primary_key=False, nullable=False
        ),
    )
    op.create_table(
        "planning_input_heads",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column(
            "scope_id",
            sa.String(256),
            sa.ForeignKey("planning_scopes.scope_id"),
            nullable=False,
        ),
        sa.Column(
            "input_hash",
            sa.String(64),
            sa.ForeignKey("planning_inputs.input_hash"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive downgrade disabled; preserve new records and restore separately"
    )
