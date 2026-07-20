-- Migration 098: Digest Agent full agentic upgrade (ag-digest)
--
-- AutonomousDigestAgent (src/lib/agents/autonomous-digest-agent.ts) has never
-- been able to complete a run against the live schema: it calls
-- super(orgId, "ag-digest", supabase), and AutonomousAgent.startRun() inserts
-- agent_type unconditionally before any real work happens (AGENTS_v2.md
-- section 1.2 / section 7's own worker diagram: "07:00 runDigestPipeline()
-- -- AutonomousDigestAgent per active org (blocked, 1.2)"). 'ag-digest' was
-- never added to the agent_type enum. Adding it here follows the same
-- one-migration-per-newly-wired-agent convention used for every other
-- AutonomousAgent upgrade in this history (085, 086, 088, 090, 091, 092,
-- 093, 096, 097).
--
-- digest_item_log / digest_priority_weights are new: neither
-- SCHEMA_REGISTRY_v2.md nor any prior migration describes a table by these
-- names. They are created here from scratch to back the adaptive-learning
-- requirement in this task ("track which digest items the user acts on;
-- after 30 days, adjust priority weights based on which item types actually
-- get actioned") -- matching this session's established convention of
-- adding the schema a task assumes rather than silently working around its
-- absence (see migration 097's header for the prior instance of this same
-- convention).
--
-- digest_priority_weights has no org_id: the digest agent runs once per org
-- per night with no cross-org batch step, so "platform-wide adaptive
-- weights" are maintained as an incrementally-updated shared table (each
-- org's run folds its own action-rate sample into the running average)
-- rather than a per-org table, matching the same no-org-id/service-role-only
-- shape already used by improvement_proposals and agent_performance_metrics
-- (migration 087).

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-digest';

CREATE TABLE IF NOT EXISTS digest_item_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  item_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  base_priority integer NOT NULL,
  weighted_priority integer NOT NULL,
  digest_date date NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  actioned boolean,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE digest_item_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digest_item_log_org ON digest_item_log;
CREATE POLICY digest_item_log_org ON digest_item_log
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_digest_item_log_org ON digest_item_log(org_id, digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_digest_item_log_resolve ON digest_item_log(resolved, digest_date);

CREATE TABLE IF NOT EXISTS digest_priority_weights (
  item_type text PRIMARY KEY,
  weight_multiplier numeric NOT NULL DEFAULT 1.0,
  action_rate numeric,
  sample_count integer NOT NULL DEFAULT 0,
  last_recalculated_at timestamptz
);
COMMENT ON TABLE digest_priority_weights IS 'Platform-wide adaptive weighting for AutonomousDigestAgent item-type priority scores, derived from digest_item_log action-rate history. No org_id -- learned weights are shared across all orgs, service-role only, same shape as improvement_proposals/agent_performance_metrics (migration 087).';
