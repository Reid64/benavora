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
-- Guarded (WGR-068, 2026-08-21): re-running this unconditionally would flip
-- onboarding_completed back to true for any org that has legitimately
-- diverged since the first run (e.g. a real new org mid-wizard) -- confirmed
-- live via a real re-apply test. The WHERE clause makes it a true one-time
-- backfill: a second run only ever touches rows that still need it, which by
-- definition no row does once this migration has run to completion.
UPDATE organizations SET onboarding_completed = true WHERE onboarding_completed IS NOT true;

-- ============================================================================
-- END Migration 003
-- ============================================================================
