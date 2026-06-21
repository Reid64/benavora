-- These tables are NOT org-scoped. They are admin-only, platform-level tables.

CREATE TABLE IF NOT EXISTS sending_domains (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'resend',
  api_key_encrypted text,
  dns_verified boolean DEFAULT false,
  warmup_status text DEFAULT 'cold',
  warmup_started_at timestamptz,
  current_daily_limit integer DEFAULT 5,
  target_daily_limit integer DEFAULT 50,
  warmup_day integer DEFAULT 0,
  total_sent integer DEFAULT 0,
  total_bounced integer DEFAULT 0,
  total_complained integer DEFAULT 0,
  bounce_rate numeric(5,4) DEFAULT 0,
  complaint_rate numeric(5,4) DEFAULT 0,
  is_active boolean DEFAULT true,
  health_status text DEFAULT 'unknown',
  last_health_check_at timestamptz,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
-- No RLS: admin-only table

CREATE TABLE IF NOT EXISTS prospect_lists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  source text,
  total_prospects integer DEFAULT 0,
  imported_at timestamptz DEFAULT NOW(),
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id uuid REFERENCES prospect_lists(id) ON DELETE CASCADE,
  ein text,
  org_name text NOT NULL,
  org_type text,
  email text,
  website text,
  city text,
  state text,
  zip text,
  annual_revenue numeric(14,2),
  employee_count integer,
  ntee_code text,
  subsection_code text,
  status text DEFAULT 'active',
  suppressed boolean DEFAULT false,
  suppressed_reason text,
  suppressed_at timestamptz,
  last_contacted_at timestamptz,
  total_emails_sent integer DEFAULT 0,
  has_replied boolean DEFAULT false,
  has_converted boolean DEFAULT false,
  converted_org_id uuid,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE(list_id, ein)
);

CREATE TABLE IF NOT EXISTS sales_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  list_id uuid REFERENCES prospect_lists(id),
  status text DEFAULT 'draft',
  sending_domain_ids uuid[] DEFAULT '{}',
  daily_send_target integer DEFAULT 20,
  send_window_start integer DEFAULT 9,
  send_window_end integer DEFAULT 17,
  send_timezone text DEFAULT 'America/Chicago',
  total_sent integer DEFAULT 0,
  total_opened integer DEFAULT 0,
  total_replied integer DEFAULT 0,
  total_unsubscribed integer DEFAULT 0,
  total_bounced integer DEFAULT 0,
  filter_criteria jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_campaign_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES sales_campaigns(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  delay_days integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_sends (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES sales_campaigns(id),
  step_id uuid NOT NULL REFERENCES sales_campaign_steps(id),
  prospect_id uuid NOT NULL REFERENCES prospects(id),
  sending_domain_id uuid REFERENCES sending_domains(id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body_html text,
  status text DEFAULT 'queued',
  sent_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  bounce_type text,
  unsubscribed_at timestamptz,
  resend_message_id text,
  error_message text,
  scheduled_for timestamptz,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppression_list (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  reason text NOT NULL,
  source text,
  added_at timestamptz DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_prospects_list ON prospects(list_id);
CREATE INDEX idx_prospects_status ON prospects(status) WHERE suppressed = false;
CREATE INDEX idx_prospects_email ON prospects(email);
CREATE INDEX idx_prospects_state ON prospects(state);
CREATE INDEX idx_sales_sends_campaign ON sales_sends(campaign_id);
CREATE INDEX idx_sales_sends_status ON sales_sends(status);
CREATE INDEX idx_sales_sends_scheduled ON sales_sends(scheduled_for) WHERE status = 'queued';
CREATE INDEX idx_suppression_email ON suppression_list(email);
