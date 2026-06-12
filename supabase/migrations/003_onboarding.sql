-- ============================================================================
-- BENAVORA — Migration 003: Onboarding flag
--
-- Adds organizations.onboarding_completed so the app can route brand-new
-- organizations through the first-login onboarding wizard and skip it for
-- everyone who has already finished (or explicitly skipped) it.
--
-- New organizations start at FALSE (the wizard triggers on first login).
-- Existing organizations are backfilled to TRUE so they are not forced back
-- through onboarding after this migration ships.
--
-- The actual wizard data (org profile, first funder, key documents, first
-- search profile) lives in its own tables. "Resume" is derived from that real
-- data; only the user's current step pointer is persisted, as a per-org row in
-- platform_config under key 'onboarding.step' (no schema change needed — the
-- key/value shape already exists).
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Backfill: every organization that already exists predates onboarding and
-- should not be interrupted. Only rows created after this migration default to
-- false and flow through the wizard.
UPDATE organizations SET onboarding_completed = true;

-- ============================================================================
-- END Migration 003
-- ============================================================================
