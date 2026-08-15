-- ============================================================================
-- Migration 135 — opportunities eligibility-scoring columns
--
-- Found live 2026-08-15 during a real end-to-end smoke test: POST
-- /api/agents/eligibility (the Eligibility Scoring Agent, AG-02) 500s on every
-- call for every org, because src/lib/agents/eligibility-scorer.ts writes
-- is_high_priority and match_mismatch_reasons, which migrations
-- 012_opportunity_match_percentage.sql (and duplicated in 025/026) already
-- declare but were never applied live — only 6 of 1,247 real opportunities
-- across the whole database have ever had a non-null eligibility_score.
-- Definitions copied verbatim from 012 so this is a no-op if a future replay
-- of 012 against this database ever does apply cleanly.
-- ============================================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS is_high_priority boolean NOT NULL DEFAULT false;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS match_mismatch_reasons text[];
