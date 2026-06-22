CREATE TYPE enrichment_job_status AS ENUM ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled');
CREATE TYPE enrichment_source AS ENUM ('irs_990', 'propublica', 'web_search', 'website_scrape', 'manual');

-- Enrichment job tracking
CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  job_type text NOT NULL DEFAULT 'foundation_enrichment',
  status enrichment_job_status DEFAULT 'queued',
  target_table text NOT NULL,
  total_records integer DEFAULT 0,
  processed integer DEFAULT 0,
  enriched integer DEFAULT 0,
  failed integer DEFAULT 0,
  skipped integer DEFAULT 0,
  sources_used enrichment_source[] DEFAULT '{}',
  config jsonb DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz,
  last_processed_id text,
  error_log jsonb DEFAULT '[]',
  results_summary jsonb DEFAULT '{}',
  created_by uuid,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_enrichment_jobs_status ON enrichment_jobs(status);
CREATE INDEX idx_enrichment_jobs_org ON enrichment_jobs(organization_id);

-- Per-record enrichment results (what was found for each entity)
CREATE TABLE IF NOT EXISTS enrichment_results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  entity_name text,
  entity_ein text,
  source enrichment_source NOT NULL,
  found_website text,
  found_emails text[] DEFAULT '{}',
  found_phones text[] DEFAULT '{}',
  found_officers jsonb DEFAULT '[]',
  found_revenue numeric(14,2),
  found_assets numeric(14,2),
  found_giving numeric(14,2),
  found_programs text[],
  found_address jsonb,
  confidence numeric(3,2) DEFAULT 0,
  raw_data jsonb DEFAULT '{}',
  applied_to_db boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_enrichment_results_job ON enrichment_results(job_id);
CREATE INDEX idx_enrichment_results_entity ON enrichment_results(entity_ein);

-- Add columns to foundation_directory if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'enriched_at') THEN
    ALTER TABLE foundation_directory ADD COLUMN enriched_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'enrichment_source') THEN
    ALTER TABLE foundation_directory ADD COLUMN enrichment_source text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'officers') THEN
    ALTER TABLE foundation_directory ADD COLUMN officers jsonb DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'programs') THEN
    ALTER TABLE foundation_directory ADD COLUMN programs text[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'contact_emails') THEN
    ALTER TABLE foundation_directory ADD COLUMN contact_emails text[] DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'contact_phones') THEN
    ALTER TABLE foundation_directory ADD COLUMN contact_phones text[] DEFAULT '{}';
  END IF;
END $$;
