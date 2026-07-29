-- 110_scrape_jobs_universal_scraper.sql
--
-- Creates scrape_jobs and scrape_results per UNIVERSAL_SCRAPER_PRD.md §3.4
-- (the generic job/result model backing the ground-up Universal Scraper
-- service, superseding the single-purpose stealth-engine.ts/foundation-
-- scraper.ts/nonprofit-scraper.ts parsers per that PRD's header).
--
-- RLS posture (not specified by the PRD's §3.4 SQL block verbatim — this
-- migration adds it per this codebase's standing convention that every
-- table gets an explicit posture, not a silent default):
--
-- This is platform/service-level infrastructure, not per-tenant application
-- data — a scrape_job is keyword+schema+status, run by the universal scraper
-- worker (Crawlee/Camoufox stack, §3.2) and written by the extraction layer
-- (§3.3) via service-role credentials only, matching the posture already
-- used for other worker-owned queues with no natural per-request end-user
-- (dd_robots_cache 068, donor_discovery_geocache 077, worker_status 047 —
-- all "no organization_id column, shared/platform-level table" per
-- SCHEMA_REGISTRY_v2.md's live-audit section).
--
-- The PRD's §3.4 schema as given has no organization_id/org_id column on
-- either table, and §3.5 describes both a CLI entry point and jobs the
-- platform triggers on its own behalf (e.g. Donor Discovery requesting a
-- scrape for a new keyword) — not a per-org multi-tenant resource a
-- dashboard user browses directly. So: no organization_id column is added
-- (matches the PRD's literal schema), RLS is enabled on both tables with
-- NO permissive policy, which — per Postgres RLS semantics — blocks all
-- access under the anon/authenticated JWT roles and leaves the
-- service_role key (which bypasses RLS entirely, same as every other
-- service-role-only table in this schema) as the only writer/reader. If a
-- future feature needs an org to see its own triggered jobs, add a nullable
-- organization_id column plus an org-scoped SELECT-only policy in a later
-- migration rather than retrofitting write access here.
--
-- NOT CONFIRMED APPLIED TO PRODUCTION this session — no working Management
-- API / MCP DDL path was available (same constraint as migration 051 and
-- 052 tonight; see project memory on the July 19 2026 401 and the
-- recurring "no DDL path found" pattern). Apply manually via the Supabase
-- SQL Editor: https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql/new

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  target_domain text,
  output_schema jsonb NOT NULL,
  status text DEFAULT 'pending',
  urls_discovered integer DEFAULT 0,
  urls_processed integer DEFAULT 0,
  results_found integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS scrape_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES scrape_jobs(id),
  source_url text NOT NULL,
  extracted_data jsonb NOT NULL,
  confidence text,
  fetched_at timestamptz DEFAULT now(),
  fetch_error text
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_keyword ON scrape_jobs(keyword);
CREATE INDEX IF NOT EXISTS idx_scrape_results_job_id ON scrape_results(job_id);

ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_results ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: service-role only, see posture note above.
