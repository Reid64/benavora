-- ============================================================================
-- BENAVORA - Migration 145: close 2 column-drift gaps found during ledger-audit
-- verification (WGR-042, WGR-043), 2026-08-21
--
-- funder_giving_history (037_giving_history.sql) and success_probability_scores
-- (038_intelligence_tables.sql) both already existed live before this
-- session's remediation, created out-of-band with a different column set
-- than their checked-in migration file defines. `CREATE TABLE IF NOT EXISTS`
-- (correctly, per its own semantics) no-ops against an existing table -- it
-- does not reconcile that table's columns to match the file. Applying
-- 037/038's idempotency fixes earlier in this remediation therefore did NOT
-- add the columns real application code depends on; caught by re-checking
-- WGR-042/WGR-043 against live state after the fact, not by the ledger-audit
-- script (which only verifies a CREATE TABLE's target table exists, not that
-- an already-existing table's column set matches the file's inline
-- definition -- a real gap in that script's methodology, noted here so it
-- isn't silently missed again).
--
-- WGR-042: funder_giving_history.grant_purpose/.source missing (live has the
-- differently-named purpose/recipient_ein/source_filing_url instead). Real
-- consumers: src/lib/agents/competitor-intel.ts (selects grant_purpose),
-- src/lib/agents/funder-signal-monitor-agent.ts and
-- src/lib/autoapply/amount-optimizer.ts (both reference .source). Added as
-- new columns, not renames of purpose/source_filing_url -- those are
-- different fields (a differently-shaped purpose value; a URL specifically),
-- not just alternate names for the same data.
--
-- WGR-043: success_probability_scores.data_quality/.created_at/.updated_at
-- missing. Real consumer: src/lib/agents/success-probability.ts's own
-- upsert writes data_quality/calculated_at/updated_at.
-- ============================================================================

ALTER TABLE funder_giving_history
  ADD COLUMN IF NOT EXISTS grant_purpose text,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE success_probability_scores
  ADD COLUMN IF NOT EXISTS data_quality text NOT NULL DEFAULT 'full'
    CHECK (data_quality IN ('full', 'estimated', 'partial')),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================================
-- END Migration 145
-- ============================================================================
