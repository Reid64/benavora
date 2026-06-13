-- Migration 017: Add success_patterns JSONB column to proven_narratives.
-- Populated by the Recursive Learning Agent's pattern-analysis step when an
-- outcome is marked awarded. Stores winning and losing language patterns plus
-- recommendations derived by comparing the awarded narrative against denied
-- narratives in the same funder_category.
ALTER TABLE proven_narratives
  ADD COLUMN IF NOT EXISTS success_patterns jsonb;
