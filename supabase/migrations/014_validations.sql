-- ============================================================================
-- BENAVORA — Migration 014: Cross-provider validation (AI consensus)
-- Apply AFTER 013_alerts.sql
--
-- After the research agents discover an opportunity, each finding is sent to two
-- INDEPENDENT AI providers (Anthropic Claude + a free-tier provider, Google
-- Gemini) which each judge, on their own, whether the opportunity is plausible
-- and internally consistent: does it appear to exist, are the eligibility
-- requirements coherent, and are the deadline and dollar amounts sane. Each
-- provider returns its own verdict; the two are compared for CONSENSUS, and an
-- opportunity earns the "Verified" badge only when both providers independently
-- agree it checks out. This is the data backing the validation feature.
--
-- One row per (opportunity, provider): a re-run upserts that provider's latest
-- verdict rather than piling up history, so the badge logic reads at most two
-- rows per opportunity. `details` holds the structured per-field findings the
-- provider returned (existence / eligibility / deadline / amounts + summary).
--
-- Additive and safe: one new enum + one new table with org-isolation RLS (master
-- pattern, Migration 001) + one new agent_type value. Written idempotently so a
-- re-run via apply-migration.mjs is harmless. No governance document or existing
-- RLS policy is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enum — a provider's verdict on one finding. Guarded for idempotent re-run.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE validation_verdict AS ENUM (
    'verified',      -- the provider judges the opportunity plausible & consistent
    'discrepancy',   -- the provider found something inaccurate or contradictory
    'unverifiable'   -- the provider could not reach a confident judgement
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The consensus validator runs as its own agent and logs to agent_runs, which
-- stamps agent_runs.agent_type — so the enum needs a value for it (mirrors how
-- migrations 005/006 extended agent_type). Additive and idempotent; the new
-- value is first referenced by application code on a later connection.
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'consensus_validation';

-- ----------------------------------------------------------------------------
-- validations — one verdict per (opportunity, provider), org-scoped.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  opportunity_id   uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  -- Stable provider identifier, e.g. 'anthropic_claude' or 'google_gemini'.
  provider         text NOT NULL,
  -- The exact model that produced this verdict, for auditability.
  model            text,
  verdict          validation_verdict NOT NULL,
  -- Provider's self-reported confidence, 0–100.
  confidence       integer NOT NULL DEFAULT 0
                     CHECK (confidence >= 0 AND confidence <= 100),
  -- Structured per-field findings + summary the provider returned:
  -- { existence, eligibility, deadline, amounts: { ok, note }, summary }.
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- At most one current verdict per provider per opportunity — drives the upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_validations_opportunity_provider
  ON validations (opportunity_id, provider);
CREATE INDEX IF NOT EXISTS idx_validations_org ON validations (organization_id);
-- The detail page and any list badge read every verdict for an opportunity.
CREATE INDEX IF NOT EXISTS idx_validations_opportunity
  ON validations (opportunity_id);

-- ----------------------------------------------------------------------------
-- RLS — organization isolation (master pattern, Migration 001). USING also
-- governs INSERT/UPDATE, so a row can only ever be written with the caller's
-- own organization_id.
-- ----------------------------------------------------------------------------
ALTER TABLE validations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "validations_org_isolation" ON validations;
CREATE POLICY "validations_org_isolation" ON validations
  USING (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 014
-- ============================================================================
