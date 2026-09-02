-- ============================================================================
-- BENAVORA - Migration 168: Prospect Intelligence Layer -- BEN-APP-02
-- (Recommendation Priority Scorer) registry seed + pil_priority_scores
--
-- This task commissioned BEN-APP-02 (agent 2 of 3 in the APP family) to rank
-- every prospect with a BEN-APP-01 application profile by a 0-100 strategic
-- priority score, so a tenant with hundreds of qualified prospects and
-- capacity for only 10-20 outreach campaigns knows which to pursue first.
--
-- Same schema gap migration 167 already flagged for BEN-APP-01, recurring
-- here for BEN-APP-02: the task spec's own literal instruction was
-- "Output: pil_prospect_dossiers.priority_score, priority_percentile,
-- priority_recommendation" -- but pil_prospect_dossiers (migration 163) has
-- no such columns, and deliberately has no UPDATE policy at all ("a new
-- dossier is a new version row (append-only history)"). Adding three mutable
-- columns to that table would violate its own append-only invariant. The
-- schema-correct target, matching the exact convention migration 165
-- (BEN-QLF-01/03/05) and migration 167 (BEN-APP-01) already established --
-- one dedicated detail table per agent's output, found via
-- (organization_id, prospect_id, computed_at DESC), org-scoped
-- SELECT/INSERT only, no UPDATE/DELETE -- is the new pil_priority_scores
-- table created below. One row per (prospect, this run's computed_at) --
-- BEN-APP-02 scores one representative application profile per prospect
-- (its own highest success_probability match from BEN-APP-01's ranked set),
-- not one row per (prospect, request_profile) the way pil_application_
-- profiles does, since "priority" is a per-prospect resource-allocation
-- decision (which prospect to spend scarce outreach capacity on), not a
-- per-request-type one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pil_agent_registry seed: BEN-APP-02
-- ----------------------------------------------------------------------------
INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref)
VALUES (
  'BEN-APP-02',
  $$Recommendation Priority Scorer$$,
  'application',
  $$Rank every prospect with a BEN-APP-01 application profile by a 0-100 strategic priority score (success probability, capacity/value, relationship readiness, effort efficiency, strategic bonus) so a tenant with far more qualified prospects than outreach capacity knows which 10-20 to pursue first. Never places an ask or submits anything itself -- that is APP-03 (Executor)'s job.$$,
  'A2',
  $$Purely advisory ranking -- never independently contacts a prospect or commits outreach capacity. Never self-certifies which prospects get scarce capacity as final: creates a pil_human_review_queue item (review_type high_impact_action) summarizing its top "submit_now" picks every run for staff to confirm before capacity is committed.$$,
  $$On demand, once BEN-APP-01 has produced application profiles for the prospects a tenant wants ranked (typically the same cadence as BEN-APP-01 itself).$$,
  $$Task-directed addition -- new APP family (application/recommendation/executor), agent 2 of 3, not present in PROSPECT_INTELLIGENCE_AGENTS.md's original 7-family/44-agent list.$$
)
ON CONFLICT (agent_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- pil_priority_scores
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_priority_scores (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id             uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  application_profile_id  uuid REFERENCES pil_application_profiles(id) ON DELETE SET NULL,
  priority_score          numeric NOT NULL CHECK (priority_score >= 0 AND priority_score <= 100),
  priority_percentile     text NOT NULL CHECK (priority_percentile IN (
                            'top_10', 'top_25', 'top_50', 'bottom_50'
                          )),
  priority_recommendation text NOT NULL CHECK (priority_recommendation IN (
                            'submit_now', 'submit_next_quarter', 'monitor', 'research_more'
                          )),
  score_breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning               text NOT NULL,
  next_step               text NOT NULL,
  evidence_refs           uuid[] NOT NULL DEFAULT '{}',
  computed_by_agent_id    text NOT NULL DEFAULT 'BEN-APP-02',
  computed_at             timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_priority_scores_prospect
  ON pil_priority_scores(organization_id, prospect_id, computed_at DESC);

-- Every row from the same execute() call shares one explicit computed_at
-- value (mirroring pil_application_profiles' identical convention), so a
-- caller can group "this run's full ranked set" and re-derive rank order by
-- (organization_id, computed_at, priority_score DESC) without needing a
-- separate rank/rank_total column.
CREATE INDEX IF NOT EXISTS idx_pil_priority_scores_run_rank
  ON pil_priority_scores(organization_id, computed_at DESC, priority_score DESC);

ALTER TABLE pil_priority_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_priority_scores FROM anon;
CREATE POLICY pil_priority_scores_org_select ON pil_priority_scores FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_priority_scores_org_insert ON pil_priority_scores FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: each run's ranked set is a new batch of rows, not
-- a correction of a prior run -- identical append-only convention to
-- pil_application_profiles/pil_mission_affinity_assessments/pil_capacity_
-- propensity_assessments/pil_timing_readiness_assessments (migrations 165/167).
