-- Deprecation comments for the outreach campaign engine consolidated into the
-- Email sequence engine (email_sequence_steps / email_sequence_enrollments /
-- email_campaign_sequences) on 2026-08-13.
-- See OUTREACH_CONSOLIDATION_AUDIT.md's "consolidation execution" sections for
-- full history. Not dropped/truncated here by design -- deferred to a later,
-- separately-approved cleanup pass.

COMMENT ON TABLE email_campaigns IS
  'DEPRECATED 2026-08-13: superseded by email_campaign_sequences. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';

COMMENT ON TABLE campaign_steps IS
  'DEPRECATED 2026-08-13: superseded by email_sequence_steps. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';

COMMENT ON TABLE campaign_sends IS
  'DEPRECATED 2026-08-13: superseded by email_sequence_enrollments. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';
