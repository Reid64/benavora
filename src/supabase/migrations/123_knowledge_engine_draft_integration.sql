-- 123_knowledge_engine_draft_integration.sql
-- Wires the Knowledge Engine (src/lib/intelligence/knowledge-engine.ts,
-- migration 096's knowledge_patterns/knowledge_queries tables) into
-- autonomous draft generation (src/lib/agents/draft-generation-agent.ts,
-- FEATURE_REGISTRY_v2.md row #171's documented gap). Adds a per-application
-- record of which knowledge_patterns.id rows were actually injected into
-- that draft's prompt, so a cross-org pattern match stays attributable
-- after the fact and distinguishable from this org's own knowledge_base /
-- proven_narratives content -- mirrors the platform_patterns_applied
-- counter added by migration 084 for the same purpose against a different
-- table (platform_learning_patterns).
--
-- jsonb (an array of pattern id strings), not integer: unlike
-- platform_patterns_applied (a count only), this column needs to answer
-- "which specific patterns" for attribution, not just "how many".

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS knowledge_patterns_applied jsonb NOT NULL DEFAULT '[]'::jsonb;
