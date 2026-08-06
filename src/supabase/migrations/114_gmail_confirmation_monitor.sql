-- 114_gmail_confirmation_monitor.sql
--
-- AUTOAPPLY_ARCHITECTURE_V2.md §10A "Gmail Confirmation Monitor" — schema for the
-- read-only apply@benavora.com inbox poller. Two new platform-level tables, plus
-- two columns added to the existing autoapply_submissions table that the matching
-- algorithm reads/writes but that had no home in either new table (§10A step 4/5:
-- "update the matched row — confirmation_email_received = true, confirmation_number
-- ..., confirmation_received_at = now()"). Neither column existed anywhere in the
-- schema before this migration — confirmed by grep before writing this file.
--
-- RLS posture: both new tables are platform/service-level infrastructure with no
-- organization_id column (a Gmail message can match candidates across any org, and
-- the monitor itself runs under the Railway worker's service-role credentials only
-- — no dashboard user queries these tables directly). Same posture already used for
-- scrape_jobs/scrape_results (110_scrape_jobs_universal_scraper.sql), worker_status
-- (047), and queue_controls (052): RLS enabled with no permissive policy (blocks
-- anon/authenticated under Postgres RLS semantics) PLUS an explicit REVOKE, since
-- TRUNCATE is never governed by row-security policy and this project's public
-- schema auto-grants full anon/authenticated CRUD on every new table by default
-- (ANON_GRANT_AUDIT.md) — do not rely on RLS alone.
--
-- autoapply_submissions already has RLS + org-scoped policies from migration 045;
-- adding two nullable/defaulted columns to it does not change that posture.

CREATE TABLE IF NOT EXISTS autoapply_confirmation_processed_messages (
  gmail_message_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now(),
  match_status text NOT NULL CHECK (match_status IN ('matched', 'ambiguous', 'no_match')),
  matched_submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_autoapply_confirmation_processed_messages_processed_at
  ON autoapply_confirmation_processed_messages(processed_at);

CREATE TABLE IF NOT EXISTS autoapply_confirmation_ambiguous_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id text NOT NULL,
  candidate_submission_ids uuid[] NOT NULL,
  sender text,
  subject text,
  received_at timestamptz,
  status text NOT NULL DEFAULT 'needs_manual_match'
    CHECK (status IN ('needs_manual_match', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autoapply_confirmation_ambiguous_matches_status
  ON autoapply_confirmation_ambiguous_matches(status, received_at);
CREATE INDEX IF NOT EXISTS idx_autoapply_confirmation_ambiguous_matches_message_id
  ON autoapply_confirmation_ambiguous_matches(gmail_message_id);

ALTER TABLE autoapply_submissions
  ADD COLUMN IF NOT EXISTS confirmation_email_received boolean NOT NULL DEFAULT false;
ALTER TABLE autoapply_submissions
  ADD COLUMN IF NOT EXISTS confirmation_received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_confirmation_pending
  ON autoapply_submissions(submitted_at)
  WHERE confirmation_email_received = false;

ALTER TABLE autoapply_confirmation_processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoapply_confirmation_ambiguous_matches ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: service-role only, see posture note above.

REVOKE ALL ON autoapply_confirmation_processed_messages FROM anon, authenticated;
REVOKE ALL ON autoapply_confirmation_ambiguous_matches FROM anon, authenticated;
