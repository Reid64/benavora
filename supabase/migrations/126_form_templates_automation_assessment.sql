-- 126_form_templates_automation_assessment.sql
--
-- Closes a real, live schema-drift bug found 2026-08-06 while re-verifying
-- the AutoApply ready-org pipeline after 125's fix and the platform Anthropic
-- key rotation both landed: src/lib/autoapply/form-analyzer-agent.ts's
-- analyzeAndStore() has always written an `automation_assessment` field on
-- its `form_templates` insert (the parsed result of the automation-
-- prohibition scan -- prohibits_automation/relevant_text/confidence/
-- scanned_at/scan_skipped_reason, see that file's AutomationAssessment
-- interface), but no migration in this directory or src/supabase/migrations/
-- ever created the column -- confirmed live via a real insert attempt
-- returning `PGRST204: Could not find the 'automation_assessment' column of
-- 'form_templates' in the schema cache`.
--
-- Every real call to analyzeAndStore() has therefore always failed at this
-- insert, once it got far enough to reach it (masked until now by an
-- earlier, separate bug in the same function that crashed before this point
-- whenever the scraped page text was empty -- fixed alongside this
-- migration, same session).
--
-- jsonb, nullable: matches the existing sibling columns on this table
-- (form_structure jsonb, field_mapping jsonb -- migration 045), which also
-- carry no NOT NULL constraint.

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS automation_assessment jsonb;
