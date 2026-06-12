-- ============================================================================
-- Migration 007 — email_campaign agent_type + enable cold-outreach email
--
-- Phase 4 introduces the Email Campaign Agent (AGENTS.md Agent 18). Like every
-- other agent it extends BaseAgent, which logs each run to agent_runs and stamps
-- agent_runs.agent_type. The original `agent_type` enum (migration 001) predates
-- Phase 4 and has no value for it, so we add one here.
--
-- The campaign tables themselves (email_campaigns, campaign_steps,
-- campaign_sends) and outreach_contacts were created in migration 001 — nothing
-- to add there.
--
-- We also flip the per-organization feature flag feature.cold_outreach_email to
-- 'true' for every existing organization so the campaign engine is live. New
-- organizations still default to 'false' via the seeding trigger (migration 001)
-- until they opt in; this migration only enables it for orgs that already exist.
--
-- `ALTER TYPE ... ADD VALUE` is additive and idempotent (IF NOT EXISTS); it does
-- not touch existing rows or any governance document. The new value cannot be
-- referenced in the same transaction it is created in, but this migration only
-- declares it — first use happens in application code on a later connection.
-- ============================================================================

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'email_campaign';

-- Enable the cold-outreach email engine for existing organizations
-- (BEHAVIORAL_CONTRACTS §21). Idempotent: re-running only re-asserts 'true'.
UPDATE platform_config
   SET value = 'true', updated_at = now()
 WHERE key = 'feature.cold_outreach_email'
   AND value <> 'true';
