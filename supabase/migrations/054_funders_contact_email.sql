-- 054_funders_contact_email.sql
-- Adds contact_email to funders for email-channel AutoApply submissions.
-- When a funder has no giving_portal_url but has a contact_email,
-- AutoApply sends a donation request letter via Resend instead of browser automation.

ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS contact_email text;

CREATE INDEX IF NOT EXISTS idx_funders_contact_email
  ON funders (contact_email)
  WHERE contact_email IS NOT NULL;
