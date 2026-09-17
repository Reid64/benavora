-- ============================================================================
-- BENAVORA - Migration 185: AR-5.1 - ai_usage_log becomes the single per-call
-- cost ledger.
--
-- Live facts checked against project vbjplpquqxxfbpazyalt on 2026-09-17:
--   ai_usage_log has 0 rows, is referenced only by migration 056, and has no
--   application reader or writer.
--   pil_cost_ledger (migration 158) has 49 rows and is the only table
--   recordCost() (src/lib/pil/cost.ts) writes to.
--
-- Three defects in ai_usage_log's original (migration 056) shape are fixed
-- here before it becomes canonical:
--   1. estimated_cost_cents is an INTEGER -- a 1000/500-token Haiku call
--      ($0.0035) rounds to 0. cost_usd numeric(14,6) replaces it as the
--      column actually written; estimated_cost_cents is left in place
--      (no rows, no readers) but nothing writes to it going forward.
--   2. No run attribution -- agent_run_id (core agent_runs) and
--      pil_agent_run_id (PIL agent_runs) let a cost row be joined back to
--      the run that incurred it, the one thing pil_cost_ledger already had
--      that a naive migration would have lost.
--   3. No billing-path discriminator -- Benavora runtime agents spend real
--      Anthropic Console credits (billing_path = 'api'); FORGE build runs
--      authenticate the `claude` CLI against a Max subscription with
--      $env:ANTHROPIC_API_KEY forced to $null (forge-orchestrator.ps1) and
--      have no per-token dollar cost (billing_path = 'subscription').
--      Without this, subscription rows read as real spend.
-- ============================================================================

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS cost_usd numeric(14,6),
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pil_agent_run_id uuid REFERENCES pil_agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'anthropic',
  ADD COLUMN IF NOT EXISTS billing_path text NOT NULL DEFAULT 'api';

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_billing_path_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_billing_path_check CHECK (billing_path IN ('api', 'subscription'));

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_org_created ON ai_usage_log(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_agent_run ON ai_usage_log(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_pil_agent_run ON ai_usage_log(pil_agent_run_id);
