-- 127_relationship_memory.sql
--
-- Closes a real production gap found 2026-08-07: relationship_memory,
-- relationship_recommendations, reputation_signals, and reputation_alerts
-- were all defined in src/supabase/migrations/076_reputation_intelligence.sql
-- but confirmed absent from the live database via a direct to_regclass()
-- check against DATABASE_URL (all 4 returned null, re-verified against
-- information_schema.tables). This contradicts FEATURE_REGISTRY_v2.md row
-- #147's prior claim that reputation_signals/reputation_alerts were
-- "confirmed real and actively written by the live nightly path" — that
-- claim was wrong or stale; see STATE_OF_THE_BUILD.md's 2026-08-07 entry.
--
-- Two real, already-live-tested consumers depend on this schema and were
-- failing with "Could not find the table ... in the schema cache" on every
-- run: RelationshipBuilderAgent (src/lib/agents/relationship-builder-agent.ts,
-- agentId "ag-19-relationship") reads/writes relationship_memory and
-- relationship_recommendations; ReputationIntelligenceAgent
-- (src/lib/intelligence/reputation-agent.ts, agentId "ag-18-reputation")
-- writes reputation_signals, reputation_alerts, and relationship_memory.
--
-- Column shapes below are copied verbatim from 076 and cross-checked against
-- every .from(...)/.select(...)/.insert(...) call site in both consumer
-- files — no column was renamed or reshaped, since the existing, real,
-- already-tested code already assumes this exact shape (org_id, not
-- organization_id, on the three org-scoped tables — a deliberate deviation
-- from migration 094's usual organization_id convention, kept as-is to match
-- the live code rather than the newer convention).
--
-- RLS: none of the 4 tables had a policy in 076 originally. Per this
-- project's public-schema-default-ACL gap (anon+authenticated get full CRUD
-- on any new table with no RLS), and confirmed live here —
-- src/app/api/intelligence/reputation/route.ts's own header comment already
-- flags "reputation_alerts carries no RLS policy... trusting a query param
-- would let one org read another's alerts" as a known gap it works around
-- with manual org_id filtering in application code. That route's supabase
-- client is the session-scoped SSR client (subject to RLS), not a
-- service-role client, so today it is a real, live anon/authenticated
-- cross-org exposure surface, not just a hypothetical. Real RLS added here
-- as defense-in-depth, matching migration 094's organization-scoping
-- pattern but keyed on org_id (this schema's real column name).
--
-- reputation_signals itself carries no org_id/organization_id at all (by
-- design, per reputation-agent.ts's own comments — a signal is about an
-- entity, not scoped to one org) — RLS is still enabled with a
-- service-role-only policy (no permissive USING clause), matching the
-- posture already used elsewhere in this schema for worker-owned,
-- no-per-tenant-owner tables.

CREATE TABLE IF NOT EXISTS reputation_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  entity_type  text NOT NULL,
  signal_type  text NOT NULL,
  severity     text NOT NULL DEFAULT 'yellow',
  headline     text NOT NULL,
  summary      text,
  source_url   text,
  signal_date  date,
  verified     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id   uuid REFERENCES reputation_signals(id),
  status      text NOT NULL DEFAULT 'unread',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationship_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL,
  entity_type  text NOT NULL DEFAULT 'funder',
  memory_type  text NOT NULL,
  content      text NOT NULL,
  signal_date  date,
  actioned     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationship_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id           uuid NOT NULL,
  entity_type         text NOT NULL DEFAULT 'funder',
  recommendation_text text NOT NULL,
  urgency             text NOT NULL DEFAULT 'normal',
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_alerts_org ON reputation_alerts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_rel_memory_org ON relationship_memory(org_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_recs_org ON relationship_recommendations(org_id, status);

-- RLS -------------------------------------------------------------------

ALTER TABLE reputation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_recommendations ENABLE ROW LEVEL SECURITY;

-- reputation_signals has no org column; only the service role (which
-- bypasses RLS entirely) should ever read/write it directly. No permissive
-- policy is created, so anon/authenticated get zero access by default once
-- RLS is enabled.

DROP POLICY IF EXISTS "reputation_alerts_org" ON reputation_alerts;
CREATE POLICY "reputation_alerts_org" ON reputation_alerts
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "relationship_memory_org" ON relationship_memory;
CREATE POLICY "relationship_memory_org" ON relationship_memory
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "relationship_recommendations_org" ON relationship_recommendations;
CREATE POLICY "relationship_recommendations_org" ON relationship_recommendations
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
