-- 084_learning_network_draft_integration.sql
-- Wires platform_learning_patterns (migration 083) into autonomous draft
-- generation (src/lib/agents/draft-generation-agent.ts). Adds a per-
-- application counter of how many platform-wide anonymized patterns were
-- injected into that draft's prompt context, surfaced on the new
-- /intelligence/learning-network dashboard ("Patterns Applied to Your
-- Drafts" stat).

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS platform_patterns_applied integer NOT NULL DEFAULT 0;
