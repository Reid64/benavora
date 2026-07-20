-- 094_twin_powered_draft_generation.sql
-- Twin-Powered Draft Generation (AUTONOMOUS_PLATFORM_VISION.md Phase 2,
-- "Twin-Powered Draft Generation"; PLATFORM_VISION_ARCHITECTURE.md Pillar 6).
--
-- Deviations from the task-given spec, following this fork's established
-- practice of checking real state before applying a literal spec verbatim
-- (see 093_donor_intent_engine.sql and this file's sibling migrations for
-- prior instances of this same pattern):
--   - organizational_digital_twins does not exist anywhere in this migration
--     track (src/supabase/migrations, the fork every AutonomousAgent-era file
--     -- autonomous-base.ts, draft-generation-agent.ts, digital-twin-builder.ts
--     -- actually depends on: agent_queue/agent_decisions/org_autonomous_config
--     from 080, platform_learning_patterns from 083, both queried directly by
--     draft-generation-agent.ts today). A same-named table was created under
--     migration number 093 in the OTHER migrations directory
--     (supabase/migrations/093_digital_twins.sql, a parallel fork that
--     independently renumbered from 072 and does not contain
--     autonomous_agent_infrastructure/agent_queue/agent_decisions/
--     org_autonomous_config/platform_learning_patterns at all -- confirmed
--     absent from that directory). src/lib/intelligence/digital-twin-builder.ts
--     was evidently written against that other fork's numbering (its header
--     comment cites "migration 093") while src/lib/agents/draft-generation-
--     agent.ts was written against this fork's numbering (platform_learning_
--     patterns from this fork's 083). Since every other table
--     draft-generation-agent.ts and autonomous-base.ts touch lives only in
--     this fork, this table is added here, at this fork's real next-free
--     number (094), so the digital-twin-builder.ts code this task depends on
--     actually has a table to write to. Column shape matches exactly what
--     digital-twin-builder.ts populates, plus `vision` and `known_weaknesses`
--     (present in the other fork's version and in SCHEMA_REGISTRY_v2.md's
--     table 49 spec, left nullable/unpopulated here for forward
--     compatibility -- Core Data Principle #2, no per-field migration needed
--     later).
--   - `org_id` -> `organization_id`: digital-twin-builder.ts's upsert and
--     select both key on `organization_id` (matching applications/
--     organizations/knowledge_base convention), not the `org_id` convention
--     this fork's newer agent-infrastructure tables (agent_queue,
--     agent_decisions, platform_learning_patterns) use. Kept as
--     `organization_id` to match the already-written, task-referenced code
--     rather than rewriting that file's column name.

CREATE TABLE IF NOT EXISTS organizational_digital_twins (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  mission                    text,
  vision                     text,
  service_areas              text[],
  programs                   jsonb       DEFAULT '[]',
  financial_profile          jsonb       DEFAULT '{}',
  board_composition          jsonb       DEFAULT '[]',
  proven_narrative_patterns  text[],
  key_strengths              text[],
  known_weaknesses           text[],
  twin_completeness_score    integer     DEFAULT 0,
  last_rebuilt_at            timestamptz,
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);

ALTER TABLE organizational_digital_twins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "digital_twins_org" ON organizational_digital_twins;
CREATE POLICY "digital_twins_org" ON organizational_digital_twins
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_digital_twins_org ON organizational_digital_twins(organization_id);

-- Draft Generation Agent (ag-05-draft) upgrade: every autonomously created
-- application now records whether digital twin context was available and
-- how complete it was at generation time, for the confidence calculation and
-- for the "/intelligence/twin" completeness-gap prompt.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS twin_powered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS twin_completeness integer;
