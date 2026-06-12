-- ============================================================
-- BENAVORA — Migration 009: Draft Version History
-- Apply AFTER 008_stripe_billing.sql
--
-- Adds full draft-version persistence for the Draft Generator
-- (BLUEPRINT §4.8). Every generated draft is auto-saved as an
-- immutable, append-only version so users can restore their last
-- draft, browse history per opportunity, compare versions, and
-- revert. The single "current" draft still lives on applications.*;
-- draft_versions is the durable history behind it.
-- ============================================================

-- Lifecycle of a draft's pass through the (future) humanization agent.
-- 'not_humanized' is the state of a freshly generated draft.
CREATE TYPE humanization_status AS ENUM (
  'not_humanized', 'pending', 'humanized', 'failed'
);

-- ------------------------------------------------------------
-- draft_versions — one row per generated/reverted draft.
-- version_number is assigned per opportunity by trigger (below),
-- so application code never supplies it (avoids races).
-- ------------------------------------------------------------
CREATE TABLE draft_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  opportunity_id      uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  -- The application this version was saved onto, when one exists. Kept even if
  -- the application is later removed so history is never silently lost.
  application_id      uuid REFERENCES applications(id) ON DELETE SET NULL,
  template_type       draft_template_type NOT NULL,
  content             text NOT NULL,
  confidence_score    integer,
  knowledge_sources   jsonb,
  version_number      integer NOT NULL,
  humanization_status humanization_status NOT NULL DEFAULT 'not_humanized',
  -- Provenance: 'generated', 'regenerated', or 'reverted' (free-text, forward
  -- compatible). Lets the history panel explain where each version came from.
  source              text NOT NULL DEFAULT 'generated',
  created_by          uuid REFERENCES profiles(id),
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_draft_versions_org ON draft_versions (organization_id);
CREATE INDEX idx_draft_versions_opp ON draft_versions (opportunity_id);
CREATE INDEX idx_draft_versions_app ON draft_versions (application_id);
-- Drives the history panel (latest first) and "restore last draft".
CREATE INDEX idx_draft_versions_opp_created
  ON draft_versions (opportunity_id, created_at DESC);
-- One version number per opportunity.
CREATE UNIQUE INDEX uq_draft_versions_opp_version
  ON draft_versions (opportunity_id, version_number);

-- ------------------------------------------------------------
-- Auto-assign version_number = (max for this opportunity) + 1.
-- Runs BEFORE INSERT so both server-side (API route) and any
-- client-side inserts get a correct, gap-free sequence without
-- computing it in application code.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_draft_version_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_number IS NULL OR NEW.version_number = 0 THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.draft_versions
     WHERE opportunity_id = NEW.opportunity_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_draft_version_number
  BEFORE INSERT ON draft_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_draft_version_number();

-- ------------------------------------------------------------
-- RLS — organization isolation (master pattern, Migration 001).
-- USING also governs INSERT (no separate WITH CHECK), so a row can
-- only be written with the caller's own organization_id.
-- ------------------------------------------------------------
ALTER TABLE draft_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "draft_versions_org_isolation" ON draft_versions
  USING (organization_id = public.current_org_id());

-- ============================================================
-- END Migration 009
-- ============================================================
