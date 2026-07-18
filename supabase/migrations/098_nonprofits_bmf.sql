-- 098_nonprofits_bmf.sql
-- Dedicated prospecting table for the full IRS Business Master File (BMF)
-- import (~1.8M active 501(c)(3) records), separate from foundation_directory.
-- See STANDING_DIRECTIVES.md Directive 2, Phase A.

CREATE TABLE IF NOT EXISTS nonprofits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ein text UNIQUE NOT NULL,
  name text NOT NULL,
  city text,
  state text,
  zip text,
  ntee_code text,
  subsection_code text,
  foundation_type text,
  ruling_date text,
  revenue_amount numeric,
  asset_amount numeric,
  income_amount numeric,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nonprofits_ein ON nonprofits(ein);
CREATE INDEX IF NOT EXISTS idx_nonprofits_state ON nonprofits(state);
CREATE INDEX IF NOT EXISTS idx_nonprofits_ntee ON nonprofits(ntee_code);
