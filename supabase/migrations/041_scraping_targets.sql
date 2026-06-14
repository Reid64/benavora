-- Migration 041: scraping_targets table (SCHEMA_REGISTRY v2.0 §2.49)
-- Client-assigned URLs for scheduled AI-powered web scraping.
-- Auto-paused after 5 consecutive failures (BEHAVIORAL_CONTRACTS §21).

CREATE TABLE IF NOT EXISTS scraping_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  url text NOT NULL,
  description text,
  scrape_schedule text NOT NULL DEFAULT 'weekly'
    CHECK (scrape_schedule IN ('hourly', 'daily', 'weekly', 'monthly')),
  last_scraped_at timestamptz,
  last_success_at timestamptz,
  failure_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE scraping_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scraping_targets_org" ON scraping_targets
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX idx_scrape_targets_org ON scraping_targets(organization_id);
CREATE INDEX idx_scrape_targets_active ON scraping_targets(organization_id, is_active);
