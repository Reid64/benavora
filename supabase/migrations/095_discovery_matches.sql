-- Migration 095: discovery_runs + discovery_matches (Pillar 2, AI Opportunity
-- Discovery Engine).
--
-- Deviations from the task-given spec (PLATFORM_VISION_ARCHITECTURE.md
-- Pillar 2), per this project's established practice of checking real state
-- before applying a literal spec (see 093/094 headers for prior instances):
--   - Added organization_id to discovery_runs: the spec's literal SQL omits
--     it, but every discovery run in this codebase is scoped to one org (the
--     agent runs per-org, like every other agent), and every other table in
--     this schema is org-scoped with RLS. Without it discovery_runs could not
--     carry a policy at all.
--   - `org_id` -> `organization_id` on discovery_matches: every table in this
--     schema uses `organization_id`, FK'd to organizations(id); `org_id`
--     would be the only exception.
--   - discovery_matches has no opportunity_id from the literal spec's rows
--     that are new (not yet in the opportunities table) -- discovery is a
--     staging step ahead of the pipeline, so external_title/external_source/
--     external_url carry the raw discovery until a user actions it. Kept
--     opportunity_id as a nullable FK for the case where the match resolves
--     to an existing opportunities row.
--   - Added FK constraints (organizations(id), opportunities(id),
--     discovery_runs(id)) and RLS policies matching this schema's universal
--     pattern, which the task's literal SQL omitted.

CREATE TABLE IF NOT EXISTS discovery_runs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_date               date        NOT NULL DEFAULT CURRENT_DATE,
  opportunities_found    integer     NOT NULL DEFAULT 0,
  opportunities_matched  integer     NOT NULL DEFAULT 0,
  sources_checked        text[],
  runtime_seconds        integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discovery_runs_org" ON discovery_runs;
CREATE POLICY "discovery_runs_org" ON discovery_runs
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_discovery_runs_org ON discovery_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_date ON discovery_runs(run_date DESC);

CREATE TABLE IF NOT EXISTS discovery_matches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  discovery_run_id    uuid        REFERENCES discovery_runs(id) ON DELETE CASCADE,
  opportunity_id      uuid        REFERENCES opportunities(id) ON DELETE CASCADE,
  external_title      text        NOT NULL,
  external_source     text        NOT NULL,
  external_url        text,
  match_score         numeric,
  match_reasons       text[],
  status              text        NOT NULL DEFAULT 'pending',
  actioned_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discovery_matches_org" ON discovery_matches;
CREATE POLICY "discovery_matches_org" ON discovery_matches
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_discovery_matches_org ON discovery_matches(organization_id);
CREATE INDEX IF NOT EXISTS idx_discovery_matches_run ON discovery_matches(discovery_run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_matches_score ON discovery_matches(match_score DESC);
