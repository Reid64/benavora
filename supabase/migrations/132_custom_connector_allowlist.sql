-- Migration 132 — custom_connector_allowlist (FEATURE_REGISTRY_v2.md rows #59/#60).
--
-- Custom API Connectors and Scraping Targets let an org admin point this
-- platform's server at an arbitrary URL, which is a real SSRF-capable
-- surface. This table is the *domain allowlist* half of the defense: an
-- admin/owner explicitly lists which domains a connector is allowed to
-- target, separate from (and in addition to) the runtime IP-resolution
-- check in src/lib/security/safe-fetch.ts. A writer creating a connector
-- can only point it at an already-allowlisted domain; execution re-checks
-- this table every run, so removing a domain immediately stops any
-- connector still configured against it.
--
-- Deliberately admin-managed, not end-user-configurable — see
-- src/lib/security/custom-connector-allowlist.ts. Role enforcement
-- (admin/owner only for writes, any authenticated org member for reads)
-- happens at the API route layer via requireRole, matching every other
-- admin-gated settings resource in this codebase. RLS below is the org-
-- isolation floor (org A can never read/write org B's allowlist rows even
-- if a route-layer check were ever missed), following the org-scoped
-- hardening pattern established in 121_opportunity_probability_scores_rls_hardening.sql —
-- FOR ALL / TO authenticated / USING + WITH CHECK both pinned to the
-- caller's own organization_id via profiles, with the anon/authenticated
-- default-ACL grant explicitly revoked first per the standing
-- public-schema-default-acl finding (every new table is anon-exposed by
-- default unless revoked).

CREATE TABLE IF NOT EXISTS custom_connector_allowlist (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id),
  domain            text          NOT NULL,
  label             text,
  created_by        uuid          REFERENCES profiles(id),
  created_at        timestamptz   DEFAULT now(),
  UNIQUE (organization_id, domain)
);

ALTER TABLE custom_connector_allowlist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON custom_connector_allowlist FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_connector_allowlist TO authenticated;

CREATE POLICY custom_connector_allowlist_org_isolation
  ON custom_connector_allowlist
  FOR ALL
  TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_custom_connector_allowlist_org
  ON custom_connector_allowlist(organization_id);
