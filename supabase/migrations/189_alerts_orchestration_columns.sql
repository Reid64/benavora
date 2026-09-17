-- ============================================================================
-- BENAVORA - Migration 189: AR-6.1 - orchestration columns on public.alerts.
-- Apply AFTER 188_orchestration_alert_types.sql (that migration's new
-- alert_type values are not usable until their own transaction commits).
--
-- orchestration_id: links an alert back to the orchestration run that raised
-- it (e.g. a PIL research-orchestrator run). No FK - no single orchestration
-- registry table exists yet across PIL/AutoApply/agent-runner; a plain
-- nullable uuid keeps this additive without inventing one prematurely.
--
-- notified_at: delivery idempotency marker for prompt 6.4 (outbound
-- notification dispatch) - added now per Phase 6.1 spec so 6.4 does not need
-- its own migration for a single column.
-- ============================================================================

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS orchestration_id uuid;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_alerts_orchestration_id
  ON public.alerts (orchestration_id);

-- ============================================================================
-- END Migration 189
-- ============================================================================
