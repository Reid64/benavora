-- ============================================================================
-- BENAVORA — Migration 023: Onboarding step tracking
--
-- Adds onboarding_completed_at (timestamp when wizard was completed) and
-- onboarding_step (integer step pointer so users can leave and resume the
-- wizard). onboarding_step = 0 means the user has not started; each
-- subsequent value matches the wizard step they completed last.
--
-- The existing onboarding_completed boolean (migration 003) remains as the
-- gate flag. onboarding_completed_at is set when the wizard finishes.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 0;

-- ============================================================================
-- END Migration 023
-- ============================================================================
