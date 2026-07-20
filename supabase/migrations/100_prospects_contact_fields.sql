-- 100_prospects_contact_fields.sql — adds named-contact columns to the
-- prospects table (migration 001) so scripts/seed-outreach-prospects.ts can
-- carry the nonprofits.officer_name / officer_title fields through into a
-- sales campaign's prospect list for outreach personalization. prospects
-- previously only had a single bare `email` column with no attached person.
--
-- Same conditional-add style as migrations 058/072/099 so this is safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prospects' AND column_name = 'contact_name') THEN
    ALTER TABLE prospects ADD COLUMN contact_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prospects' AND column_name = 'contact_title') THEN
    ALTER TABLE prospects ADD COLUMN contact_title text;
  END IF;
END $$;
