-- 117_submission_queue_status_check_fix.sql
--
-- Found live while building §10C's Human Review Queue UI (116_review_queue_
-- rpc_functions.sql): submission_queue_status_check only allowed ('pending',
-- 'processing', 'completed', 'failed', 'skipped') -- confirmed live via
-- pg_get_constraintdef(), not assumed. This is stale against the values the
-- live application code already writes to this exact column:
--   - worker/queue-processor.ts sets 'paused_verification' on CAPTCHA/
--     verification detection (§10B, 115_autoapply_captcha_pause_columns.sql)
--     -- meaning that write has been failing in production ever since the
--     queue-21 CAPTCHA-pause chain shipped, reproduced live: an INSERT with
--     status='paused_verification' raises "violates check constraint
--     submission_queue_status_check".
--   - worker/queue-processor.ts also sets 'requires_account_setup' (line 328)
--     and 'pending_manual' (line 1008), both already live-shipped, both also
--     blocked by the same stale constraint.
--
-- Widened to the full real set, confirmed by grepping every literal
-- `status:` assignment against submission_queue in worker/queue-processor.ts
-- (the only writer) plus 'paused_verification' (§10B) which was missing
-- from that same file's live-written set until this fix.
--
-- Deliberately NOT adding 'queued': AUTOAPPLY_ARCHITECTURE_V2.md §10C's own
-- literal resume SQL sets status='queued', but worker/queue-processor.ts's
-- real poll/claim query (dequeue(), ~line 408) only ever selects
-- .eq('status', 'pending') -- confirmed live by reading the function body.
-- Setting 'queued' on resume would pass this constraint but then sit
-- forever, never claimed by the real worker -- directly contradicting
-- §10C's own stated intent ("Resuming means retry from the top... a fresh
-- page navigation on the next queue pass"). 116_review_queue_rpc_functions.sql's
-- resume_paused_submission_queue_item() sets 'pending' instead, matching
-- what the real worker actually polls for; 'queued' is not added to the
-- constraint since nothing in this codebase writes it to this column.

ALTER TABLE submission_queue DROP CONSTRAINT submission_queue_status_check;

ALTER TABLE submission_queue ADD CONSTRAINT submission_queue_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'processing'::text,
    'completed'::text,
    'failed'::text,
    'skipped'::text,
    'paused_verification'::text,
    'requires_account_setup'::text,
    'pending_manual'::text
  ]));
