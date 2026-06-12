-- ============================================================================
-- Migration 006 — email_matching agent_type
--
-- Phase 4 introduces the Email Matching Agent (AGENTS.md Agent 17). Like every
-- other agent it extends BaseAgent, which logs each run to agent_runs and stamps
-- agent_runs.agent_type. The original `agent_type` enum (migration 001) predates
-- Phase 4 and has no value for it, so we add one here.
--
-- The Phase 4 integration tables themselves (integrations, synced_email_threads,
-- synced_email_messages, email_thread_links) and the deadlines.google_calendar_
-- event_id column were already created in migration 002 — nothing to add here.
--
-- `ALTER TYPE ... ADD VALUE` is additive and idempotent (IF NOT EXISTS); it does
-- not touch existing rows or any governance document. The new value cannot be
-- referenced in the same transaction it is created in, but this migration only
-- declares it — first use happens in application code on a later connection.
-- ============================================================================

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'email_matching';
