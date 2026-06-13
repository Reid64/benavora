-- ============================================================================
-- Migration 020 — automation_sessions enhancements
--
-- Extends automation_sessions (created in migration 002) with:
--   - session_type enum + column for classifying the kind of run
--   - steps jsonb array cache (denormalised from automation_steps for fast reads)
--   - screenshots text array (paths inside the org Supabase Storage bucket)
--   - approval_required_at timestamp for the human-approval gate
--
-- automation_steps and automation_screenshots already exist (migration 002) and
-- are the authoritative step/screenshot stores. The new columns are lightweight
-- caches updated by session-manager.ts so the approval UI avoids multiple joins.
-- ============================================================================

-- Session classification enum
DO $$ BEGIN
  CREATE TYPE session_type AS ENUM ('form_fill', 'document_upload', 'portal_login');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE automation_sessions
  ADD COLUMN IF NOT EXISTS session_type session_type,
  ADD COLUMN IF NOT EXISTS steps        jsonb        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS screenshots  text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS approval_required_at timestamptz;

-- Fast filter on session_type for dashboards / queues
CREATE INDEX IF NOT EXISTS idx_auto_sessions_type
  ON automation_sessions(organization_id, session_type);

-- Fast lookup of sessions pending human approval
CREATE INDEX IF NOT EXISTS idx_auto_sessions_approval
  ON automation_sessions(organization_id, approval_required_at)
  WHERE approval_required_at IS NOT NULL;

-- ============================================================================
-- RLS for automation_steps and automation_screenshots
--
-- These tables have no organization_id column — they are scoped via session_id
-- to an automation_sessions row that is already org-scoped. The policies below
-- allow users to read/write rows whose parent session belongs to their org, and
-- service-role bypasses these for admin reads.
-- ============================================================================

ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_screenshots ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated org member to read their own session's steps.
CREATE POLICY IF NOT EXISTS "Users can read own session steps"
  ON automation_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM automation_sessions s
      WHERE s.id = automation_steps.session_id
        AND s.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    )
  );

-- Allow insert for session's org (used by session-manager.ts recordStep).
CREATE POLICY IF NOT EXISTS "Users can insert own session steps"
  ON automation_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM automation_sessions s
      WHERE s.id = session_id
        AND s.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    )
  );

-- Allow any authenticated org member to read their own session's screenshots.
CREATE POLICY IF NOT EXISTS "Users can read own session screenshots"
  ON automation_screenshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM automation_sessions s
      WHERE s.id = automation_screenshots.session_id
        AND s.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    )
  );

-- Allow insert for session's org (used by session-manager.ts recordScreenshot).
CREATE POLICY IF NOT EXISTS "Users can insert own session screenshots"
  ON automation_screenshots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM automation_sessions s
      WHERE s.id = session_id
        AND s.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    )
  );
