-- ============================================================================
-- BENAVORA - Migration 167: Prospect Intelligence Layer -- APP family
-- (Application Profile Orchestration) + BEN-APP-01 registry seed +
-- pil_application_profiles
--
-- This task commissioned BEN-APP-01 (agent 1 of 3 in a new "APP" family:
-- application / recommendation / executor) to consume the fully-enriched
-- pil_prospect_opportunities + BEN-QLF-01/02/03/05 detail-assessment rows
-- (migration 165) for a prospect and synthesize a ranked set of Application
-- Profiles -- which REQUEST TYPE and request_profiles row fits best, an
-- estimated success probability, and pitch/risk/relationship guidance.
--
-- Two schema gaps this migration resolves, both flagged up front rather than
-- guessed at silently (same discipline BEN-QLF-04/migration 163 applied to
-- their own task-spec-vs-applied-schema mismatches):
--
-- 1. family CHECK constraint. pil_agent_registry.family (migration 155) only
--    allows the original 8 families from PROSPECT_INTELLIGENCE_AGENTS.md.
--    "application" is not one of them, and no existing family fits this
--    mission (it is neither qualification -- BEN-QLF-* already owns
--    scoring/classification -- nor strategy -- BEN-STR-* already owns
--    cultivation/next-best-action for an already-qualified opportunity; APP's
--    job is the layer above both: choosing *which request type/profile* to
--    apply BEN-STR's strategy toward). Widened here via the same
--    DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pattern migration 092 already
--    used for a different table's CHECK constraint. AgentFamily's TS union
--    (src/lib/pil/types.ts) is widened to match in the same commit.
--
-- 2. app_recommendations output location. The task spec's own literal
--    instruction was "write output to pil_prospect_dossiers.app_
--    recommendations (JSONB)" -- but pil_prospect_dossiers (migration 163)
--    has no such column, and deliberately has no UPDATE policy at all
--    ("a new dossier is a new version row (append-only history)"). Adding a
--    mutable jsonb column to that table would either violate its own
--    documented append-only invariant, or force every recommendation write to
--    duplicate the entire 50+-field dossier blob into a new version row just
--    to attach one small JSON object -- neither is a schema-correct fit.
--    A prospect can also match >1 request_profiles at once ("Multi-profile
--    queuing: ... return all with ranked scores"), which a single JSONB
--    column on one dossier row cannot naturally hold as independently
--    queryable/rankable rows anyway. The schema-correct target, matching the
--    exact convention migration 165 already established for BEN-QLF-01/03/05
--    (one dedicated detail table per agent's output, found via
--    (organization_id, prospect_id, computed_at DESC), org-scoped
--    SELECT/INSERT only, no UPDATE/DELETE), is the new pil_application_
--    profiles table created below -- one row per (prospect, matched
--    request_profile) per run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Widen pil_agent_registry.family to accept 'application'
-- ----------------------------------------------------------------------------
ALTER TABLE pil_agent_registry
  DROP CONSTRAINT IF EXISTS pil_agent_registry_family_check;

ALTER TABLE pil_agent_registry
  ADD CONSTRAINT pil_agent_registry_family_check
  CHECK (family IN (
    'supervisory', 'discovery', 'prospect_intelligence',
    'relationship_intelligence', 'qualification', 'strategy',
    'knowledge_integrity', 'operations_evaluation_learning', 'application'
  ));

-- ----------------------------------------------------------------------------
-- pil_agent_registry seed: BEN-APP-01
-- ----------------------------------------------------------------------------
INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref)
VALUES (
  'BEN-APP-01',
  $$Application Profile Orchestrator$$,
  'application',
  $$Consume a fully-enriched prospect (pil_prospect_opportunities plus BEN-QLF-01/02/03/05's detail assessments) and synthesize which request type and request_profiles row fits best, an estimated success probability, and the strategic reasoning, field mappings, pitch parameters, risk factors, and relationship strategy to act on it. Never places an ask or submits an application itself -- that is APP-02 (Recommendation) / APP-03 (Executor)'s job.$$,
  'A2',
  $$Never self-certifies a "submit" recommendation as final -- always delegates a BEN-SUP-05 critic review for it, and always creates a pil_human_review_queue item (review_type high_impact_action) before a "submit" recommendation should be acted on downstream.$$,
  $$On demand, once a prospect's dossier reaches sufficient cross-family enrichment (SUP/DIS/INT/REL/QLF/STR/KNW).$$,
  $$Task-directed addition -- new APP family (application/recommendation/executor), agent 1 of 3, not present in PROSPECT_INTELLIGENCE_AGENTS.md's original 7-family/44-agent list.$$
)
ON CONFLICT (agent_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- pil_application_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_application_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id           uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id        uuid REFERENCES pil_prospect_opportunities(id) ON DELETE SET NULL,
  request_type          text NOT NULL CHECK (request_type IN (
                          'monetary', 'land', 'in_kind', 'volunteer',
                          'service', 'partnership', 'sponsorship', 'facility'
                        )),
  request_profile_id    uuid REFERENCES request_profiles(id) ON DELETE SET NULL,
  success_probability   numeric NOT NULL CHECK (success_probability >= 0 AND success_probability <= 1),
  recommendation_status text NOT NULL CHECK (recommendation_status IN (
                          'submit', 'monitor', 'research_more', 'manual_review'
                        )),
  strategic_reasoning   text NOT NULL,
  field_mappings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  pitch_parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_factors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationship_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs         uuid[] NOT NULL DEFAULT '{}',
  confidence            numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  computed_by_agent_id  text NOT NULL DEFAULT 'BEN-APP-01',
  computed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_application_profiles_prospect
  ON pil_application_profiles(organization_id, prospect_id, computed_at DESC);

ALTER TABLE pil_application_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_application_profiles FROM anon;
CREATE POLICY pil_application_profiles_org_select ON pil_application_profiles FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_application_profiles_org_insert ON pil_application_profiles FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: each run's ranked set is a new batch of rows, not a
-- correction of a prior run -- matching pil_mission_affinity_assessments/
-- pil_capacity_propensity_assessments/pil_timing_readiness_assessments'
-- identical append-only convention (migration 165).
