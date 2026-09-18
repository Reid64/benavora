-- ============================================================================
-- BENAVORA - Migration 195: AR-7.2 - one-time reap of automation_sessions
-- rows already stuck non-terminal past their staleness threshold.
--
-- Context: worker/stuck-run-watchdog.ts gained a periodic sweep for this
-- table in the same change that authored this migration (AR-7.2), but that
-- sweep only runs once the updated worker code is deployed - and this task
-- was explicitly DO NOT DEPLOY. Meanwhile submission-validator.ts's
-- checkConcurrentAutomation() refuses any new AutoApply run for an
-- org+funder pair while a non-terminal automation_sessions row exists for
-- it, so the 7 rows already stranded in production (2026-09-17 audit, one
-- since 2026-06-11) were blocking that many org+funder pairs right now,
-- indefinitely, regardless of any code fix. This migration applies the exact
-- same reap the watchdog would apply on its first pass, so a row closed here
-- is indistinguishable from one the watchdog closes later - same per-status
-- thresholds, same terminal status, same marker convention.
--
-- Thresholds (mirrored from worker/stuck-run-watchdog.ts's
-- AUTOMATION_SESSION_TIMEOUTS_MS - see that file for the full reasoning):
--   pending / in_progress / approved -> 30 minutes. Technical mid-flight
--     states with a real SLA (BEHAVIORAL_CONTRACTS §18 caps a run at ~5
--     minutes); nothing legitimate is still in one of these three 30 minutes
--     later.
--   awaiting_approval -> 7 days. A human-wait state
--     (PAUSE-FOR-APPROVAL INVARIANT, session-manager.ts) - a real reviewer
--     may take days; 7 days protects any review still plausibly in flight
--     while still releasing rows nobody will ever act on.
--
-- Idempotent: re-running this migration only ever touches rows that are
-- STILL non-terminal and STILL past threshold at the time it runs, and every
-- row it touches is already unambiguously stuck by that same test - safe to
-- apply more than once, and harmless once the watchdog itself has already
-- swept everything currently eligible.
-- ============================================================================

update public.automation_sessions
set
  status = 'failed',
  error_message = format(
    'Reaped by one-time AR-7.2 cleanup (migration 195): automation_sessions row stuck in ''%s'' since %s without advancing.',
    status,
    updated_at
  ),
  completed_at = now(),
  updated_at = now()
where
  (status in ('pending', 'in_progress', 'approved') and updated_at < now() - interval '30 minutes')
  or (status = 'awaiting_approval' and updated_at < now() - interval '7 days');

-- ============================================================================
-- END Migration 195
-- ============================================================================
