-- ============================================================
-- BENAVORA — Migration 018: Email Activity
-- Apply AFTER 017_success_patterns.sql
--
-- Adds an email_activity table to store AI-classified email
-- metadata produced by the EmailParserAgent. Each row records
-- one inbound email parsed by the agent: its classification,
-- extracted funder/opportunity references, action requirements,
-- and urgency. Phase 4 Gmail sync will populate this table
-- automatically; for now the manual EmailParserWidget is the
-- entry point.
--
-- Also adds the email_parser agent type to the agent_type enum
-- so BaseAgent can log runs to agent_runs.
-- ============================================================

-- Add email_parser to the agent_type enum so the agent can
-- write its runs to agent_runs via BaseAgent (Contracts §15).
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'email_parser';

-- ------------------------------------------------------------
-- email_activity — one row per parsed email per organization.
-- ------------------------------------------------------------
CREATE TABLE email_activity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  funder_id         uuid REFERENCES funders(id) ON DELETE SET NULL,
  opportunity_id    uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  application_id    uuid REFERENCES applications(id) ON DELETE SET NULL,
  email_type        text NOT NULL,
  subject           text,
  sender            text,
  received_at       timestamptz,
  summary           text,
  action_required   boolean DEFAULT false,
  action_description text,
  urgency           text DEFAULT 'low',
  thread_id         text,
  processed_at      timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_email_activity_org         ON email_activity (organization_id);
CREATE INDEX idx_email_activity_funder      ON email_activity (funder_id);
CREATE INDEX idx_email_activity_email_type  ON email_activity (email_type);

-- ------------------------------------------------------------
-- RLS — org isolation (master pattern, Migration 001).
-- ------------------------------------------------------------
ALTER TABLE email_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_activity_org_isolation" ON email_activity
  USING (organization_id = public.current_org_id());

-- ============================================================
-- END Migration 018
-- ============================================================
