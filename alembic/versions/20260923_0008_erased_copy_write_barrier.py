"""Reject recreation of an approved erased database identity, including raw SQL."""
from alembic import op
from sqlalchemy import text

revision = '20260923_0008'
down_revision = '20260922_0007'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return
    definition = bind.scalar(text("SELECT pg_get_functiondef('pharmshift_record_copy()'::regprocedure)"))
    anchor = ' IF FOUND AND existing_record.content_hash=copied_hash AND NOT is_removal THEN RETURN NEW; END IF;'
    if not definition or definition.count(anchor) != 1:
        raise RuntimeError('Copy trigger differs from the reviewed migration; no automatic replacement')
    barrier = """ IF existing_record.state='ERASED' AND NOT is_removal THEN
  RAISE EXCEPTION 'Approved copy erasure prevents identity recreation' USING ERRCODE='23514';
 END IF;
"""
    op.execute(definition.replace(anchor, barrier + anchor))


def downgrade():
    raise RuntimeError('Preserve erasure write barriers; restore to an isolated target')
