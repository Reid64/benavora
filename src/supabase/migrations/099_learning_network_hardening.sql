-- Migration 099: Learning Network Aggregator (AG-36) Enterprise Hardening
-- Extends migration 083's platform_learning_patterns / org_learning_contributions
-- substrate for the 2026-07-20 hardening pass to
-- src/lib/agents/learning-network-aggregator-agent.ts:
--
-- 1. `confidence` (text) - statistical confidence label. The task spec requires
--    success_rate to be left alone (not silently recomputed on thin evidence)
--    until sample_count >= 3; `confidence` makes that state visible to any
--    reader of the row instead of forcing them to infer it from sample_count.
-- 2. `weight` (numeric) - cross-NTEE "universal" patterns (identified by a
--    second Claude pass over patterns that already recur across >= 2 distinct
--    ntee_code values) are stored with ntee_code=NULL and a higher weight than
--    a single-NTEE pattern, per the task spec's "Store with ntee_code=NULL and
--    higher weight." Defaults to 1.0 for every ordinary pattern row.
-- 3. `anonymized` (boolean) and `source_hash` (text) on org_learning_contributions
--    - the task's "Contribution audit" requirement: every contribution record
--    must carry an explicit anonymized=true flag (not just imply it from the
--    table's own comment) and a hash of the source content it was derived
--    from, so a later run can detect re-processing the same narrative content
--    under a different outcome_id (e.g. a cloned application) and skip it.

ALTER TABLE platform_learning_patterns
  ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'low'
    CHECK (confidence IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS weight numeric NOT NULL DEFAULT 1.0;

ALTER TABLE org_learning_contributions
  ADD COLUMN IF NOT EXISTS anonymized boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_hash text;

CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_outcome
  ON org_learning_contributions(outcome_id);
CREATE INDEX IF NOT EXISTS idx_org_learning_contrib_hash
  ON org_learning_contributions(source_hash);
