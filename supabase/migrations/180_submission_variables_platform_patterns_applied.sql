-- Phase 5.5 (2026-09-15): AG-39 ROI Optimizer Agent's own header
-- (src/lib/agents/roi-optimizer-agent.ts) documented that
-- submission_variables has no column for platform_patterns_applied, so the
-- value is read from applications.platform_patterns_applied but never
-- persisted into the row this agent's correlation pass reads from.
--
-- Additive, nullable, no backfill needed (existing rows simply have no
-- historical value for a field that was never captured before now).
ALTER TABLE public.submission_variables
  ADD COLUMN IF NOT EXISTS platform_patterns_applied integer;

COMMENT ON COLUMN public.submission_variables.platform_patterns_applied IS
  'Count of platform-learned patterns (AG-36 Learning Network) applied to this application''s draft at submission time. Mirrors applications.platform_patterns_applied (migration 084).';
