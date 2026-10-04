"""Bind request decision actor IDs without treating arbitrary evidence names as accounts."""
from alembic import op
from sqlalchemy import text

revision = "20260923_0014"
down_revision = "20260923_0013"
branch_labels = None
depends_on = None

SQL = r"""
CREATE FUNCTION pharmshift_actor_people_at(document jsonb, scope_value text, path_value text[]) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE result text[] := ARRAY[]::text[]; pair record; element record; matched text[];
BEGIN
 IF jsonb_typeof(document)='object' THEN
  FOR pair IN SELECT * FROM jsonb_each(document) LOOP
   IF (pair.key IN ('actor','created_by','requested_by','reviewed_by','published_by','decided_by')
       OR (pair.key='verified_by' AND (path_value=ARRAY['decision'] OR path_value=ARRAY['payload','decision'])))
      AND jsonb_typeof(pair.value)='string' THEN
    SELECT ARRAY_AGG(DISTINCT m.person_id) INTO matched FROM account_memberships m
     WHERE m.subject=pair.value#>>'{}'
       AND (scope_value IS NULL OR scope_value='__unclassified__' OR m.scope_id=scope_value)
       AND (NOT document ? 'issuer' OR m.issuer=document->>'issuer');
    result := result || COALESCE(matched,ARRAY[]::text[]);
   ELSE
    result := result || pharmshift_actor_people_at(pair.value,scope_value,path_value || pair.key);
   END IF;
  END LOOP;
 ELSIF jsonb_typeof(document)='array' THEN
  FOR element IN SELECT value, ordinality FROM jsonb_array_elements(document) WITH ORDINALITY LOOP
   result := result || pharmshift_actor_people_at(element.value,scope_value,path_value || ((element.ordinality-1)::text));
  END LOOP;
 END IF;
 RETURN ARRAY(SELECT DISTINCT unnest(result));
END $$;
CREATE OR REPLACE FUNCTION pharmshift_actor_people(document jsonb, scope_value text) RETURNS text[]
LANGUAGE sql STABLE AS $$ SELECT pharmshift_actor_people_at(document,scope_value,ARRAY[]::text[]) $$;
"""


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute(SQL)
        definition = op.get_bind().scalar(text("SELECT pg_get_functiondef('pharmshift_record_copy()'::regprocedure)"))
        anchor = "IF parent_document IS NOT NULL THEN people_values := people_values || pharmshift_structured_people(parent_document); END IF;"
        if not definition or definition.count(anchor) != 1:
            raise RuntimeError("Unrecognized copy trigger; do not infer a migration")
        # A leave event has no scope column. Its physical publication FK supplies
        # the scope; both grant owner and referenced publication subjects remain
        # explicitly linked. Source row payload and digest are untouched.
        typed_leave = """IF TG_TABLE_NAME='planning_leave_events' THEN
 SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope
 FROM planning_publications p WHERE p.publication_id=document->>'publication_id';
 people_values := people_values || COALESCE((SELECT ARRAY[b.person_id]
 FROM planning_leave_balances b WHERE b.grant_id=document->>'grant_id'), ARRAY[]::text[]);
 END IF;
 IF TG_TABLE_NAME='planning_outbox' THEN
  IF document->>'kind' LIKE 'compliance.%' THEN
   SELECT c.payload::jsonb,c.scope_id INTO parent_document,parent_scope FROM compliance_entities c
    WHERE c.key=document#>>'{payload,key}' AND 'compliance.'||c.kind=document->>'kind';
  ELSIF document->>'kind' IN ('request.submit','request.decision','request.withdraw','leave.request') THEN
   SELECT to_jsonb(r),r.scope_id INTO parent_document,parent_scope FROM planning_requests r
    WHERE r.request_id=document#>>'{payload,request_id}';
  ELSIF document->>'kind' IN ('privacy.request','privacy.decision') THEN
   SELECT to_jsonb(r),r.scope_id INTO parent_document,parent_scope FROM privacy_cases r
    WHERE r.case_id=document#>>'{payload,case_id}';
  ELSIF document->>'kind'='leave.settled' THEN
   SELECT to_jsonb(b),p.scope_id INTO parent_document,parent_scope FROM planning_leave_events e
    JOIN planning_leave_balances b ON b.grant_id=e.grant_id
    JOIN planning_publications p ON p.publication_id=e.publication_id
    WHERE e.event_id=document#>>'{payload,event_id}';
  ELSIF document->>'kind'='job.cancel' THEN
   SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope FROM planning_jobs j
    JOIN planning_inputs p ON p.input_hash=j.input_hash WHERE j.job_id=document#>>'{payload,job_id}';
  ELSIF document->'payload' ? 'input_hash' THEN
   SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope FROM planning_inputs p
    WHERE p.input_hash=document#>>'{payload,input_hash}';
  ELSIF document->'payload' ? 'draft_id' THEN
   SELECT p.payload::jsonb,p.scope_id INTO parent_document,parent_scope FROM planning_drafts d
    JOIN planning_inputs p ON p.input_hash=d.input_hash WHERE d.draft_id=document#>>'{payload,draft_id}';
  END IF;
  IF parent_scope IS NOT NULL AND scope_value IS DISTINCT FROM parent_scope THEN
   RAISE EXCEPTION 'Typed event reference crosses scope' USING ERRCODE='23514';
  END IF;
 END IF;
 """
        op.execute(definition.replace(anchor, typed_leave + anchor))
    # Existing JSON/hashes are immutable. Reconciliation detects older missing
    # references; migration never labels prior free text as reviewed.


def downgrade():
    raise RuntimeError("Retain actor provenance; rollback through isolated restore only")
