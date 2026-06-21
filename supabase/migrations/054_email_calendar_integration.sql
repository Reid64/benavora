-- Email Integration Tables

CREATE TYPE email_sync_status AS ENUM ('active', 'paused', 'error', 'disconnected');
CREATE TYPE email_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE calendar_sync_status AS ENUM ('active', 'paused', 'error', 'disconnected');

CREATE TABLE IF NOT EXISTS email_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gmail',
  email_address text NOT NULL,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  sync_status email_sync_status DEFAULT 'disconnected',
  last_sync_at timestamptz,
  sync_cursor text,
  scopes text[],
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, email_address)
);

CREATE TABLE IF NOT EXISTS email_threads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES email_connections(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  subject text,
  snippet text,
  last_message_at timestamptz,
  message_count integer DEFAULT 0,
  is_read boolean DEFAULT true,
  labels text[],
  linked_funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  linked_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  linked_opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  linked_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  auto_linked boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, gmail_thread_id)
);

CREATE TABLE IF NOT EXISTS email_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  direction email_direction NOT NULL,
  from_address text,
  from_name text,
  to_addresses text[],
  cc_addresses text[],
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  has_attachments boolean DEFAULT false,
  attachment_count integer DEFAULT 0,
  extracted_contacts jsonb DEFAULT '[]',
  ai_summary text,
  sentiment text,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google',
  calendar_id text NOT NULL DEFAULT 'primary',
  calendar_name text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  sync_status calendar_sync_status DEFAULT 'disconnected',
  last_sync_at timestamptz,
  sync_token text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, user_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  google_event_id text,
  title text NOT NULL,
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  all_day boolean DEFAULT false,
  location text,
  event_type text DEFAULT 'deadline',
  linked_deadline_id uuid REFERENCES deadlines(id) ON DELETE SET NULL,
  linked_opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  linked_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  is_synced boolean DEFAULT false,
  recurrence_rule text,
  reminder_minutes integer[],
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, google_event_id)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  template_type text NOT NULL DEFAULT 'general',
  variables text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  use_count integer DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_campaign_sequences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL DEFAULT 'manual',
  trigger_config jsonb DEFAULT '{}',
  status campaign_status DEFAULT 'draft',
  total_enrolled integer DEFAULT 0,
  total_completed integer DEFAULT 0,
  total_replied integer DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id uuid NOT NULL REFERENCES email_campaign_sequences(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  template_id uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  subject_override text,
  body_override text,
  delay_days integer NOT NULL DEFAULT 0,
  delay_hours integer DEFAULT 0,
  condition_type text DEFAULT 'always',
  condition_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES email_campaign_sequences(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  email_address text NOT NULL,
  current_step integer DEFAULT 0,
  status text DEFAULT 'active',
  enrolled_at timestamptz DEFAULT NOW(),
  completed_at timestamptz,
  paused_at timestamptz,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  reply_detected boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE(sequence_id, email_address)
);

-- RLS on all tables
ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_conn_org" ON email_connections USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "email_threads_org" ON email_threads USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "email_messages_org" ON email_messages USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "cal_conn_org" ON calendar_connections USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "cal_events_org" ON calendar_events USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "email_templates_org" ON email_templates USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "email_sequences_org" ON email_campaign_sequences USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "email_seq_steps_org" ON email_sequence_steps USING (sequence_id IN (SELECT id FROM email_campaign_sequences WHERE organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())));
CREATE POLICY "email_enrollments_org" ON email_sequence_enrollments USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_email_threads_org ON email_threads(organization_id);
CREATE INDEX idx_email_threads_last_msg ON email_threads(last_message_at DESC);
CREATE INDEX idx_email_threads_funder ON email_threads(linked_funder_id);
CREATE INDEX idx_email_messages_thread ON email_messages(thread_id);
CREATE INDEX idx_email_messages_sent ON email_messages(sent_at DESC);
CREATE INDEX idx_cal_events_org ON calendar_events(organization_id);
CREATE INDEX idx_cal_events_start ON calendar_events(start_time);
CREATE INDEX idx_email_enrollments_next ON email_sequence_enrollments(next_send_at) WHERE status = 'active';
