-- ============================================================================
-- BENAVORA - Migration 163: Prospect Intelligence Layer, PIL-02 -- Prospect Dossiers +
-- Feature Flags (kill switches)
--
-- Two additions needed by this PIL-02 batch's supervisory agents:
--
-- 1. pil_prospect_dossiers (BEN-SUP-08 -- Executive Intelligence Narrative Agent). The
--    task spec for this table used `org_id`/`run_id` column names, but every other pil_*
--    table in this schema uses `organization_id` (see src/lib/pil/db.ts's explicit note
--    that filtering on `org_id` would silently match zero rows) and `research_run_id` as
--    the FK name to pil_research_runs (pil_agent_runs, pil_evidence). This migration uses
--    the established names instead of the spec's literal ones, for consistency with every
--    other table an agent in this codebase already queries.
--
-- 2. pil_feature_flags (BEN-SUP-07 -- Autonomy Governor's kill-switch source of truth).
--    Did not exist anywhere in migrations 150-162; created here per the task spec's
--    explicit instruction ("read from a pil_feature_flags table - create this table if it
--    does not exist").
--
-- Also seeds pil_agent_registry rows for BEN-SUP-07 (Autonomy Governor) and BEN-SUP-08
-- (Executive Intelligence Narrative Agent). Neither agent appears in
-- PROSPECT_INTELLIGENCE_AGENTS.md -- that document's Family 1 (Supervisory &
-- Orchestration) defines exactly 6 agents, BEN-SUP-01 through BEN-SUP-06 (confirmed
-- against the document's own agent-count table), and the platform's "44-agent registry"
-- (migration 155) has no BEN-SUP-07/08 rows. This task explicitly directs building both
-- agents with concrete behavioral requirements, so they are registered here as the fleet's
-- 45th/46th agents -- without a pil_agent_registry row, AgentRunner.run() calls
-- loadAgent() (agent-registry-service.ts) which throws AgentNotFoundError for any
-- unregistered agent_id, so the implementations in src/lib/pil/agents/sup/BEN-SUP-07.ts
-- and BEN-SUP-08.ts could never actually execute without this seed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pil_prospect_dossiers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_prospect_dossiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id       uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  research_run_id   uuid REFERENCES pil_research_runs(id),
  dossier           jsonb NOT NULL,
  narrative_text    text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_prospect_dossiers_prospect ON pil_prospect_dossiers(organization_id, prospect_id, version DESC);

ALTER TABLE pil_prospect_dossiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_dossiers FROM anon;
CREATE POLICY pil_prospect_dossiers_org_select ON pil_prospect_dossiers FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospect_dossiers_org_insert ON pil_prospect_dossiers FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: a new dossier is a new version row (append-only history),
-- matching pil_audit_log/pil_agent_run_events's append-only pattern elsewhere in this schema.

-- ----------------------------------------------------------------------------
-- pil_feature_flags
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_feature_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key      text NOT NULL,
  scope_type    text NOT NULL DEFAULT 'platform' CHECK (scope_type IN ('platform', 'org', 'agent')),
  scope_id      text, -- organization_id (as text) when scope_type='org', agent_id when scope_type='agent', NULL for platform
  enabled       boolean NOT NULL DEFAULT false,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_key, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_feature_flags_scope ON pil_feature_flags(scope_type, scope_id, enabled);

ALTER TABLE pil_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_feature_flags FROM anon;
CREATE POLICY pil_feature_flags_shared_select ON pil_feature_flags FOR SELECT TO authenticated USING (true);
-- No authenticated write policy: kill switches are a platform safety control, administered
-- by the service-role deploy pipeline / admin tooling only, matching pil_agent_registry and
-- pil_source_registry's own administration model (migrations 155/157).

-- ----------------------------------------------------------------------------
-- pil_agent_registry seed: BEN-SUP-07, BEN-SUP-08
-- ----------------------------------------------------------------------------
INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref) VALUES
('BEN-SUP-07', $$Autonomy Governor$$, 'supervisory', $$Continuously monitor every active agent run and delegation for autonomy-policy violations and kill-switch conditions, and terminate any violation immediately.$$, 'A4', $$H1 for every detected violation (always creates a pil_human_review_queue item); cannot approve its own authority increases or policy exceptions -- enforced structurally, since only a human decision (submitReviewDecision) can resolve a pil_human_review_queue row.$$, $$Continuous.$$, $$Task-directed addition, PIL-02 batch (not present in PROSPECT_INTELLIGENCE_AGENTS.md's Family 1 6-agent list)$$),
('BEN-SUP-08', $$Executive Intelligence Narrative Agent$$, 'supervisory', $$Synthesize a completed prospect research run's evidence and knowledge graph into a structured dossier with facts and inferences explicitly separated, citations, confidence scores, and recommended next actions.$$, 'A2', NULL, $$On demand, once a prospect research run reaches completion.$$, $$Task-directed addition, PIL-02 batch (not present in PROSPECT_INTELLIGENCE_AGENTS.md's Family 1 6-agent list)$$)
ON CONFLICT (agent_id) DO NOTHING;
