-- 127_fix_marketplace_rls_recursion.sql — fixes a live, reproducible
-- "infinite recursion detected in policy" error on both marketplace_listings
-- and marketplace_matches (migration 125_donation_marketplace.sql).
--
-- Root cause: marketplace_listings_org_select's USING clause EXISTS-checks
-- marketplace_matches (a policy-protected table), whose own SELECT policy
-- (marketplace_matches_org_select) EXISTS-checks marketplace_listings right
-- back — a mutual cross-table cycle. Postgres detects and rejects this at
-- query time for EVERY select against either table via an RLS-scoped
-- (session, non-service-role) client, even against an empty table with zero
-- rows, confirmed live 2026-08-08. This broke every real HTTP entry point
-- into the marketplace feature that uses the session client: GET
-- /api/marketplace/listings, GET /api/marketplace/matches, POST
-- /api/marketplace/listings (its insert(...).select(...).single() triggers
-- the SELECT policy on the returned row), and PATCH
-- /api/marketplace/matches/[id] (its initial .select(...).single() read).
-- Only the service-role-only matcher (src/lib/marketplace/matcher.ts) and
-- the seed script were ever exercised previously, which bypass RLS
-- entirely and never hit this.
--
-- Fix: replace the two circular EXISTS subqueries with SECURITY DEFINER
-- helper functions. A SECURITY DEFINER function owned by the migration
-- role (not subject to FORCE ROW LEVEL SECURITY, which neither table sets)
-- queries the other table without re-invoking that table's RLS policies,
-- breaking the cycle while preserving the exact same visibility semantics
-- (a listing is still only visible via a real marketplace_matches row for
-- the caller's org; a match's listing-owner branch still requires a real
-- owning marketplace_listings row).

CREATE OR REPLACE FUNCTION marketplace_org_has_match_on_listing(p_listing_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace_matches mm
    WHERE mm.listing_id = p_listing_id
      AND mm.organization_id = p_org_id
  );
$$;

CREATE OR REPLACE FUNCTION marketplace_listing_owned_by_org(p_listing_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace_listings ml
    WHERE ml.id = p_listing_id
      AND ml.organization_id = p_org_id
  );
$$;

REVOKE ALL ON FUNCTION marketplace_org_has_match_on_listing(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_listing_owned_by_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_org_has_match_on_listing(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION marketplace_listing_owned_by_org(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS marketplace_listings_org_select ON marketplace_listings;
CREATE POLICY marketplace_listings_org_select ON marketplace_listings FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR marketplace_org_has_match_on_listing(
      marketplace_listings.id,
      (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS marketplace_matches_org_select ON marketplace_matches;
CREATE POLICY marketplace_matches_org_select ON marketplace_matches FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR marketplace_listing_owned_by_org(
      marketplace_matches.listing_id,
      (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS marketplace_matches_org_update ON marketplace_matches;
CREATE POLICY marketplace_matches_org_update ON marketplace_matches FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR marketplace_listing_owned_by_org(
      marketplace_matches.listing_id,
      (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    OR marketplace_listing_owned_by_org(
      marketplace_matches.listing_id,
      (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );
