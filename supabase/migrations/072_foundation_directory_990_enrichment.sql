-- 072_foundation_directory_990_enrichment.sql — columns for the IRS 990 batch
-- enrichment script (scripts/enrich-foundations-990.ts). foundation_directory
-- already has enriched_at/enrichment_source/officers/programs/contact_emails/
-- contact_phones from migration 058; this adds the fields specific to the 990
-- extract job: a jsonb bag for grant_count/typical grant range/fiscal_year
-- (data with no dedicated column), separate 990-vs-web enrichment timestamps
-- (distinct from the generic enriched_at), and how a website was discovered.
--
-- Same conditional-add style as migration 058 so this is safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'enrichment') THEN
    ALTER TABLE foundation_directory ADD COLUMN enrichment jsonb DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'enriched_990_at') THEN
    ALTER TABLE foundation_directory ADD COLUMN enriched_990_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'enriched_web_at') THEN
    ALTER TABLE foundation_directory ADD COLUMN enriched_web_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'foundation_directory' AND column_name = 'website_discovered_via') THEN
    ALTER TABLE foundation_directory ADD COLUMN website_discovered_via text;
  END IF;
END $$;
