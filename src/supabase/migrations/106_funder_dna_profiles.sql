-- Migration 106 — funder_dna_profiles, AG-10 Grant DNA Analysis Agent's output
-- table (AGENTS_v2.md, 2026-08-03 enterprise spec). No existing table matched
-- "structured DNA profile of what a funder tends to require/reward" — this is
-- genuinely new schema, not a rename/reuse of anything else.
--
-- Scoped by (organization_id, funder_id): `funders` is itself already
-- org-scoped (each org tracks its own funder relationships independently,
-- confirmed live — organization_id is a real, populated column on `funders`),
-- so a DNA profile is naturally per-org-per-funder, not a shared/global
-- table. organization_id is denormalized onto this table directly (not just
-- inferred via the funder_id FK) to match this project's established
-- convention for RLS scoping and query performance on child tables
-- (opportunities, outcomes, etc. all do the same).

CREATE TABLE IF NOT EXISTS funder_dna_profiles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id                 uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  requirement_patterns      jsonb NOT NULL DEFAULT '{}',
  reward_patterns           jsonb NOT NULL DEFAULT '{}',
  typical_award_range_min   numeric,
  typical_award_range_max   numeric,
  common_eligibility_themes text[],
  common_required_documents text[],
  sample_size               integer NOT NULL DEFAULT 0,
  confidence                numeric,
  last_analyzed_at          timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, funder_id)
);

CREATE INDEX IF NOT EXISTS idx_funder_dna_org ON funder_dna_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_funder_dna_funder ON funder_dna_profiles(funder_id);

ALTER TABLE funder_dna_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "funder_dna_org" ON funder_dna_profiles;
CREATE POLICY "funder_dna_org" ON funder_dna_profiles USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
