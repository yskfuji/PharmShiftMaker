"""Add managed copy ledger; no deletion or reinterpretation of existing data."""
from alembic import op
import sqlalchemy as sa
revision = '20260922_0005'
down_revision = '20260922_0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('managed_copies',
        sa.Column('copy_id',sa.String(64),primary_key=True),
        sa.Column('scope_id',sa.String(256),nullable=False),
        sa.Column('category',sa.String(64),nullable=False),
        sa.Column('medium',sa.String(32),nullable=False),
        sa.Column('locator',sa.JSON(),nullable=False),
        sa.Column('content_hash',sa.String(64),nullable=False),
        sa.Column('revision',sa.Integer(),nullable=False),
        sa.Column('state',sa.String(32),nullable=False),
        sa.Column('subject_status',sa.String(32),nullable=False),
        sa.Column('anchor',sa.String(32),nullable=False),
        sa.Column('anchor_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('evidence',sa.JSON(),nullable=False))
    op.create_index('ix_managed_copies_scope_id','managed_copies',['scope_id'])
    op.create_table('copy_subjects',
        sa.Column('copy_id',sa.String(64),sa.ForeignKey('managed_copies.copy_id'),primary_key=True),
        sa.Column('person_id',sa.String(64),primary_key=True))
    op.create_table('copy_erasures',
        sa.Column('plan_id',sa.String(64),primary_key=True),
        sa.Column('scope_id',sa.String(256),nullable=False),
        sa.Column('person_id',sa.String(64),nullable=False),
        sa.Column('fingerprint',sa.String(64),nullable=False),
        sa.Column('payload',sa.JSON(),nullable=False),
        sa.Column('state',sa.String(32),nullable=False),
        sa.Column('revision',sa.Integer(),nullable=False))


def downgrade():
    raise RuntimeError('Preserve erasure evidence; restore to an isolated target')
