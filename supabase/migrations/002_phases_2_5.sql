-- ============================================================
-- BENAVORA — Migration 002: Phases 2-5 Schema Extensions
-- Apply AFTER 001_initial_schema.sql
-- ============================================================

-- New enums
CREATE TYPE automation_status AS ENUM (
  'pending', 'in_progress', 'awaiting_approval', 'approved',
  'submitted', 'failed', 'cancelled'
);

CREATE TYPE subscription_tier AS ENUM ('free', 'starter', 'professional', 'enterprise');

CREATE TYPE audit_action AS ENUM (
  'create', 'update', 'delete', 'login', 'logout',
  'export', 'invite', 'role_change', 'billing_change',
  'agent_run', 'submission'
);

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

-- ============================================================
-- Phase 2: Research Agent Tables
-- ============================================================

-- Cache for web fetches to avoid re-scraping
CREATE TABLE research_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  url text NOT NULL,
  content text,
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status_code integer,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_research_cache_url ON research_cache(organization_id, url);
CREATE INDEX idx_research_cache_expires ON research_cache(expires_at);

ALTER TABLE research_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "research_cache_org_isolation" ON research_cache
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- Phase 3: Browser Automation Tables
-- ============================================================

CREATE TABLE automation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  status automation_status NOT NULL DEFAULT 'pending',
  target_url text,
  mapped_fields jsonb DEFAULT '[]',
  unmapped_fields jsonb DEFAULT '[]',
  confirmation_number text,
  error_message text,
  notes text,
  started_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_auto_sessions_org ON automation_sessions(organization_id);
CREATE INDEX idx_auto_sessions_app ON automation_sessions(application_id);
CREATE INDEX idx_auto_sessions_status ON automation_sessions(status);

ALTER TABLE automation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_sessions_org_isolation" ON automation_sessions
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE TABLE automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES automation_sessions(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  action text NOT NULL, -- 'navigate', 'detect_form', 'fill_field', 'upload_file', 'screenshot', 'submit'
  description text,
  status text DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'skipped'
  input_data jsonb,
  output_data jsonb,
  error_message text,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_auto_steps_session ON automation_steps(session_id);

-- automation_steps has no organization_id of its own; scope it through its
-- parent session (mirrors the campaign_steps -> email_campaigns policy). Without
-- this, an authenticated org member cannot read their own session's steps.
ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_steps_org_isolation" ON automation_steps
  USING (
    session_id IN (
      SELECT id FROM automation_sessions
      WHERE organization_id = public.current_org_id()
    )
  );

CREATE TABLE automation_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES automation_sessions(id) ON DELETE CASCADE,
  step_id uuid REFERENCES automation_steps(id) ON DELETE SET NULL,
  storage_path text NOT NULL, -- Supabase Storage path
  description text,
  page_url text,
  captured_at timestamptz DEFAULT now()
);

CREATE INDEX idx_auto_screenshots_session ON automation_screenshots(session_id);

-- Same parent-scoped isolation for screenshots (no organization_id column).
ALTER TABLE automation_screenshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automation_screenshots_org_isolation" ON automation_screenshots
  USING (
    session_id IN (
      SELECT id FROM automation_sessions
      WHERE organization_id = public.current_org_id()
    )
  );

-- ============================================================
-- Phase 4: Email + Calendar Integration Tables
-- ============================================================

-- OAuth tokens and integration settings
CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider text NOT NULL, -- 'google', 'stripe', etc.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_email text,
  scopes text[],
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_integrations_org_provider ON integrations(organization_id, provider);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "integrations_org_isolation" ON integrations
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Synced email threads from Gmail
CREATE TABLE synced_email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  gmail_thread_id text NOT NULL, -- Gmail's thread ID
  subject text,
  snippet text,
  last_message_at timestamptz,
  message_count integer DEFAULT 0,
  is_read boolean DEFAULT false,
  labels text[], -- Gmail labels
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_threads_gmail ON synced_email_threads(organization_id, gmail_thread_id);
CREATE INDEX idx_email_threads_org ON synced_email_threads(organization_id);

ALTER TABLE synced_email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synced_email_threads_org_isolation" ON synced_email_threads
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Individual email messages
CREATE TABLE synced_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  thread_id uuid NOT NULL REFERENCES synced_email_threads(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  from_email text,
  from_name text,
  to_emails text[],
  cc_emails text[],
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  has_attachments boolean DEFAULT false,
  attachment_names text[],
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_messages_gmail ON synced_email_messages(organization_id, gmail_message_id);
CREATE INDEX idx_email_messages_thread ON synced_email_messages(thread_id);

ALTER TABLE synced_email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synced_email_messages_org_isolation" ON synced_email_messages
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Junction: link email threads to CRM records
CREATE TABLE email_thread_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  thread_id uuid NOT NULL REFERENCES synced_email_threads(id) ON DELETE CASCADE,
  funder_id uuid REFERENCES funders(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  outreach_contact_id uuid REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  match_type text NOT NULL, -- 'auto_email', 'auto_domain', 'manual'
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_email_links_thread ON email_thread_links(thread_id);
CREATE INDEX idx_email_links_funder ON email_thread_links(funder_id);
CREATE INDEX idx_email_links_contact ON email_thread_links(contact_id);

ALTER TABLE email_thread_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_thread_links_org_isolation" ON email_thread_links
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Add calendar event ID to deadlines
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS google_calendar_event_id text;

-- ============================================================
-- Phase 5: SaaS Tables
-- ============================================================

-- Subscription records (mirrors Stripe data)
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  tier subscription_tier NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active', -- 'active', 'past_due', 'cancelled', 'trialing'
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_subscriptions_org ON subscriptions(organization_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_org_isolation" ON subscriptions
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Invoice records
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  stripe_invoice_id text UNIQUE,
  amount_cents integer NOT NULL,
  currency text DEFAULT 'usd',
  status text NOT NULL, -- 'paid', 'open', 'void', 'uncollectible'
  description text,
  invoice_url text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_invoices_org ON invoices(organization_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_org_isolation" ON invoices
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Daily usage tracking
CREATE TABLE usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  metric_date date NOT NULL DEFAULT CURRENT_DATE,
  metric_name text NOT NULL, -- 'agent_runs', 'api_calls', 'email_sends', 'storage_bytes'
  metric_value bigint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_usage_metrics_unique ON usage_metrics(organization_id, metric_date, metric_name);
CREATE INDEX idx_usage_metrics_org ON usage_metrics(organization_id);

ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_metrics_org_isolation" ON usage_metrics
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Audit logs
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES profiles(id),
  action audit_action NOT NULL,
  entity_type text, -- 'funder', 'application', 'user', 'setting', etc.
  entity_id uuid,
  details jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_date ON audit_logs(created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_org_isolation" ON audit_logs
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- User invitations
CREATE TABLE user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status invitation_status NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES profiles(id),
  accepted_by uuid REFERENCES profiles(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_invitations_token ON user_invitations(token);
CREATE INDEX idx_invitations_org ON user_invitations(organization_id);
CREATE INDEX idx_invitations_email ON user_invitations(email);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_invitations_org_isolation" ON user_invitations
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Onboarding progress
CREATE TABLE onboarding_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  step_number integer NOT NULL,
  step_name text NOT NULL,
  is_completed boolean DEFAULT false,
  completed_at timestamptz,
  step_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_onboarding_org_step ON onboarding_steps(organization_id, step_number);

ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_steps_org_isolation" ON onboarding_steps
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- Seed new feature flags for existing organizations
-- ============================================================
INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.research_agents', 'true' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.browser_automation', 'true' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.email_integration', 'false' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.cold_outreach_email', 'false' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.stripe_billing', 'false' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'research.daily_quota', '100' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'onboarding.completed', 'true' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;
