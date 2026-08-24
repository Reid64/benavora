-- ============================================================================
-- Migration 148 -- submission_queue.automation_session_id
--
-- WGR-167: POST /api/agents/automation (AGENTS.md Agent 16) used to launch
-- BrowserAutomationAgent (Playwright) directly inside the Vercel serverless
-- function, which has no Chromium binary and always fails. The Railway
-- worker (worker/queue-processor.ts) already has Playwright installed and
-- already polls submission_queue, so the route now creates the
-- automation_sessions row and enqueues a submission_queue row pointing back
-- at it; the worker claims it exactly like any other submission_queue row
-- and runs BrowserAutomationAgent itself, where Playwright actually works.
--
-- automation_session_id is nullable and additive: existing submission_queue
-- rows (the funder/request_profile-driven pipeline) are unaffected, and the
-- worker's generic processItem() path is untouched. A dedicated automation
-- worker branch (queue-processor.ts) only engages when this column is set.
-- ============================================================================

ALTER TABLE submission_queue
  ADD COLUMN IF NOT EXISTS automation_session_id uuid
    REFERENCES automation_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submission_queue_automation_session
  ON submission_queue(automation_session_id)
  WHERE automation_session_id IS NOT NULL;
