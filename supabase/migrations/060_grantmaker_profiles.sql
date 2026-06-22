CREATE TABLE IF NOT EXISTS intelligence_grantmaker_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  foundation_id uuid UNIQUE REFERENCES foundation_directory(id),
  ein text,
  name text NOT NULL,
  avg_award_amount numeric(12,2),
  total_annual_giving numeric(14,2),
  geographic_focus text[],
  program_priorities text[],
  typical_award_range jsonb,
  language_patterns text[],
  application_url text,
  last_profiled_at timestamptz,
  profile_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_grantmaker_profiles_ein ON intelligence_grantmaker_profiles(ein);
CREATE INDEX idx_grantmaker_profiles_geo ON intelligence_grantmaker_profiles USING gin(geographic_focus);
