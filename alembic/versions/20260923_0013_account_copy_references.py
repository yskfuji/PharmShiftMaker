"""Track typed actor accounts as copy subjects, including inactive memberships."""
from alembic import op
from sqlalchemy import text

revision = "20260923_0013"
down_revision = "20260923_0012"
branch_labels = None
depends_on = None

SQL = r"""
CREATE FUNCTION pharmshift_actor_people(document jsonb, scope_value text) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE result text[] := ARRAY[]::text[]; pair record; element jsonb; matched text[];
BEGIN
 IF jsonb_typeof(document)='object' THEN
  FOR pair IN SELECT * FROM jsonb_each(document) LOOP
   IF pair.key IN ('actor','created_by','requested_by','reviewed_by','published_by','decided_by')
      AND jsonb_typeof(pair.value)='string' THEN
    SELECT ARRAY_AGG(DISTINCT m.person_id) INTO matched FROM account_memberships m
     WHERE m.subject=pair.value#>>'{}'
       AND (scope_value IS NULL OR scope_value='__unclassified__' OR m.scope_id=scope_value)
       AND (NOT document ? 'issuer' OR m.issuer=document->>'issuer');
    result := result || COALESCE(matched,ARRAY[]::text[]);
   ELSE
    result := result || pharmshift_actor_people(pair.value,scope_value);
   END IF;
  END LOOP;
 ELSIF jsonb_typeof(document)='array' THEN
  FOR element IN SELECT * FROM jsonb_array_elements(document) LOOP
   result := result || pharmshift_actor_people(element,scope_value);
  END LOOP;
 END IF;
 RETURN ARRAY(SELECT DISTINCT unnest(result));
END $$;
"""


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(SQL)
    definition = bind.scalar(text("SELECT pg_get_functiondef('pharmshift_record_copy()'::regprocedure)"))
    anchor = "scope_value := COALESCE(scope_value,parent_scope,'__unclassified__');"
    if not definition or definition.count(anchor) != 1:
        raise RuntimeError("Unrecognized copy trigger; do not infer a migration")
    op.execute(definition.replace(anchor, anchor + "\n people_values := people_values || pharmshift_actor_people(document,scope_value);"))
    # Existing payloads and their hashes stay unchanged. Backfill is a separate,
    # reviewed inventory operation: migrating a schema never certifies ownership.


def downgrade():
    raise RuntimeError("Retain copy provenance; rollback through isolated restore only")
