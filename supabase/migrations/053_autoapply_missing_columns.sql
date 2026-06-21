-- Migration 053: Add columns referenced by the AutoApply worker that no prior
-- migration created. Surfaced by the 2026-06-21 codebase audit (AUDIT_REPORT.md).
--
-- worker/queue-processor.ts reads/writes these columns. Because a PostgREST
-- `.select()` against a non-existent column returns HTTP 400 (not null), the
-- missing read columns broke the pipeline outright:
--   * funders.type            → processItem() threw funder_fetch_error for EVERY item
--   * organizations.contact_email → org profile fetch silently returned null,
--                               disabling pitch personalization + EIN/email validation
-- The write columns failed silently (unchecked .update()), losing template metadata:
--   * form_templates.auto_generated, form_templates.field_count
--   * funders.portal_review_status (code already guards this as best-effort)
--
-- All ADD COLUMN statements are IF NOT EXISTS so this is safe to re-run and safe
-- if any column was already applied out-of-band to prod.

-- funders.type: free-form funder classification used for timing scores and pitch
-- context. Distinct from funders.category (the funder_category enum). The worker
-- falls back to category when type is null, so no backfill is required.
ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS type text;

-- funders.portal_review_status: set to 'needs_review' when the form analyzer
-- cannot parse a portal, so a human can triage it.
ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS portal_review_status text;

-- organizations.contact_email: the public-facing application contact address.
-- Separate from organizations.email (the account/billing address). Backfill from
-- email where unset so existing orgs keep working immediately.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS contact_email text;

UPDATE organizations
  SET contact_email = email
  WHERE contact_email IS NULL AND email IS NOT NULL;

-- form_templates.auto_generated: true when the FormAnalyzerAgent created the
-- template (vs. a hand-authored one).
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false;

-- form_templates.field_count: cached count of fields in form_structure, used for
-- change-detection during stale-template refresh.
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS field_count integer;
