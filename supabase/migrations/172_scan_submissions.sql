-- ============================================================================
-- BENAVORA - Migration 172: scan_submissions
--
-- Backs POST /api/public/scan (src/app/api/public/scan/route.ts), the intake
-- form for the public, unauthenticated "Funding Potential Scan" at
-- src/app/(marketing)/scan/ScanClient.tsx. Visitors have no session, so this
-- is the first table in the schema that anon must be able to INSERT into.
--
-- Scope: intake + storage only. The scoring engine, report UI, and email
-- capture are separate follow-up sub-prompts and are NOT implemented here -
-- no scoring/report columns are added ahead of that work.
--
-- Public-schema default ACLs auto-grant anon+authenticated full CRUD on any
-- new table (see governance memory benavora-public-schema-default-acl-anon-
-- exposure), so anon's write access below is made EXPLICIT (GRANT INSERT +
-- an INSERT policy) rather than relying on the default grant, and anon is
-- given no SELECT/UPDATE/DELETE at all - submissions are write-only from the
-- public's side. There is no organization_id (the submitter isn't a
-- logged-in org yet), so authenticated app users get no access either; only
-- a service-role client (future scoring/report/admin tooling) can read this
-- table until a later sub-prompt adds a real reader.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scan_submissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  org_name_or_website   text NOT NULL,
  ein                   text,
  state                 text NOT NULL,
  primary_mission       text NOT NULL,
  funding_priority      text NOT NULL CHECK (funding_priority IN (
                          'general_operating', 'program_or_project', 'capital_campaign',
                          'emergency_response', 'capacity_building', 'other'
                        )),

  ip_hash               text,
  user_agent            text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_submissions_ip_hash_created
  ON scan_submissions(ip_hash, created_at DESC);

ALTER TABLE scan_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON scan_submissions FROM anon;
REVOKE ALL ON scan_submissions FROM authenticated;

GRANT INSERT ON scan_submissions TO anon;

CREATE POLICY scan_submissions_anon_insert ON scan_submissions
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================================
-- END Migration 172
-- ============================================================================
