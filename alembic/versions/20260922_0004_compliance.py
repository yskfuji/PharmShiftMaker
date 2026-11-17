"""Add compliance ledgers and retention workflow; preserve existing data."""
from alembic import op
import sqlalchemy as sa
revision = "20260922_0004"
down_revision = "20260921_0003"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('compliance_entities',
        sa.Column('key', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('kind', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('entity_id', sa.String(length=128), primary_key=False, nullable=False),
        sa.Column('person_id', sa.String(length=64), primary_key=False, nullable=True),
        sa.Column('revision', sa.Integer(), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), primary_key=False, nullable=False),
        sa.UniqueConstraint('scope_id','kind','entity_id'),
    )
    op.create_index('ix_compliance_entities_scope_id', 'compliance_entities', ['scope_id'])
    op.create_table('compliance_revisions',
        sa.Column('key', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('entity_key', sa.String(length=64), sa.ForeignKey('compliance_entities.key'), primary_key=False, nullable=False),
        sa.Column('revision', sa.Integer(), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
        sa.Column('actor', sa.String(length=128), primary_key=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), primary_key=False, nullable=False),
        sa.UniqueConstraint('entity_key','revision'),
    )
    op.create_table('retention_rules',
        sa.Column('key', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('category', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('revision', sa.Integer(), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
    )
    op.create_table('legal_holds',
        sa.Column('hold_id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('person_id', sa.String(length=64), primary_key=False, nullable=True),
        sa.Column('active', sa.Boolean(), primary_key=False, nullable=False),
        sa.Column('revision', sa.Integer(), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
    )
    op.create_table('privacy_cases',
        sa.Column('case_id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('person_id', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('kind', sa.String(length=32), primary_key=False, nullable=False),
        sa.Column('status', sa.String(length=32), primary_key=False, nullable=False),
        sa.Column('revision', sa.Integer(), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
    )
    op.create_table('erasure_plans',
        sa.Column('plan_id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('fingerprint', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('payload', sa.JSON(), primary_key=False, nullable=False),
        sa.Column('status', sa.String(length=32), primary_key=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), primary_key=False, nullable=False),
    )
    op.create_table('erasure_markers',
        sa.Column('marker_id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('plan_id', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('scope_id', sa.String(length=256), primary_key=False, nullable=False),
        sa.Column('table_name', sa.String(length=128), primary_key=False, nullable=False),
        sa.Column('object_key', sa.String(length=384), primary_key=False, nullable=False),
        sa.Column('prior_hash', sa.String(length=64), primary_key=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), primary_key=False, nullable=False),
    )
    op.create_table('restore_gates',
        sa.Column('gate_id', sa.String(length=64), primary_key=True, nullable=False),
        sa.Column('state', sa.String(length=32), primary_key=False, nullable=False),
        sa.Column('marker_manifest_hash', sa.String(length=64), primary_key=False, nullable=True),
    )
    op.add_column("planning_jobs", sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column("planning_jobs", sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column("planning_jobs", sa.Column("stage_seconds", sa.JSON(), nullable=True))

def downgrade():
    raise RuntimeError("Preserve compliance records; restore into an isolated target instead")
