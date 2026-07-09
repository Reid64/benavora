-- ============================================================================
-- BENAVORA - Migration 073: Onboarding progress checklist
--
-- Adds onboarding_progress (jsonb), a richer companion to the existing
-- onboarding_step integer pointer (migration 023). Shape:
--   { completed_steps: string[], last_step: string }
-- completed_steps lets the Settings > Organization Setup checklist and the
-- dashboard resume banner show which of the 7 wizard steps are actually done
-- without re-deriving it from onboarding_step (which only tracks the next
-- step to resume, not a full completed set). last_step is the step the
-- resume banner/button deep-links to.
--
-- onboarding_completed (migration 003) remains the sole gate flag read by
-- middleware; this column is display/navigation data only.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS onboarding_progress jsonb NOT NULL DEFAULT '{}';

-- ============================================================================
-- END Migration 073
-- ============================================================================
