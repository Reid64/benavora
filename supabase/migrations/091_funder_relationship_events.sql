-- Migration 091: Funder relationship event log (event-sourced relationship scoring).
--
-- Deviations from the task-given spec, per this project's established practice of
-- checking real state before applying a literal migration spec (task-given numbers/
-- paths/table shapes routinely collide with what's actually in the repo):
--   - Path: the task named `src/supabase/migrations/088_relationship_scores.sql`.
--     `src/supabase/migrations/` is a known stray duplicate directory (documented in
--     STATE_OF_THE_BUILD.md's "Phase 2-4 completion audit" finding) that `supabase db
--     push` / the Management API apply script never reads — only `supabase/migrations/`
--     is real. `088` is also already taken there (088_foundation_profiles_enrichment.sql,
--     089, 090 exist too) — this file uses the real next-free number, 091, at the real
--     path.
--   - `org_id` -> `organization_id`: every table in this schema uses `organization_id`;
--     `org_id` would be the only exception.
--   - `funder_relationship_scores` is NOT created here. It already exists (migration
--     038, extended in 039) with an equivalent-but-differently-shaped schema
--     (organization_id, funder_id, relationship_score, trend, recent_events, is_stale,
--     total_interactions, successful_applications, last_interaction_at, UNIQUE
--     (organization_id, funder_id)) and is actively maintained by the existing Funder
--     Relationship Agent (src/lib/agents/funder-relationship.ts, Agent 23) on a
--     decay-based incremental model, and read directly by the funders page's card grid
--     (FunderCard.tsx's relationship-score badge). Re-issuing `CREATE TABLE IF NOT
--     EXISTS funder_relationship_scores (...)` with the task's column names would be a
--     silent no-op against that existing table (IF NOT EXISTS skips it entirely) and
--     would leave the new columns (org_id/score/momentum/computed_at) never created --
--     broken, not just redundant. This migration only adds the new event-log table;
--     the new event-sourced scorer below computes on read rather than writing into the
--     existing scores table, so it doesn't fight Agent 23's decay model for the same row.

CREATE TABLE IF NOT EXISTS funder_relationship_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id        uuid        NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  event_type       text        NOT NULL CHECK (event_type IN
                                 ('award', 'application', 'response', 'outreach', 'meeting', 'rejection')),
  event_date       timestamptz NOT NULL DEFAULT now(),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE funder_relationship_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "funder_relationship_events_org" ON funder_relationship_events;
CREATE POLICY "funder_relationship_events_org" ON funder_relationship_events
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_funder_rel_events_org    ON funder_relationship_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_funder_rel_events_funder ON funder_relationship_events (funder_id);
CREATE INDEX IF NOT EXISTS idx_funder_rel_events_date   ON funder_relationship_events (event_date DESC);
