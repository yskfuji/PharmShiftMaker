"""Local sign-in accounts for the desktop profile (AUTH_MODE=local).

``local_accounts`` holds personal data (display names and the optional link to a
staff person) and ``local_account_events`` its append-only audit, so on
PostgreSQL both are attached to the same fail-closed copy-tracking trigger as
every other application table.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0017"
down_revision = "20261002_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "local_accounts",
        sa.Column("account_id", sa.String(64), primary_key=True),
        sa.Column("login_id", sa.String(64), nullable=False, unique=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("scope_id", sa.String(256), nullable=False),
        sa.Column("person_id", sa.String(64), nullable=True),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "local_account_events",
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("account_id", sa.String(64), nullable=False),
        sa.Column("scope_id", sa.String(256), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    exists = bind.scalar(
        sa.text("SELECT count(*) FROM pg_proc WHERE proname = 'pharmshift_record_copy'")
    )
    if not exists:
        raise RuntimeError(
            "Copy tracking function is missing; refuse an untracked table"
        )
    for table, key in (
        ("local_accounts", "account_id"),
        ("local_account_events", "event_id"),
    ):
        op.execute(
            "CREATE TRIGGER pharmshift_copy_write AFTER INSERT OR UPDATE OR DELETE "
            f"ON {table} FOR EACH ROW "
            f"EXECUTE FUNCTION pharmshift_record_copy('{key}')"
        )


def downgrade() -> None:
    raise RuntimeError(
        "Local accounts hold personal data under copy tracking; restore only to an "
        "isolated target instead of dropping the table"
    )
