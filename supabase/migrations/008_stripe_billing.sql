-- ============================================================
-- 008_stripe_billing.sql
-- Phase 5 — Stripe subscription billing wiring.
--   1. stripe_webhook_events: idempotency ledger for the webhook handler
--      (Behavioral Contracts §22 — "checks if event already processed").
--   2. Enable feature.stripe_billing for existing organizations.
--   3. Flip the per-organization seed default so new orgs get billing enabled.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Webhook idempotency ledger
-- ------------------------------------------------------------
-- Keyed by Stripe's event id. Global (not org-scoped): events are resolved to a
-- tenant inside the handler via subscription/customer metadata. Only the
-- service-role client touches this table, so RLS is enabled with no policy
-- (the service role bypasses RLS; everyone else is denied).
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,            -- Stripe event id (evt_...)
  type text,                      -- Stripe event type
  processed_at timestamptz DEFAULT now()
);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. Enable billing for existing organizations
-- ------------------------------------------------------------
UPDATE platform_config
  SET value = 'true', updated_at = now()
  WHERE key = 'feature.stripe_billing';

-- Insert the flag for any org that somehow lacks it (defensive).
INSERT INTO platform_config (organization_id, key, value)
SELECT id, 'feature.stripe_billing', 'true' FROM organizations
ON CONFLICT (organization_id, key) DO UPDATE SET value = 'true';

-- ------------------------------------------------------------
-- 3. New organizations get billing enabled by default
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_platform_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_config (organization_id, key, value) VALUES
    (NEW.id, 'feature.research_agents',          'false'),
    (NEW.id, 'feature.browser_automation',       'false'),
    (NEW.id, 'feature.email_integration',        'false'),
    (NEW.id, 'feature.cold_outreach_email',      'false'),
    (NEW.id, 'feature.stripe_billing',           'true'),
    (NEW.id, 'ai.model',                         'claude-sonnet-4-6'),
    (NEW.id, 'ai.max_tokens',                    '4096'),
    (NEW.id, 'ai.confidence_threshold',          '70'),
    (NEW.id, 'learning.min_outcomes_for_scoring','5'),
    (NEW.id, 'learning.proven_narrative_threshold','2');
  RETURN NEW;
END;
$$;
