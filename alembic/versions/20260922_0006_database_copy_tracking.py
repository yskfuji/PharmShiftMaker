"""Track every operational database row; reject reintroduction of erased subjects.

PostgreSQL is the production authority. SQLite remains a development-only adapter.
Unclassified legacy subjects are not guessed or silently certified complete.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260922_0006"
down_revision = "20260922_0005"
branch_labels = None
depends_on = None

# Metadata/control records have their own retained purpose and must be shown as
# residual control data, never treated as anonymised or as physically erased.
CONTROL = {
    "alembic_version",
    "managed_copies",
    "copy_subjects",
    "copy_erasures",
    "erasure_markers",
    "erasure_plans",
    "restore_gates",
    "retention_rules",
    "legal_holds",
    "erased_subjects",
    "planning_scopes",
}

SQL = r"""
CREATE FUNCTION pharmshift_structured_people(document jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text[] := ARRAY[]::text[]; pair record; element jsonb;
BEGIN
 IF jsonb_typeof(document) = 'object' THEN
  FOR pair IN SELECT * FROM jsonb_each(document) LOOP
   IF pair.key = 'person_id' AND jsonb_typeof(pair.value) = 'string' THEN
    result := array_append(result, pair.value #>> '{}');
   ELSIF pair.key = 'person_ids' AND jsonb_typeof(pair.value) = 'array' THEN
    FOR element IN SELECT * FROM jsonb_array_elements(pair.value) LOOP
     IF jsonb_typeof(element) = 'string' THEN result := array_append(result, element #>> '{}'); END IF;
    END LOOP;
   ELSE
    result := result || pharmshift_structured_people(pair.value);
   END IF;
  END LOOP;
 ELSIF jsonb_typeof(document) = 'array' THEN
  FOR element IN SELECT * FROM jsonb_array_elements(document) LOOP
   result := result || pharmshift_structured_people(element);
  END LOOP;
 END IF;
 RETURN ARRAY(SELECT DISTINCT unnest(result));
END $$;

CREATE FUNCTION pharmshift_record_copy() RETURNS trigger LANGUAGE plpgsql
SET timezone='UTC' AS $$
DECLARE document jsonb; row_key jsonb := '{}'::jsonb; column_name text; identity text;
 scope_value text; category_value text; people_values text[]; parent_document jsonb;
 parent_scope text; existing_record record; location jsonb; copied_hash text; person text;
 current_time_value timestamptz := clock_timestamp(); anchor_value timestamptz;
 anchor_kind text := 'last_activity'; is_removal boolean := TG_OP = 'DELETE';
BEGIN
 document := CASE WHEN is_removal THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 FOREACH column_name IN ARRAY TG_ARGV LOOP
  row_key := row_key || jsonb_build_object(column_name, document -> column_name);
 END LOOP;
 location := jsonb_build_object('table',TG_TABLE_NAME,'pk',row_key,'hash_scheme','postgres-jsonb-sha256-v1');
 IF (TG_TABLE_NAME='planning_outbox' AND (document->>'kind' LIKE 'copy.%' OR document->>'kind' LIKE 'erasure.%'))
    OR (TG_TABLE_NAME='planning_receipts' AND EXISTS(SELECT 1 FROM copy_erasures e WHERE e.plan_id=document#>>'{response,plan_id}')) THEN
  location := location || jsonb_build_object('retained_control',true);
 END IF;
 identity := encode(sha256(convert_to(TG_TABLE_NAME || ':' || row_key::text,'UTF8')),'hex');
 copied_hash := encode(sha256(convert_to(document::text,'UTF8')),'hex');
 scope_value := document ->> 'scope_id';
 people_values := pharmshift_structured_people(document);

 -- These are typed relationships, not a substring search through free text.
 IF document ? 'input_hash' AND TG_TABLE_NAME <> 'planning_inputs' THEN
  SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope FROM planning_inputs p WHERE p.input_hash=document->>'input_hash';
 ELSIF document ? 'draft_id' AND TG_TABLE_NAME <> 'planning_drafts' THEN
  SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope FROM planning_drafts d JOIN planning_inputs p ON p.input_hash=d.input_hash WHERE d.draft_id=document->>'draft_id';
 ELSIF document ? 'entity_key' THEN
  SELECT c.payload::jsonb,c.scope_id INTO parent_document,parent_scope FROM compliance_entities c WHERE c.key=document->>'entity_key';
 ELSIF document ? 'event_id' AND TG_TABLE_NAME = 'planning_notification_reads' THEN
  SELECT o.payload::jsonb,o.scope_id INTO parent_document,parent_scope FROM planning_outbox o WHERE o.event_id=document->>'event_id';
 END IF;
 IF parent_document IS NOT NULL THEN people_values := people_values || pharmshift_structured_people(parent_document); END IF;
 scope_value := COALESCE(scope_value,parent_scope,'__unclassified__');
 category_value := CASE
  WHEN TG_TABLE_NAME IN ('compliance_entities','compliance_revisions','actual_work_events','planning_leave_balances','planning_leave_events') THEN 'compliance'
  WHEN TG_TABLE_NAME IN ('people','profiles','staff_timeline','account_memberships','revoked_sessions') THEN 'identity'
  WHEN TG_TABLE_NAME = 'privacy_cases' THEN 'privacy_cases'
  WHEN TG_TABLE_NAME IN ('planning_outbox','planning_notification_reads') THEN 'audit'
  ELSE 'planning_history' END;
 IF NOT is_removal AND EXISTS(SELECT 1 FROM erased_subjects s
     WHERE s.person_id=ANY(people_values) AND (s.facility_id=split_part(scope_value,'/',1) OR scope_value='__unclassified__')) THEN
  RAISE EXCEPTION 'Approved subject erasure prevents reintroduction' USING ERRCODE='23514';
 END IF;
 SELECT revision,state,content_hash INTO existing_record FROM managed_copies WHERE copy_id=identity FOR UPDATE;
 IF FOUND AND existing_record.content_hash=copied_hash AND NOT is_removal THEN RETURN NEW; END IF;
 anchor_value := COALESCE((document->>'updated_at')::timestamptz,(document->>'created_at')::timestamptz,current_time_value);
 IF TG_TABLE_NAME='planning_inputs' AND document#>>'{payload,period,end}' IS NOT NULL THEN
  anchor_value := (document#>>'{payload,period,end}')::timestamptz; anchor_kind := 'period_end';
 END IF;
 INSERT INTO managed_copies(copy_id,scope_id,category,medium,locator,content_hash,revision,state,subject_status,anchor,anchor_at,evidence)
 VALUES(identity,scope_value,category_value,'database',location,copied_hash,COALESCE(existing_record.revision,0)+1,
  CASE WHEN is_removal THEN 'DELETED' ELSE 'PRESENT' END,'UNVERIFIED',anchor_kind,anchor_value,
  jsonb_build_object('reference','database-trigger-v1','status','unverified','subject_method','structured-fields-and-typed-parent'))
 ON CONFLICT(copy_id) DO UPDATE SET scope_id=excluded.scope_id,category=excluded.category,locator=excluded.locator,
  content_hash=excluded.content_hash,revision=excluded.revision,state=excluded.state,subject_status='UNVERIFIED',
  anchor=excluded.anchor,anchor_at=excluded.anchor_at,evidence=excluded.evidence;
 DELETE FROM copy_subjects WHERE copy_id=identity;
 INSERT INTO copy_subjects(copy_id,person_id) SELECT identity,value FROM (SELECT DISTINCT unnest(people_values) AS value) AS persons WHERE value IS NOT NULL;
 RETURN CASE WHEN is_removal THEN OLD ELSE NEW END;
END $$;
"""


def upgrade():
    op.create_table(
        "erased_subjects",
        sa.Column("facility_id", sa.String(128), primary_key=True),
        sa.Column("person_id", sa.String(64), primary_key=True),
        sa.Column("plan_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
    )
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(SQL)
    inspector = sa.inspect(op.get_bind())
    for table in sorted(set(inspector.get_table_names()) - CONTROL):
        keys = inspector.get_pk_constraint(table)["constrained_columns"]
        if not keys:
            raise RuntimeError("Copy tracking requires an explicit row identity")
        arguments = ",".join("'" + key.replace("'", "''") + "'" for key in keys)
        quoted = op.get_bind().dialect.identifier_preparer.quote(table)
        op.execute(
            f"CREATE TRIGGER pharmshift_copy_write AFTER INSERT OR UPDATE OR DELETE ON {quoted} FOR EACH ROW EXECUTE FUNCTION pharmshift_record_copy({arguments})"
        )


def downgrade():
    raise RuntimeError(
        "Preserve erasure controls and copy provenance; restore only to an isolated target"
    )
