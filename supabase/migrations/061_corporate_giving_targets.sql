CREATE TABLE IF NOT EXISTS corporate_giving_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  website text NOT NULL,
  giving_page text,
  program_names text[],
  geographic_focus text[],
  funding_areas text[],
  estimated_annual_giving numeric(14,2),
  application_url text,
  last_checked_at timestamptz,
  last_snapshot text,
  change_history jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corp_giving_active ON corporate_giving_targets(is_active);
