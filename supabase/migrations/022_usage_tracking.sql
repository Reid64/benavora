-- 022_usage_tracking.sql
-- Per-resource usage tracking for tier limit enforcement (usage-limiter.ts).
-- Tracks monthly (opportunities, applications, ai_drafts) and daily (agent_runs)
-- consumption per organization. Complements usage_metrics (002_phases_2_5.sql).

CREATE TABLE IF NOT EXISTS usage_tracking (
  id            uuid      DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type text      NOT NULL,
  period_start  date      NOT NULL,
  period_end    date      NOT NULL,
  count         integer   NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT usage_tracking_org_resource_period
    UNIQUE (organization_id, resource_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_lookup
  ON usage_tracking (organization_id, resource_type, period_start);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Org members can read their own usage (settings dashboard, API).
CREATE POLICY "usage_tracking_select_own_org" ON usage_tracking
  FOR SELECT USING (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Writers and up can insert new period rows for their own org.
CREATE POLICY "usage_tracking_insert_own_org" ON usage_tracking
  FOR INSERT WITH CHECK (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Writers and up can increment counts for their own org.
CREATE POLICY "usage_tracking_update_own_org" ON usage_tracking
  FOR UPDATE USING (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Atomic increment: INSERT ... ON CONFLICT DO UPDATE avoids read-modify-write races.
-- SECURITY INVOKER (default) keeps RLS enforcement on the calling user's behalf.
CREATE OR REPLACE FUNCTION increment_usage_tracking(
  p_org_id        uuid,
  p_resource_type text,
  p_period_start  date,
  p_period_end    date,
  p_amount        integer DEFAULT 1
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO usage_tracking
    (organization_id, resource_type, period_start, period_end, count)
  VALUES
    (p_org_id, p_resource_type, p_period_start, p_period_end, p_amount)
  ON CONFLICT (organization_id, resource_type, period_start)
  DO UPDATE SET
    count      = usage_tracking.count + p_amount,
    updated_at = now();
END;
$$;
