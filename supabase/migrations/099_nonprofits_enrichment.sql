-- 099_nonprofits_enrichment.sql — tiered enrichment columns for the
-- nonprofits table (migration 098's IRS BMF import) needed by
-- scripts/enrich-990-xml.ts (tier 1: IRS 990 XML) and
-- scripts/enrich-website-contacts.ts (tier 2: website contact scraping).
--
-- Same conditional-add style as migrations 058/072 so this is safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'website') THEN
    ALTER TABLE nonprofits ADD COLUMN website text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'phone') THEN
    ALTER TABLE nonprofits ADD COLUMN phone text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'mission') THEN
    ALTER TABLE nonprofits ADD COLUMN mission text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'employee_count') THEN
    ALTER TABLE nonprofits ADD COLUMN employee_count integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'officer_name') THEN
    ALTER TABLE nonprofits ADD COLUMN officer_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'officer_title') THEN
    ALTER TABLE nonprofits ADD COLUMN officer_title text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'officer_email') THEN
    ALTER TABLE nonprofits ADD COLUMN officer_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'contact_emails') THEN
    ALTER TABLE nonprofits ADD COLUMN contact_emails text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'staff_contacts') THEN
    ALTER TABLE nonprofits ADD COLUMN staff_contacts text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'linkedin_url') THEN
    ALTER TABLE nonprofits ADD COLUMN linkedin_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'facebook_url') THEN
    ALTER TABLE nonprofits ADD COLUMN facebook_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'twitter_url') THEN
    ALTER TABLE nonprofits ADD COLUMN twitter_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'instagram_url') THEN
    ALTER TABLE nonprofits ADD COLUMN instagram_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'enrichment_tier') THEN
    ALTER TABLE nonprofits ADD COLUMN enrichment_tier smallint;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nonprofits' AND column_name = 'last_enriched_at') THEN
    ALTER TABLE nonprofits ADD COLUMN last_enriched_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nonprofits_last_enriched_at ON nonprofits(last_enriched_at);
