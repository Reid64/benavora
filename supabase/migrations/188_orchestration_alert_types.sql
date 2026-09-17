-- ============================================================================
-- BENAVORA - Migration 188: AR-6.1 - orchestration alert types.
--
-- The Orchestration Logging and Alerting Specification v1.0 proposed a new
-- orchestration_alerts table with acknowledge/dismiss/severity/dedup. public
-- .alerts (migration 013) already has every one of those and is live in
-- production (1,806 rows as of 2026-09-17): acknowledge = is_read/read_at,
-- dismiss = is_dismissed/dismissed_at, snooze = snoozed_until, dedup =
-- uq_alerts_org_dedup. A second table would mean two inboxes and strand that
-- history behind the wrong one. This migration extends alert_type instead.
--
-- ALTER TYPE ... ADD VALUE is transactional on PG12+, but the new value
-- cannot be referenced in the SAME transaction that added it ("unsafe use of
-- new value of enum type"). This migration therefore contains ONLY the eight
-- ADD VALUE statements - no INSERT, no function/trigger body referencing a
-- new value. Anything that uses them ships in a later migration file.
-- ============================================================================

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'task_failed';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'cost_overage';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'schema_mismatch';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'state_drift';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'rate_limit';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'timeout';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'rollback';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'manual_review_required';

-- ============================================================================
-- END Migration 188
-- ============================================================================
