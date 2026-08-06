-- Migration 115: AutoApply CAPTCHA / verification-challenge pause columns
-- Per AUTOAPPLY_ARCHITECTURE_V2.md §10B (Human-Safety & Confirmation Systems,
-- added August 6, 2026). Supersedes BEHAVIORAL_CONTRACTS.md §24's old 2Captcha
-- auto-solve contract: Benavora no longer solves CAPTCHAs or verification
-- challenges. Every detection now pauses the submission_queue item for a
-- human, unconditionally, regardless of TWOCAPTCHA_API_KEY configuration.
--
-- These columns record the exact state transition on detection (worker/queue-
-- processor.ts): status flips to 'paused_verification', a reason + timestamp +
-- screenshot path are recorded, every pause event is appended to paused_history
-- (a queue item can be paused more than once across resume attempts), and
-- resume_count tracks how many times a human has clicked resume (§10C, not
-- built in this migration -- that UI/action is a separate build step).
--
-- 'paused_verification' is not a CHECK-constrained enum value -- submission_queue.status
-- is a plain text column (confirmed live via PostgREST OpenAPI before writing this
-- migration), consistent with the existing pending/processing/queued/failed/paused/
-- completed/skipped/requires_account_setup values already used as plain strings.

ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS paused_screenshot_path text;
ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS paused_history jsonb DEFAULT '[]'::jsonb;
ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS resume_count integer DEFAULT 0;
