-- 081_application_followups.sql
-- AG-28 event-driven follow-up scheduling.
--
-- Deviation note: the task spec assumed a `follow_up_sequences` table with
-- columns (application_id, scheduled_date, channel, content, status,
-- follow_up_type). That name already exists (see the top-level
-- supabase/migrations/083_followup_sequences.sql, which is reflected in
-- src/types/database.ts) as an incompatible template+enrollment pair
-- (organization_id, name, trigger_stage, steps jsonb - a saved-sequence
-- definition, not a per-application scheduled item). Reusing that name would
-- silently collide with a different design, so this migration creates a new
-- table, application_followups, with the exact columns this agent needs.

CREATE TABLE IF NOT EXISTS application_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  follow_up_type text NOT NULL CHECK (follow_up_type IN ('check_in','thank_you','feedback_request','renewal_prep')),
  scheduled_date date NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  content text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE application_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "application_followups_org" ON application_followups;
CREATE POLICY "application_followups_org" ON application_followups
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_application_followups_org ON application_followups(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_application_followups_application ON application_followups(application_id);

-- Widen trigger_source so a genuinely event-driven agent_queue row (fired by
-- a pipeline stage transition, not autonomous/manual/chain/schedule) is a
-- valid insert. Constraint names below are Postgres's default auto-generated
-- names for the unnamed inline CHECKs in
-- src/supabase/migrations/080_autonomous_agent_infrastructure.sql.
ALTER TABLE agent_queue DROP CONSTRAINT IF EXISTS agent_queue_trigger_source_check;
ALTER TABLE agent_queue ADD CONSTRAINT agent_queue_trigger_source_check
  CHECK (trigger_source IN ('autonomous','manual','chain','schedule','event'));

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_trigger_source_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_trigger_source_check
  CHECK (trigger_source IN ('autonomous','manual','chain','schedule','event'));
