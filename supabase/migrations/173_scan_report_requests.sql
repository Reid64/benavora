-- ============================================================================
-- BENAVORA - Migration 173: scan_report_requests
--
-- Backs POST /api/public/scan/capture (src/app/api/public/scan/capture/
-- route.ts), the post-report email capture step at the bottom of the public
-- Funding Potential Scan report (src/app/(marketing)/scan/ScanEmailCapture.tsx),
-- which migration 172 (scan_submissions) explicitly deferred as a separate
-- sub-prompt.
--
-- One row per visitor action (email the report / save the funding profile /
-- share it with the board) - NOT per scan_submissions row, since the same
-- visitor can trigger more than one action off a single scan. The
-- "review with a strategist" outline option is deliberately NOT stored here:
-- it is a plain link to /demo and neither collects an email nor triggers a
-- send, so there is nothing to capture for it.
--
-- Stores a snapshot of the scored result (score/tier/categories/etc.) rather
-- than only the FK, because scan_submissions itself never stores the
-- computed score (src/lib/scan/scoring-engine.ts computes it on request and
-- returns it to the client without persisting it) - without the snapshot,
-- follow-up on this table would have the visitor's stated mission/state but
-- no record of what they were actually told.
--
-- Public-schema default ACLs auto-grant anon+authenticated full CRUD on any
-- new table (see governance memory benavora-public-schema-default-acl-anon-
-- exposure), so anon's write access below is made EXPLICIT (GRANT INSERT +
-- an INSERT policy), matching migration 172's pattern: anon can INSERT and
-- nothing else - no SELECT/UPDATE/DELETE. Only a service-role client (future
-- follow-up tooling) can read this table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scan_report_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  scan_submission_id    uuid NOT NULL REFERENCES scan_submissions(id) ON DELETE CASCADE,

  email                 text NOT NULL,
  action                text NOT NULL CHECK (action IN ('email_report', 'save_profile', 'share_board')),
  board_emails          text[],

  -- Snapshot of FundingPotentialScanResult at the moment the visitor acted.
  score                 integer NOT NULL,
  tier                  text NOT NULL CHECK (tier IN ('strong', 'moderate', 'emerging', 'early_stage')),
  categories_considered text[] NOT NULL DEFAULT '{}',
  matched_count         integer NOT NULL DEFAULT 0,
  degraded              boolean NOT NULL DEFAULT false,
  amount_min            numeric,
  amount_max            numeric,

  email_send_status     text NOT NULL DEFAULT 'not_attempted'
                          CHECK (email_send_status IN ('not_attempted', 'sent', 'failed')),
  email_send_error      text,

  ip_hash               text,
  user_agent            text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_report_requests_email
  ON scan_report_requests(email);

CREATE INDEX IF NOT EXISTS idx_scan_report_requests_submission
  ON scan_report_requests(scan_submission_id);

CREATE INDEX IF NOT EXISTS idx_scan_report_requests_ip_hash_created
  ON scan_report_requests(ip_hash, created_at DESC);

ALTER TABLE scan_report_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON scan_report_requests FROM anon;
REVOKE ALL ON scan_report_requests FROM authenticated;

GRANT INSERT ON scan_report_requests TO anon;

CREATE POLICY scan_report_requests_anon_insert ON scan_report_requests
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================================
-- END Migration 173
-- ============================================================================
