-- Migration 046: Foundation Directory (IRS BMF public reference data)
-- NO RLS: this is shared public reference data across all tenants

CREATE TABLE IF NOT EXISTS foundation_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ein text NOT NULL,
  name text NOT NULL,
  dba text,
  city text,
  state text,
  zip text,
  ntee_code text,
  subsection_code text,
  foundation_type text,
  revenue_amount numeric(14,2),
  asset_amount numeric(14,2),
  ruling_date text,
  tax_period text,
  activity_codes text,
  organization_type text,
  status text,
  website text,
  email text,
  phone text,
  giving_total numeric(14,2),
  geographic_focus text,
  imported_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT foundation_directory_ein_unique UNIQUE (ein)
);

CREATE INDEX IF NOT EXISTS idx_foundation_directory_state ON foundation_directory(state);
CREATE INDEX IF NOT EXISTS idx_foundation_directory_ntee_code ON foundation_directory(ntee_code);
CREATE INDEX IF NOT EXISTS idx_foundation_directory_subsection ON foundation_directory(subsection_code);
CREATE INDEX IF NOT EXISTS idx_foundation_directory_name_fts ON foundation_directory USING gin(to_tsvector('english', name));
