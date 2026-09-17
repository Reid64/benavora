-- ============================================================================
-- BENAVORA - Migration 186: AR-5.1 - backfill pil_cost_ledger into ai_usage_log,
-- mark pil_cost_ledger superseded and read-only.
--
-- Column mapping (per AR-5.1 spec): total_cost_usd -> cost_usd,
-- model_name -> model, cost_type -> endpoint, token_count -> total_tokens,
-- occurred_at -> created_at, provider -> provider, billing_path -> 'api'.
--
-- CORRECTION to the spec's literal "agent_run_id -> agent_run_id": migration
-- 158 defines pil_cost_ledger.agent_run_id as REFERENCES pil_agent_runs(id),
-- not the core agent_runs(id) table migration 185's new ai_usage_log.
-- agent_run_id column points to. Inserting those values into agent_run_id
-- would violate that column's FK (the ids don't exist in agent_runs) for
-- every non-null row. They map to pil_agent_run_id instead; agent_run_id is
-- left NULL for all backfilled rows since pil_cost_ledger never recorded a
-- core agent_runs id.
--
-- Guarded by "ai_usage_log currently has zero rows" (the verified live fact
-- this spec was written against) so re-running this migration is a no-op
-- rather than double-inserting the 49 rows.
-- ============================================================================

INSERT INTO ai_usage_log (
  organization_id, model, endpoint, input_tokens, output_tokens, total_tokens,
  duration_ms, agent_type, created_at, cost_usd, agent_run_id, pil_agent_run_id,
  provider, billing_path
)
SELECT
  pcl.organization_id,
  COALESCE(pcl.model_name, pcl.provider, 'unknown'),
  pcl.cost_type,
  0,
  0,
  COALESCE(pcl.token_count, 0),
  NULL,
  NULL,
  pcl.occurred_at,
  pcl.total_cost_usd,
  NULL,
  pcl.agent_run_id,
  COALESCE(pcl.provider, 'anthropic'),
  'api'
FROM pil_cost_ledger pcl
WHERE NOT EXISTS (SELECT 1 FROM ai_usage_log LIMIT 1);

COMMENT ON TABLE pil_cost_ledger IS
  'SUPERSEDED by ai_usage_log as of migration 185/186 (AR-5.1). Read-only: '
  'kept for its 49-row cost history, but nothing in src/ or worker/ writes '
  'to it anymore. New cost rows go to ai_usage_log (cost_usd numeric, '
  'agent_run_id/pil_agent_run_id, billing_path).';
