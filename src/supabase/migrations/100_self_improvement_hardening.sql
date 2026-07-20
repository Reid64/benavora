-- Migration 100: Self-Improvement Agent (AG-38) Enterprise Hardening
-- Extends migration 087's improvement_proposals / agent_performance_metrics
-- substrate for the 2026-07-20 hardening pass to
-- src/lib/agents/self-improvement-agent.ts:
--
-- 1. agent_performance_metrics.runs_failed - the task spec's error_rate
--    metric (failed_runs / total_runs * 100) has to be aggregatable over the
--    trailing 7-day window from the daily rows already stored in this table
--    (one row per agent per day), the same way success_rate already is via
--    runs_successful. Without a stored per-day failed count, a 7-day
--    error_rate can only be computed for "yesterday" (a live agent_runs
--    query), not for the rolling window identifyUnderperformers() reads from
--    stored rows. Adding the column keeps that computation consistent with
--    how every other 7-day metric already works here.
-- 2. improvement_proposals.affected_agent_id - the task spec's proposal
--    deduplication rule ("same proposal_type + same affected agent") has no
--    column to key off today; the table only has proposal_type. Nullable
--    (some proposals, e.g. ui_improvement, are genuinely cross-cutting and
--    not tied to one agent).
-- 3. improvement_proposals.proposal_type CHECK constraint - the task spec's
--    weekly performance report is stored as proposal_type='performance_report',
--    a distinct type from the five Claude-generated proposal types. Postgres
--    CHECK constraints have no ADD VALUE IF NOT EXISTS equivalent (unlike the
--    agent_type enum elsewhere in this schema), so the constraint is dropped
--    and recreated with the new value added. 'code_change', 'schema_change',
--    and 'permission_change' are deliberately never added here -- those
--    proposal types are forbidden at the application layer (HARD LIMIT,
--    self-improvement-agent.ts) and must stay impossible to insert even if
--    that check were ever bypassed.

ALTER TABLE agent_performance_metrics
  ADD COLUMN IF NOT EXISTS runs_failed integer NOT NULL DEFAULT 0;

ALTER TABLE improvement_proposals
  ADD COLUMN IF NOT EXISTS affected_agent_id text;

CREATE INDEX IF NOT EXISTS idx_improvement_proposals_dedup
  ON improvement_proposals(proposal_type, affected_agent_id, proposed_at DESC);

ALTER TABLE improvement_proposals DROP CONSTRAINT IF EXISTS improvement_proposals_proposal_type_check;
ALTER TABLE improvement_proposals ADD CONSTRAINT improvement_proposals_proposal_type_check
  CHECK (proposal_type IN (
    'prompt_optimization', 'agent_threshold', 'workflow_change',
    'ui_improvement', 'data_quality', 'performance_report'
  ));
