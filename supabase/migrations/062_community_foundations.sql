CREATE TABLE IF NOT EXISTS community_foundation_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  website text NOT NULL,
  grants_page text,
  state text,
  estimated_assets numeric(14,2),
  programs_found jsonb DEFAULT '[]',
  last_checked_at timestamptz,
  last_snapshot text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comm_foundation_state ON community_foundation_registry(state);
