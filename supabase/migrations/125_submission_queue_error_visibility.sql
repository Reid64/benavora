-- 125_submission_queue_error_visibility.sql
--
-- Closes a real, live schema-drift bug found 2026-08-06 while diagnosing why
-- a properly-seeded "ready" org's AutoApply submission_queue pipeline
-- (worker/queue-processor.ts) ends in a terminal state with zero explanation
-- anywhere in the database.
--
-- Three columns worker/queue-processor.ts already writes to do not exist
-- live -- confirmed via the PostgREST OpenAPI schema, not inferred:
--
--   1. error_message text -- the AccountSetupRequiredError branch (loop(),
--      ~line 325-332) already includes `error_message: err.message` in its
--      `.update({ status: 'requires_account_setup', error_message, completed_at })`
--      call. Because that column didn't exist, PostgREST rejected the WHOLE
--      request (not just the one field) and the code never checks the
--      update's `{ error }` return -- so items that should have transitioned
--      to 'requires_account_setup' never actually persisted that status,
--      completed_at, or the reason. The SkipError and generic-Error branches
--      never even attempted to write a reason, so the near-universal terminal
--      states ('skipped', 'failed') have carried zero diagnostic information
--      in the database since this pipeline was built -- the exact gap that
--      made the 2026-08-04 "ready org ends failed, undiagnosed" finding in
--      AGENT_VERIFICATION_LOG.md/memory impossible to root-cause without
--      direct Railway console log access.
--
--   2. risk_score integer / risk_factors jsonb -- these were already added by
--      supabase/migrations/052_governance_layer.sql's
--      `ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS risk_score/
--      risk_factors`, but per project memory
--      (benavora-risk-score-columns-missing-silent-write-failure) and a fresh
--      live OpenAPI check this session, that migration's submission_queue
--      statements were never actually applied to production (same
--      "some of a migration's DDL landed, some didn't" pattern as migration
--      124). worker/queue-processor.ts's risk-engine 'manual' route
--      (~line 1004-1012) writes these on every high/critical-risk item and
--      never checks that update's error either.
--
-- Using targeted ALTER TABLE statements (not re-running 052's block), since
-- most of that migration's other tables/columns already exist live -- a
-- blanket re-run would be redundant noise for everything except these two
-- columns.

ALTER TABLE submission_queue
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE submission_queue
  ADD COLUMN IF NOT EXISTS risk_score integer;

ALTER TABLE submission_queue
  ADD COLUMN IF NOT EXISTS risk_factors jsonb;
