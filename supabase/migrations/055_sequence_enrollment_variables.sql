-- Migration 055: add per-enrollment variable storage to email_sequence_enrollments.
-- Required for SequenceEngine.processScheduledSends to render templates with the
-- variables captured at enroll time (contact_name, funder_name, custom_* etc.).

ALTER TABLE email_sequence_enrollments
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '{}';
