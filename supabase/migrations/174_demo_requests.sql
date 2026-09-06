-- ============================================================================
-- BENAVORA - Migration 174: demo_requests
--
-- Backs POST /api/public/demo (src/app/api/public/demo/route.ts), the intake
-- form for the tailored-demo flow at /demo (src/app/(marketing)/demo/
-- DemoClient.tsx). Anonymous, unauthenticated visitors submit this before
-- ever seeing the Calendly booking step - same anon-INSERT-only shape as
-- scan_submissions (migration 172), which this table otherwise doesn't
-- relate to: the Funding Potential Scan and the tailored demo are two
-- separate outline-specified entry points (BENAVORA MARKETING PAGE.docx
-- section 5, "Four levels of product engagement").
--
-- Exactly the four fields the outline specifies (section 6, "Use only four
-- fields before showing the calendar") - work email, organization website,
-- role, primary funding challenge. `role` is a fixed enum matching the
-- named decision-maker personas in section 14 ("Build for multiple
-- decision-makers"); `primary_funding_challenge` is free text, same
-- open-ended shape as scan_submissions.primary_mission, since the outline
-- does not specify a fixed taxonomy for it.
--
-- Public-schema default ACLs auto-grant anon+authenticated full CRUD on any
-- new table (see governance memory benavora-public-schema-default-acl-anon-
-- exposure), so anon's write access below is made EXPLICIT (GRANT INSERT +
-- an INSERT policy), matching migrations 172/173's pattern exactly: anon can
-- INSERT and nothing else - no SELECT/UPDATE/DELETE. Only a service-role
-- client (future sales-ops tooling) can read this table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  work_email                  text NOT NULL,
  org_website                 text NOT NULL,
  role                        text NOT NULL CHECK (role IN (
                                'executive_director', 'development_director', 'grant_writer',
                                'cfo', 'it_security', 'board_member', 'consultant', 'other'
                              )),
  primary_funding_challenge   text NOT NULL,

  ip_hash                     text,
  user_agent                  text,

  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_ip_hash_created
  ON demo_requests(ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_requests_work_email
  ON demo_requests(work_email);

ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON demo_requests FROM anon;
REVOKE ALL ON demo_requests FROM authenticated;

GRANT INSERT ON demo_requests TO anon;

CREATE POLICY demo_requests_anon_insert ON demo_requests
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================================================
-- END Migration 174
-- ============================================================================
