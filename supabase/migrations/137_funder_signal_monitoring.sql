-- Migration 137: Funder Signal Monitoring (AG-43)
-- FEATURE_REGISTRY_v2.md row #99 ("Signal Monitoring"), Pillar 4 (Autonomous
-- Relationship Builder), Phase 2.
--
-- Same underlying pattern as AG-30 Donor Intent Monitor (migration 093,
-- src/lib/agents/donor-intent-monitor-agent.ts): grounded web search +
-- Claude extraction of structured signals, scored, deduped, and surfaced as
-- a recommended action for a human. Retargeted from "will this corporate
-- prospect start giving" to "does this org's own funder show a real,
-- actionable relationship-building signal" - a distinct question from AG-18
-- Reputation Intelligence (migration 076/127), which screens for RISK
-- (lawsuit/fraud/scandal), not relationship opportunity.
--
-- Scope, deliberately narrowed from this row's original "LinkedIn + news +
-- 990 watching" description: LinkedIn is explicitly EXCLUDED. LinkedIn has
-- no public API for monitoring third-party posts/pages without a paid
-- partner integration this project does not have; scraping LinkedIn directly
-- would violate LinkedIn's Terms of Service (a real legal/ToS risk, not a
-- technical blocker to route around - matching BEHAVIORAL_CONTRACTS.md's own
-- existing "NEVER contact competitors or scrape their websites" posture in
-- §27). This agent covers only the two real, ToS-safe sources: grounded web
-- search ("news", signal_type IN leadership_change/board_appointment/
-- funding_priority_announcement/program_expansion/public_recognition) and
-- real IRS 990 data already on file in foundation_directory (signal_type
-- '990_filing', deterministic - no Claude call for this half, matching the
-- deterministic-geo-factor precedent AG-30 already set for non-LLM-judged
-- facts).
--
-- funder_id (not company_name) because, unlike corporate_intent_signals'
-- shared/unclaimed corporate_prospects pool, this agent's targets are the
-- calling org's own org-scoped `funders` CRM rows - a direct FK is the
-- correct, available join, not a free-text name match.

CREATE TABLE IF NOT EXISTS funder_relationship_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id             uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  source                text NOT NULL CHECK (source IN ('news', '990_filing')),
  signal_type           text NOT NULL CHECK (signal_type IN (
                           'leadership_change',
                           'board_appointment',
                           'funding_priority_announcement',
                           'program_expansion',
                           'public_recognition',
                           '990_filing'
                         )),
  signal_summary        text NOT NULL,
  signal_url            text,
  signal_date           date,
  relationship_score    integer CHECK (relationship_score BETWEEN 0 AND 100),
  mission_alignment     integer CHECK (mission_alignment BETWEEN 0 AND 100),
  recommended_action    text,
  recommended_deadline  date,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE funder_relationship_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funder_relationship_signals_org ON funder_relationship_signals;
CREATE POLICY funder_relationship_signals_org ON funder_relationship_signals
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_funder_rel_signals_org
  ON funder_relationship_signals(org_id, relationship_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funder_rel_signals_funder
  ON funder_relationship_signals(funder_id, signal_type, created_at DESC);

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-43-funder-signals';
