-- ============================================================================
-- BENAVORA - Migration 196: AR-9.1 - orchestration_logs authenticated INSERT
--
-- Migration 190 (AR-6.2) shipped orchestration_logs with a SELECT-only RLS
-- policy on the explicit stated assumption that "service role... does all
-- the writing from worker/autonomous-orchestrator.ts... there is no
-- authenticated write path to bypass".
--
-- AR-9.1's live production audit (2026-09-18) found that assumption false:
-- orchestration_logs had zero rows ever, despite 184 real agent_runs in the
-- prior 3 hours. Root cause: the service-role path migration 190 described
-- was fed exclusively by agent_queue, which had received nothing in 24+
-- hours (only on-demand trigger routes enqueue to it) - while the actual
-- high-volume production traffic (every AutonomousAgent subclass via
-- src/lib/agents/autonomous-base.ts, the AutoApply worker pipeline via
-- src/lib/autoapply/run-logger.ts, and on-demand agents via
-- src/lib/agents/base-agent.ts) runs entirely outside
-- worker/autonomous-orchestrator.ts and was never instrumented.
--
-- Fixing that by instrumenting the code the traffic actually takes
-- introduces a genuine authenticated write path: BaseAgent is documented to
-- run under either the service-role client (scheduled/automated runs) OR a
-- session client (user-triggered routes) depending on caller
-- (src/lib/agents/base-agent.ts header comment). A session-client run must
-- be able to write its own orchestration_logs row the same way it already
-- writes its own agent_runs row.
--
-- Matches agent_runs_org_isolation's existing pattern (migration 001)
-- exactly: WITH CHECK organization_id = current_org_id(), so a
-- session-client insert can only ever write a row scoped to its own org.
-- Service-role writes are unaffected either way (RLS bypassed entirely).
-- ============================================================================

CREATE POLICY "orchestration_logs_authenticated_insert" ON public.orchestration_logs
  FOR INSERT
  WITH CHECK (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 196
-- ============================================================================
