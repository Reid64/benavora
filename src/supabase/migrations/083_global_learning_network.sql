-- 083_global_learning_network.sql
-- Phase 4 Global Learning Network substrate (AUTONOMOUS_PLATFORM_VISION.md,
-- "Global Learning Network" section; AGENTS_v2.md AG-36/Knowledge Engine
-- Indexer extension). Anonymized, cross-org, shared pattern store analogous
-- to knowledge_patterns (migration 097, queued) but scoped specifically to
-- this task's schema. No org_id column on platform_learning_patterns by
-- design -- service-role-only writes, no org-identifiable data.

CREATE TABLE IF NOT EXISTS platform_learning_patterns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type      text NOT NULL CHECK (pattern_type IN (
    'narrative_language', 'budget_structure', 'keyword', 'timing',
    'attachment_type', 'funder_preference', 'ntee_success'
  )),
  funder_category   text,
  ntee_code         text,
  pattern_content   text NOT NULL,
  success_rate      numeric,
  sample_count      integer NOT NULL DEFAULT 1,
  avg_award_amount  numeric,
  winning_examples  jsonb NOT NULL DEFAULT '[]',
  last_updated      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_patterns_type
  ON platform_learning_patterns(pattern_type, funder_category, ntee_code);

COMMENT ON TABLE platform_learning_patterns IS
  'Platform-wide anonymized learning patterns. No org_id -- shared across all tenants. RLS disabled intentionally.';

CREATE TABLE IF NOT EXISTS org_learning_contributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  outcome_id        uuid REFERENCES outcomes(id),
  contribution_type text NOT NULL,
  pattern_id        uuid REFERENCES platform_learning_patterns(id),
  anonymized_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_org ON org_learning_contributions(org_id);
CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_pattern ON org_learning_contributions(pattern_id);

COMMENT ON TABLE org_learning_contributions IS
  'Per-org audit trail of which outcomes fed platform_learning_patterns. org_id present here (audit only) but never joined into any client-facing aggregate response.';
