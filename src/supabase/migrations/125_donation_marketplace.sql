-- 125_donation_marketplace.sql — Donation Recommendation Marketplace MVP
-- (BLUEPRINT/FEATURE_REGISTRY_v2.md Pillar 9, rows #121-125).
--
-- Scope: this migration builds ONLY the schema for rows #121 (Marketplace Schema)
-- and the storage rows #123's rule-based match / #124's request-approve flow write
-- to. Row #125 (IRS-compliant Donation Receipt Generator) and the AI half of #123
-- (an AI match engine, as opposed to the rule-based one built this pass) are NOT
-- built here — no receipt table, no AI-scoring column beyond a plain text
-- match_reason. Both remain explicitly PLANNED; do not read this migration as
-- having built either.
--
-- Per this project's known public-schema default-ACL gap (every new table is
-- anon/authenticated-exposed by default unless explicitly locked down —
-- see ANON_GRANT_AUDIT.md and the many *_rls_hardening.sql migrations in this
-- tree), RLS + REVOKE are added in this same migration, not a follow-up.

CREATE TYPE marketplace_listing_status AS ENUM (
  'active', 'matched', 'fulfilled', 'expired', 'cancelled'
);

CREATE TYPE marketplace_match_status AS ENUM (
  'suggested', 'requested', 'approved', 'declined', 'withdrawn'
);

-- marketplace_listings — a company/donor org posts an available donation
-- (surplus goods, in-kind services, a matching-funds pool, volunteer hours,
-- etc). organization_id is the posting/owning org. `category` reuses the
-- existing funder_category enum (001_initial_schema.sql) rather than
-- inventing a parallel taxonomy — it already has donation-shaped values
-- (in_kind_donation, materials_donation, corporate_donation, ...) alongside
-- the grant-shaped ones, and reusing it is what makes the rule-based matcher
-- below able to compare a listing's category directly against
-- search_profiles.categories (funder_category[], migration 001) with no
-- translation layer.
CREATE TABLE marketplace_listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  title              text NOT NULL,
  description        text,
  category           funder_category NOT NULL,
  item_type          text,
  quantity           text,
  estimated_value    numeric(12,2),
  geographic_scope   text,
  status             marketplace_listing_status NOT NULL DEFAULT 'active',
  expires_at         timestamptz,
  -- Explicit, queryable seed-data marker (not just a title prefix) so a
  -- future cleanup pass can `DELETE ... WHERE is_seed_data = true` without
  -- guessing at naming conventions.
  is_seed_data       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketplace_listings_org ON marketplace_listings (organization_id);
CREATE INDEX idx_marketplace_listings_status ON marketplace_listings (status);
CREATE INDEX idx_marketplace_listings_category ON marketplace_listings (category);

-- marketplace_matches — a listing matched to a requesting org, produced by
-- the rule-based matcher (category overlap with the requesting org's active
-- search_profiles.categories, plus geographic_scope overlap) on listing
-- insert. `match_reason` records which plain-text rule(s) fired — this is
-- NOT an AI/Claude-scored match (row #123's AI half is explicitly out of
-- scope this pass); there is no numeric confidence column here on purpose,
-- so a future AI-scoring pass has a real column to add rather than a
-- misleading placeholder to overwrite.
CREATE TABLE marketplace_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  match_reason       text NOT NULL,
  status             marketplace_match_status NOT NULL DEFAULT 'suggested',
  requested_at       timestamptz,
  responded_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, organization_id)
);

CREATE INDEX idx_marketplace_matches_listing ON marketplace_matches (listing_id);
CREATE INDEX idx_marketplace_matches_org ON marketplace_matches (organization_id, status);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_listings FROM anon;

-- A listing is visible to its own posting org, and to any org that has a
-- real marketplace_matches row against it (so a requesting org can see what
-- it was matched to without seeing the whole platform's postings — an
-- intentionally narrower "browse" surface than a fully public cross-org
-- marketplace, matching this MVP's own stated scope).
CREATE POLICY marketplace_listings_org_select ON marketplace_listings FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM marketplace_matches mm
      WHERE mm.listing_id = marketplace_listings.id
        AND mm.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY marketplace_listings_org_insert ON marketplace_listings FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY marketplace_listings_org_update ON marketplace_listings FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE marketplace_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_matches FROM anon;

-- Visible to the requesting org (its own match row) and to the listing's
-- owning org (so it can see/act on incoming requests).
CREATE POLICY marketplace_matches_org_select ON marketplace_matches FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM marketplace_listings ml
      WHERE ml.id = marketplace_matches.listing_id
        AND ml.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

-- Client-side insert defense-in-depth only — the real write path is the
-- rule-based matcher (src/lib/marketplace/matcher.ts), which runs on the
-- service-role client and so bypasses RLS entirely (it must, since it writes
-- match rows on behalf of orgs other than the caller who posted the
-- listing). This policy just ensures that if a client ever inserts directly,
-- it can only ever create a match row for its own org.
CREATE POLICY marketplace_matches_org_insert ON marketplace_matches FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Status transitions: the requesting org can act on its own match row
-- (suggested -> requested, or withdraw); the listing's owning org can act on
-- any match row against its own listing (requested -> approved/declined).
-- Valid-transition enforcement (e.g. can't "approve" a row still in
-- "suggested") happens at the API-route layer, matching this project's
-- existing convention of RLS enforcing the org boundary and the route
-- enforcing state-machine correctness.
CREATE POLICY marketplace_matches_org_update ON marketplace_matches FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM marketplace_listings ml
      WHERE ml.id = marketplace_matches.listing_id
        AND ml.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM marketplace_listings ml
      WHERE ml.id = marketplace_matches.listing_id
        AND ml.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );
