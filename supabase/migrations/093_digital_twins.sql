-- Migration 093: organizational_digital_twins + opportunity_probability_scores
-- (Pillars 5/6 of PLATFORM_VISION_ARCHITECTURE.md - Grant Probability Engine
-- and Organizational Digital Twin).
--
-- Deviations from the task-given spec, per this project's established practice of
-- checking real state before applying a literal migration spec (task-given numbers/
-- paths/column names routinely collide with what's actually in the repo -- see
-- migration 091's header for the prior instance of this same pattern):
--   - Number/path: the task named `src/supabase/migrations/091_digital_twins.sql`.
--     `src/supabase/migrations/` is a stray duplicate directory that the Management
--     API apply step never reads -- only `supabase/migrations/` is real, and 091/092
--     are already taken there (091_funder_relationship_events.sql,
--     092_consultant_client_access_check.sql). This file uses the real next-free
--     number, 093, at the real path.
--   - `org_id` -> `organization_id`: every table in this schema uses
--     `organization_id`, FK'd to organizations(id); `org_id` would be the only
--     exception. Column renamed on both new tables.
--   - Added FK constraints (organizations(id), opportunities(id)) and RLS policies
--     matching this schema's universal pattern, which the task's literal SQL
--     omitted. PLATFORM_VISION_ARCHITECTURE.md's own governance section requires
--     "All new tables require RLS policies where org-scoped" -- every other
--     org-scoped table in this repo enforces this, so these two should not be the
--     first exception.

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

DROP POLICY IF EXISTS "organizational_digital_twins_org" ON organizational_digital_twins;
CREATE POLICY "organizational_digital_twins_org" ON organizational_digital_twins
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_digital_twins_org ON organizational_digital_twins(organization_id);

CREATE TABLE IF NOT EXISTS opportunity_probability_scores (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id      uuid        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  overall_score       integer     DEFAULT 0,
  confidence          text        DEFAULT 'low',
  factors             jsonb       DEFAULT '[]',
  recommendation      text        DEFAULT 'consider',
  key_risks           text[],
  key_strengths       text[],
  estimated_roi       text,
  time_to_complete    text,
  computed_at         timestamptz DEFAULT now(),
  UNIQUE(opportunity_id, organization_id)
);

ALTER TABLE opportunity_probability_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opportunity_probability_scores_org" ON opportunity_probability_scores;
CREATE POLICY "opportunity_probability_scores_org" ON opportunity_probability_scores
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_prob_scores_opp ON opportunity_probability_scores(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_prob_scores_org ON opportunity_probability_scores(organization_id);
