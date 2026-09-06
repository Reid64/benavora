-- ============================================================================
-- BENAVORA - Migration 176: Agency tenancy (agencies + agency_client_organizations)
--
-- Scope: the Agency pricing tier (src/lib/utils/pricing-plans.ts AGENCY_PLANS:
-- "agency" = 5 client workspaces, "agencyScale" = 10) requires one agency
-- account to see an aggregate view across several separate client
-- organizations, each of which keeps its own fully isolated data/documents/
-- pipeline/credentials/voice library. This migration adds the schema for
-- that relationship WITHOUT touching the existing single-organization
-- isolation invariant (001_initial_schema.sql: every profiles row has
-- exactly one organization_id, and current_org_id() / every
-- *_org_isolation policy reads that single value).
--
-- An agency IS an organizations row (its own billing/branding entity, the
-- same table every other tenant uses) additionally marked as an agency via
-- a 1:1 `agencies` row. Its own profiles/current_org_id() plumbing is
-- completely unchanged, so an agency owner's session still cannot directly
-- SELECT another org's applications/opportunities/knowledge_base/etc - that
-- boundary is untouched by this migration.
--
-- agency_client_organizations is the explicit, audited link an agency
-- establishes with a client org (this pass: sales-assisted onboarding,
-- inserted by a service-role process only - see NON-GOALS below, no
-- self-serve UI yet). Its own RLS restricts SELECT to rows where
-- agency_organization_id = the caller's own current_org_id(), so one
-- agency's authenticated users can never see another agency's linkage rows
-- via this table, regardless of application-layer bugs.
--
-- Cross-client AGGREGATE data (deadline/pipeline/application counts for the
-- command-center dashboard) is a harder case: an agency owner's own session
-- has current_org_id() = their own org, so applications/opportunities RLS
-- (organization_id = current_org_id()) blocks them from directly querying a
-- client org's rows, by design - this migration does NOT weaken that.
-- Instead the two SECURITY DEFINER functions below re-verify (a) the
-- caller's own current_org_id() really is the agency org being asked about
-- and (b) that org really has an `agencies` row, before reading across the
-- linked client orgs - the "explicit, audited relationship" the task calls
-- for, mirroring this repo's only existing precedent for a controlled RLS
-- bypass (current_org_id() itself, 001_initial_schema.sql). Both functions
-- return only counts/names, never draft content, notes, contacts, or any
-- other client-sensitive column - no admin/service-role client is used in
-- any user-facing route (src/lib/supabase/admin.ts's own docstring:
-- "SERVER-ONLY... never in user-facing routes").
--
-- NON-GOALS (explicitly out of scope for this migration/pass, not silently
-- dropped): per-client staff permission granularity beyond a single
-- agency-owner role; consolidated billing; client-ready branded exports.
-- ============================================================================

CREATE TABLE IF NOT EXISTS agencies (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan             text NOT NULL DEFAULT 'agency' CHECK (plan IN ('agency', 'agency_scale')),
  workspace_limit  integer NOT NULL DEFAULT 5 CHECK (workspace_limit > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_client_organizations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id   uuid NOT NULL REFERENCES agencies(organization_id) ON DELETE CASCADE,
  client_organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_client_organizations_not_self CHECK (agency_organization_id <> client_organization_id),
  CONSTRAINT agency_client_organizations_unique UNIQUE (agency_organization_id, client_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_client_organizations_agency
  ON agency_client_organizations (agency_organization_id);
CREATE INDEX IF NOT EXISTS idx_agency_client_organizations_client
  ON agency_client_organizations (client_organization_id);

-- Enforce the plan's workspace_limit at write time (the "up to five or ten"
-- promise IS the capability being built, not a billing feature) via a
-- single BEFORE INSERT trigger - no application-layer trust required.
CREATE OR REPLACE FUNCTION enforce_agency_workspace_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit integer;
  v_current_count integer;
BEGIN
  SELECT workspace_limit INTO v_limit FROM agencies WHERE organization_id = NEW.agency_organization_id;
  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'agency_organization_id % is not a registered agency', NEW.agency_organization_id;
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM agency_client_organizations
  WHERE agency_organization_id = NEW.agency_organization_id;

  IF v_current_count >= v_limit THEN
    RAISE EXCEPTION 'agency % already has % linked client organizations, at its plan limit of %',
      NEW.agency_organization_id, v_current_count, v_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agency_client_organizations_enforce_limit ON agency_client_organizations;
CREATE TRIGGER agency_client_organizations_enforce_limit
  BEFORE INSERT ON agency_client_organizations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agency_workspace_limit();

-- ----------------------------------------------------------------------------
-- RLS - explicit-grant pattern. Public-schema default ACLs auto-grant
-- anon+authenticated full CRUD on any new table (see governance memory
-- benavora-public-schema-default-acl-anon-exposure), so both grants below
-- are made EXPLICIT via REVOKE-then-GRANT, matching migrations 172-175
-- tonight and the org-scoped-table convention in
-- src/supabase/migrations/119_org_scoped_tables_rls_hardening.sql.
-- ----------------------------------------------------------------------------

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agencies FROM anon;
REVOKE ALL ON agencies FROM authenticated;
GRANT SELECT ON agencies TO authenticated;

CREATE POLICY agencies_self_select ON agencies
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

ALTER TABLE agency_client_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agency_client_organizations FROM anon;
REVOKE ALL ON agency_client_organizations FROM authenticated;
GRANT SELECT ON agency_client_organizations TO authenticated;

CREATE POLICY agency_client_organizations_agency_select ON agency_client_organizations
  FOR SELECT TO authenticated
  USING (agency_organization_id = public.current_org_id());

-- No authenticated INSERT/UPDATE/DELETE policy on either table in this
-- pass: agency accounts and their client links are sales-assisted
-- onboarding (pricing-plans.ts's own AGENCY_PLANS comment: "sales-assisted
-- onboarding"), created by a service-role process, matching this repo's
-- demo_requests/scan_submissions precedent of admin/service-role-only
-- writes for a relationship the end-user does not self-serve yet.

-- ----------------------------------------------------------------------------
-- list_agency_client_organizations - backs GET /api/agency/clients.
-- SECURITY DEFINER: joins agency_client_organizations to organizations to
-- return the client org's name, which the caller's own RLS-scoped session
-- could never do directly (organizations_org_isolation blocks reading any
-- org row but their own). Re-checks both invariants a forged
-- p_agency_org_id could otherwise try to skip: (1) the caller really is
-- that agency (current_org_id() match) and (2) that org really is a
-- registered agency.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_agency_client_organizations(p_agency_org_id uuid)
RETURNS TABLE (
  client_organization_id uuid,
  client_name text,
  linked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_agency_org_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'not authorized for this agency' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agencies a WHERE a.organization_id = p_agency_org_id) THEN
    RAISE EXCEPTION 'not authorized for this agency' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, aco.created_at
  FROM agency_client_organizations aco
  JOIN organizations o ON o.id = aco.client_organization_id
  WHERE aco.agency_organization_id = p_agency_org_id
  ORDER BY aco.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION list_agency_client_organizations(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- agency_client_aggregate_counts - backs the /dashboard/agency command
-- center. Same SECURITY DEFINER guard as above. Returns COUNTS ONLY (never
-- draft content/notes/contacts/documents) for whatever is genuinely
-- queryable today: total application count, upcoming (next 30 days)
-- deadline count via opportunities.deadline, and a stage -> count
-- breakdown from applications.stage (pipeline_stage enum). Deliberately NOT
-- a richer dashboard than this - no revenue/award totals, no per-client
-- staff activity, no document previews.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION agency_client_aggregate_counts(p_agency_org_id uuid)
RETURNS TABLE (
  client_organization_id uuid,
  client_name text,
  application_count bigint,
  upcoming_deadline_count bigint,
  stage_counts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_agency_org_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'not authorized for this agency' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agencies a WHERE a.organization_id = p_agency_org_id) THEN
    RAISE EXCEPTION 'not authorized for this agency' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH client_orgs AS (
    SELECT aco.client_organization_id AS org_id, o.name AS org_name
    FROM agency_client_organizations aco
    JOIN organizations o ON o.id = aco.client_organization_id
    WHERE aco.agency_organization_id = p_agency_org_id
  ),
  app_counts AS (
    SELECT a.organization_id AS org_id, COUNT(*) AS cnt
    FROM applications a
    WHERE a.organization_id IN (SELECT org_id FROM client_orgs)
    GROUP BY a.organization_id
  ),
  deadline_counts AS (
    SELECT a.organization_id AS org_id, COUNT(*) AS cnt
    FROM applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    WHERE a.organization_id IN (SELECT org_id FROM client_orgs)
      AND o.deadline IS NOT NULL
      AND o.deadline > now()
      AND o.deadline < now() + interval '30 days'
    GROUP BY a.organization_id
  ),
  stage_agg AS (
    SELECT sub.organization_id AS org_id, jsonb_object_agg(sub.stage, sub.cnt) AS stage_counts
    FROM (
      SELECT a.organization_id, a.stage, COUNT(*) AS cnt
      FROM applications a
      WHERE a.organization_id IN (SELECT org_id FROM client_orgs)
      GROUP BY a.organization_id, a.stage
    ) sub
    GROUP BY sub.organization_id
  )
  SELECT
    co.org_id,
    co.org_name,
    COALESCE(ac.cnt, 0),
    COALESCE(dc.cnt, 0),
    COALESCE(sa.stage_counts, '{}'::jsonb)
  FROM client_orgs co
  LEFT JOIN app_counts ac ON ac.org_id = co.org_id
  LEFT JOIN deadline_counts dc ON dc.org_id = co.org_id
  LEFT JOIN stage_agg sa ON sa.org_id = co.org_id
  ORDER BY co.org_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION agency_client_aggregate_counts(uuid) TO authenticated;

-- ============================================================================
-- END Migration 176
-- ============================================================================
