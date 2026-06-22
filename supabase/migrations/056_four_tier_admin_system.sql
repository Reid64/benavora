-- =====================================================
-- TIER 1 & 2: Platform-level types and tables
-- =====================================================

CREATE TYPE platform_role AS ENUM ('platform_owner', 'staff_admin', 'staff_support', 'staff_readonly');

CREATE TYPE staff_permission AS ENUM (
  'tenant_view', 'tenant_manage', 'tenant_impersonate',
  'billing_view', 'billing_manage',
  'feature_flags_view', 'feature_flags_manage',
  'staff_view', 'staff_manage',
  'queue_view', 'queue_manage', 'queue_emergency_stop',
  'analytics_view', 'error_view', 'error_resolve',
  'sales_outreach_view', 'sales_outreach_manage',
  'system_health_view', 'audit_log_view'
);

CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'blocked', 'completed', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Platform admin accounts — NOT linked to any org
CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email text NOT NULL,
  full_name text NOT NULL,
  platform_role platform_role NOT NULL DEFAULT 'staff_readonly',
  permissions staff_permission[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  invited_by uuid REFERENCES platform_admins(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_platform_admins_user ON platform_admins(user_id);

-- Staff task system
CREATE TABLE IF NOT EXISTS platform_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES platform_admins(id),
  assigned_by uuid REFERENCES platform_admins(id),
  status task_status DEFAULT 'open',
  priority task_priority DEFAULT 'medium',
  category text DEFAULT 'general',
  related_tenant_id uuid REFERENCES organizations(id),
  related_entity_type text,
  related_entity_id uuid,
  due_date timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_platform_tasks_assigned ON platform_tasks(assigned_to);
CREATE INDEX idx_platform_tasks_status ON platform_tasks(status);

-- Impersonation audit
CREATE TABLE IF NOT EXISTS impersonation_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES platform_admins(id),
  target_org_id uuid NOT NULL REFERENCES organizations(id),
  target_user_id uuid,
  started_at timestamptz DEFAULT NOW(),
  ended_at timestamptz,
  reason text NOT NULL,
  actions_taken text[]
);
CREATE INDEX idx_impersonation_admin ON impersonation_log(admin_id);

-- System error aggregation
CREATE TABLE IF NOT EXISTS system_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  error_type text NOT NULL,
  message text NOT NULL,
  stack_trace text,
  organization_id uuid REFERENCES organizations(id),
  user_id uuid,
  route text,
  request_body jsonb,
  severity text DEFAULT 'error',
  is_resolved boolean DEFAULT false,
  resolved_by uuid REFERENCES platform_admins(id),
  resolved_at timestamptz,
  resolution_notes text,
  occurrence_count integer DEFAULT 1,
  first_seen_at timestamptz DEFAULT NOW(),
  last_seen_at timestamptz DEFAULT NOW(),
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_system_errors_resolved ON system_errors(is_resolved, last_seen_at DESC);
CREATE INDEX idx_system_errors_source ON system_errors(source);

-- AI usage tracking (per request, per org)
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  model text NOT NULL,
  endpoint text NOT NULL,
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  estimated_cost_cents integer DEFAULT 0,
  duration_ms integer,
  agent_type text,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_ai_usage_org ON ai_usage_log(organization_id);
CREATE INDEX idx_ai_usage_date ON ai_usage_log(created_at);

-- =====================================================
-- TIER 3: Tenant admin enhancements
-- =====================================================

-- Team activity log (tracks what each tenant user does)
CREATE TABLE IF NOT EXISTS team_activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW()
);
ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_activity_org" ON team_activity_log USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX idx_team_activity_org ON team_activity_log(organization_id);
CREATE INDEX idx_team_activity_user ON team_activity_log(user_id);
CREATE INDEX idx_team_activity_date ON team_activity_log(created_at DESC);

-- Org-level usage summary (materialized daily for fast tenant admin queries)
CREATE TABLE IF NOT EXISTS org_usage_summary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_date date NOT NULL,
  ai_tokens_used integer DEFAULT 0,
  ai_cost_cents integer DEFAULT 0,
  drafts_generated integer DEFAULT 0,
  submissions_attempted integer DEFAULT 0,
  submissions_succeeded integer DEFAULT 0,
  agent_runs integer DEFAULT 0,
  storage_bytes_used bigint DEFAULT 0,
  active_users integer DEFAULT 0,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, period_date)
);
ALTER TABLE org_usage_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_usage_org" ON org_usage_summary USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX idx_org_usage_org_date ON org_usage_summary(organization_id, period_date DESC);

-- No RLS on platform tables (platform_admins, platform_tasks, impersonation_log, system_errors, ai_usage_log)
-- Access controlled by platform auth middleware, not RLS
