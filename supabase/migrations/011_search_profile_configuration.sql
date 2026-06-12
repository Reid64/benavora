-- ============================================================================
-- Migration 011 — search_profiles advanced configuration
--
-- Extends the saved search-profile model (migration 001) so a profile can carry
-- the full research-targeting configuration the Search Profile Configuration page
-- exposes, and that the research agents read before every run:
--
--   source_type_filters  — source-category filters WITH a priority ranking, as a
--                          jsonb array of { source_type, priority } objects.
--   focus_areas          — focus-area tags WITH weights, jsonb array of
--                          { label, weight } objects; weave into agent queries.
--   geographic_scopes    — multi-value geographic scope selector (the existing
--                          singular geographic_scope is kept and mirrored to the
--                          first entry for backward compatibility).
--   eligibility_filters  — eligibility pre-filters, a jsonb object of structured
--                          boolean/number toggles (501c3, matching funds, …).
--   populations_served   — population-served matching tags (text[]).
--   excluded_categories  — negative filter: funder categories to skip.
--   excluded_funders     — negative filter: funder names to skip (text[]).
--   agent_settings       — per-agent enable toggle + schedule, jsonb object keyed
--                          by agent_type: { "<agent_type>": { enabled, intervalHours } }.
--
-- The fine-grained `categories` column (migration 001) continues to hold the
-- profile's funding-type toggles; this migration adds only NEW configuration
-- axes around it. The "funding type" UI toggles map to `categories`; the
-- "source category" filters map to the new source_type_filters (the
-- opportunity_source_type axis from migration 010) — the two stay distinct.
--
-- Additive and safe: every column is NEW, nullable with a sensible default, on an
-- existing table. No column is renamed or dropped, no RLS policy is touched, and
-- no governance document is modified. Written idempotently (ADD COLUMN IF NOT
-- EXISTS) so a re-run via apply-migration.mjs is harmless.
-- ============================================================================

ALTER TABLE search_profiles
  ADD COLUMN IF NOT EXISTS source_type_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS focus_areas         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS geographic_scopes   text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS eligibility_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS populations_served  text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_categories funder_category[] NOT NULL DEFAULT '{}'::funder_category[],
  ADD COLUMN IF NOT EXISTS excluded_funders    text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS agent_settings      jsonb NOT NULL DEFAULT '{}'::jsonb;
