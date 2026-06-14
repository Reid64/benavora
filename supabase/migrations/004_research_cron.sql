-- ============================================================================
-- Migration 004 — research cron configuration
--
-- Wires the scheduled research sweep (/api/cron/research, Vercel Cron daily at
-- 06:00 UTC) into per-organization config. Three parts:
--
--   1. Backfill existing organizations so the research agents are usable out of
--      the box: enable feature.research_agents and seed the two new cron config
--      keys (research.daily_quota, research.cron_secret).
--   2. Update the per-org seeding trigger so organizations created from now on
--      receive the same defaults.
--
-- platform_config.value is NOT NULL, so every key gets a concrete value.
--
-- research.cron_secret is a per-org OVERRIDE slot only and defaults to '' (the
-- empty string = "not set"). The authoritative cron secret is the server-only
-- CRON_SECRET env var, which the endpoint checks against the Authorization
-- header. The DB key is never required and never the source of truth — it exists
-- so the Research UI has a place to surface/store an org-specific value later.
-- Do NOT store the production secret here in plaintext.
-- ============================================================================

-- 1. Backfill existing organizations -----------------------------------------

-- Enable research agents by default for every existing organization. ON
-- CONFLICT keeps this idempotent and also flips any pre-seeded 'false' to 'true'.
INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.research_agents', 'true' FROM organizations
ON CONFLICT (organization_id, key)
  DO UPDATE SET value = 'true', updated_at = now();

-- Seed the cron config keys for existing orgs. These are new keys, so leave any
-- value an operator may have already set in place (DO NOTHING, not overwrite).
INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'research.daily_quota', '100' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'research.cron_secret', '' FROM organizations
ON CONFLICT (organization_id, key) DO NOTHING;

-- 2. Update the per-org seeding trigger for future organizations -------------

CREATE OR REPLACE FUNCTION public.seed_default_platform_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_config (organization_id, key, value) VALUES
    (NEW.id, 'feature.research_agents',          'true'),
    (NEW.id, 'feature.browser_automation',       'false'),
    (NEW.id, 'feature.email_integration',        'false'),
    (NEW.id, 'feature.cold_outreach_email',      'false'),
    (NEW.id, 'feature.stripe_billing',           'false'),
    (NEW.id, 'ai.model',                         'claude-sonnet-4-6'),
    (NEW.id, 'ai.max_tokens',                    '4096'),
    (NEW.id, 'ai.confidence_threshold',          '70'),
    (NEW.id, 'learning.min_outcomes_for_scoring','5'),
    (NEW.id, 'learning.proven_narrative_threshold','2'),
    (NEW.id, 'research.daily_quota',             '100'),
    (NEW.id, 'research.cron_secret',             '');
  RETURN NEW;
END;
$$;

-- Trigger trg_seed_platform_config already points at this function; replacing
-- the function body is sufficient.

-- ============================================================================
-- END Migration 004
-- ============================================================================
