-- Migration 081: foundation_profiles - computed profile cache for foundation_directory
-- entries (avg grant size, geographic focus, funding categories). Mirrors
-- foundation_directory itself: no organization_id / RLS, since it's a shared,
-- admin-managed derived dataset rather than tenant data (see migration 046).

CREATE TABLE IF NOT EXISTS foundation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foundation_id uuid REFERENCES foundation_directory(id) ON DELETE CASCADE,
  avg_grant_size numeric,
  geographic_focus text,
  funding_categories text[],
  computed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foundation_profiles_foundation_id ON foundation_profiles(foundation_id);
