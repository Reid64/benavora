-- ============================================================================
-- BENAVORA - Migration 165: Prospect Intelligence Layer -- BEN-QLF-01
-- Mission Affinity Assessment detail table
--
-- BEN-QLF-01 (Mission Affinity Agent, pil_agent_registry migration 155)
-- writes its single blended score to pil_prospect_opportunities.
-- mission_affinity_score (0-1, migration 150), same as BEN-QLF-04's own
-- interim self-scoring of that dimension. That column alone gives callers a
-- number with no visibility into which of the agent's six named dimensions
-- (Cause Alignment, Population Alignment, Program Alignment, Geographic
-- Alignment, Recency, Counterevidence -- PROSPECT_INTELLIGENCE_AGENTS.md
-- section BEN-QLF-01) drove it. This table persists the full per-dimension
-- breakdown, the evidence it drew on, and any counterevidence/unscored-
-- dimension caveats, so BEN-QLF-04 (once its later upgrade prompt wires it
-- to consume this) and any human reviewer can see the "why," not just the
-- "what" -- matching BEN-QLF-04's own header note that a high score with no
-- inspectable supporting evidence is a documented failure criterion for this
-- family.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) per repo convention. RLS/REVOKE
-- pattern matches pil_contradictions and pil_source_registry exactly
-- (migration 153): org-scoped SELECT/INSERT for `authenticated`, keyed off
-- profiles.organization_id, RLS enabled, anon revoked. No UPDATE/DELETE
-- policy -- like pil_audit_log, each scoring run is a new row, not a
-- correction of a prior one; superseding assessments are found by
-- (prospect_id, computed_at DESC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pil_mission_affinity_assessments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id                 uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id               uuid REFERENCES pil_prospect_opportunities(id) ON DELETE SET NULL,
  cause_alignment_score        numeric NOT NULL DEFAULT 0,
  population_alignment_score   numeric,
  program_alignment_score      numeric NOT NULL DEFAULT 0,
  geographic_alignment_score   numeric NOT NULL DEFAULT 0,
  recency_score                numeric NOT NULL DEFAULT 0,
  overall_score                numeric NOT NULL,
  counterevidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  unscored_dimensions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence                    numeric NOT NULL DEFAULT 0,
  computed_by_agent_id          text NOT NULL DEFAULT 'BEN-QLF-01',
  computed_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_mission_affinity_prospect ON pil_mission_affinity_assessments(prospect_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pil_mission_affinity_org ON pil_mission_affinity_assessments(organization_id);

ALTER TABLE pil_mission_affinity_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_mission_affinity_assessments FROM anon;

CREATE POLICY pil_mission_affinity_assessments_org_select ON pil_mission_affinity_assessments FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_mission_affinity_assessments_org_insert ON pil_mission_affinity_assessments FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- BEN-QLF-02 Funding Eligibility Assessment detail table
--
-- BEN-QLF-02 (Funding Eligibility Agent, pil_agent_registry migration 155)
-- determines whether a foundation/corporate/program prospect is actually
-- available to the tenant across six named dimensions (Applicant Class, Tax
-- Status, Geography, Program Restrictions, Deadline/Window, Required
-- Prerequisites -- PROSPECT_INTELLIGENCE_AGENTS.md section BEN-QLF-02). This
-- table persists a nullable-boolean pass/fail per dimension plus the
-- aggregate `eligible` determination, so a caller reading the detail table
-- can distinguish "confirmed ineligible" (an explicit false with a specific
-- disqualifying_reasons entry) from "unknown" (every dimension null, no
-- eligibility evidence on file at all) even though BEN-QLF-04's own
-- fundingEligibility===0 disqualification check treats both the same way
-- numerically. Batched into this same migration file as
-- pil_mission_affinity_assessments -- both are Family 5 (Qualification &
-- Decision Intelligence) per-dimension assessment detail tables landing in
-- the same build batch, not two unrelated schema changes.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) per repo convention. RLS/REVOKE
-- pattern matches pil_mission_affinity_assessments above exactly: org-scoped
-- SELECT/INSERT for `authenticated`, keyed off profiles.organization_id, RLS
-- enabled, anon revoked. No UPDATE/DELETE policy -- each determination run is
-- a new row, not a correction of a prior one; superseding assessments are
-- found by (prospect_id, computed_at DESC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pil_funding_eligibility_assessments (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id                uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id              uuid REFERENCES pil_prospect_opportunities(id) ON DELETE SET NULL,
  eligible                    boolean,
  applicant_class_pass        boolean,
  tax_status_pass             boolean,
  geography_pass               boolean,
  program_restrictions_pass    boolean,
  deadline_window_pass         boolean,
  prerequisites_pass           boolean,
  disqualifying_reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence                    numeric NOT NULL DEFAULT 0,
  computed_by_agent_id          text NOT NULL DEFAULT 'BEN-QLF-02',
  computed_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_funding_eligibility_prospect ON pil_funding_eligibility_assessments(prospect_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pil_funding_eligibility_org ON pil_funding_eligibility_assessments(organization_id);

ALTER TABLE pil_funding_eligibility_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_funding_eligibility_assessments FROM anon;

CREATE POLICY pil_funding_eligibility_assessments_org_select ON pil_funding_eligibility_assessments FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_funding_eligibility_assessments_org_insert ON pil_funding_eligibility_assessments FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- BEN-QLF-03 Philanthropic Capacity & Propensity Assessment detail table
--
-- BEN-QLF-03 (Philanthropic Capacity & Propensity Agent, pil_agent_registry
-- migration 155) combines wealth-capacity evidence (BEN-INT-08) and giving-
-- behavior evidence (BEN-INT-07) into two SEPARATE calibrated outputs per its
-- mission ("Combine capacity and behavior evidence without conflating them")
-- and its documented failure criterion ("Capacity and propensity are blended
-- into an unexplained single score with no dimensional breakdown"). This
-- table's column groups mirror that hard separation: capacity_* columns are
-- derived only from BEN-INT-08 wealth evidence; propensity_*/giving_pattern_
-- summary/vehicle_use columns are derived only from BEN-INT-07 giving-history
-- evidence. Neither group is ever averaged into the other, in this table or
-- anywhere BEN-QLF-03.ts computes them. `pil_prospect_opportunities.
-- capacity_estimate_low/high` (migration 150) also gets this same capacity
-- range written to it (BEN-QLF-01's own precedent of writing both a blended
-- opportunity-level column and a detail-table breakdown), but that
-- opportunity-level pair of columns has no propensity counterpart to
-- conflate with -- propensity only ever lives here.
--
-- Batched into this same migration file as pil_mission_affinity_assessments/
-- pil_funding_eligibility_assessments -- all three are Family 5
-- (Qualification & Decision Intelligence) per-dimension assessment detail
-- tables.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) per repo convention. RLS/REVOKE
-- pattern matches the two tables above exactly: org-scoped SELECT/INSERT for
-- `authenticated`, keyed off profiles.organization_id, RLS enabled, anon
-- revoked. No UPDATE/DELETE policy -- each determination run is a new row,
-- not a correction of a prior one; superseding assessments are found by
-- (prospect_id, computed_at DESC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pil_capacity_propensity_assessments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id              uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id            uuid REFERENCES pil_prospect_opportunities(id) ON DELETE SET NULL,
  capacity_estimate_low     numeric,
  capacity_estimate_high    numeric,
  capacity_confidence       numeric NOT NULL DEFAULT 0,
  capacity_basis             jsonb NOT NULL DEFAULT '[]'::jsonb,
  propensity_score           numeric NOT NULL DEFAULT 0,
  propensity_confidence      numeric NOT NULL DEFAULT 0,
  giving_pattern_summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  vehicle_use                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  cause_relevance_score       numeric NOT NULL DEFAULT 0,
  uncertainty_notes            text,
  evidence_refs                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_by_agent_id          text NOT NULL DEFAULT 'BEN-QLF-03',
  computed_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_capacity_propensity_prospect ON pil_capacity_propensity_assessments(prospect_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pil_capacity_propensity_org ON pil_capacity_propensity_assessments(organization_id);

ALTER TABLE pil_capacity_propensity_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_capacity_propensity_assessments FROM anon;

CREATE POLICY pil_capacity_propensity_assessments_org_select ON pil_capacity_propensity_assessments FOR SELECT TO authenticated USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_capacity_propensity_assessments_org_insert ON pil_capacity_propensity_assessments FOR INSERT TO authenticated WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- BEN-QLF-05 Timing and Readiness Assessment detail table
--
-- BEN-QLF-05 (Timing and Readiness Agent, pil_agent_registry migration 155)
-- determines whether an opportunity should be approached now, cultivated
-- first, monitored, or deferred across six named dimensions (Application
-- Window, Trigger Recency, Relationship Maturity, Tenant Readiness, Document
-- Readiness, Staleness And Monitor Conditions -- PROSPECT_INTELLIGENCE_
-- AGENTS.md section BEN-QLF-05). This table persists the full per-dimension
-- breakdown behind the single pil_prospect_opportunities.timing_status
-- column (migration 150, ProspectOpportunityTimingStatus enum) this agent
-- also writes -- same detail-table-alongside-blended-column pattern as the
-- three Family 5 tables above it in this file.
--
-- Batched into this same migration file as pil_mission_affinity_assessments/
-- pil_funding_eligibility_assessments/pil_capacity_propensity_assessments --
-- all four are Family 5 (Qualification & Decision Intelligence) per-dimension
-- assessment detail tables.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) per repo convention. RLS/REVOKE
-- pattern matches the three tables above exactly: org-scoped SELECT/INSERT
-- for `authenticated`, keyed off profiles.organization_id, RLS enabled, anon
-- revoked. No UPDATE/DELETE policy -- each determination run is a new row,
-- not a correction of a prior one; superseding assessments are found by
-- (prospect_id, computed_at DESC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS pil_timing_readiness_assessments (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id                   uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id                 uuid REFERENCES pil_prospect_opportunities(id) ON DELETE SET NULL,
  timing_status                  text NOT NULL CHECK (timing_status IN ('approach_now','cultivate_first','monitor','defer')),
  application_window_open        boolean,
  trigger_recency_days            integer,
  relationship_maturity_score     numeric,
  tenant_readiness_score          numeric,
  document_readiness_score        numeric,
  monitor_conditions               jsonb NOT NULL DEFAULT '[]'::jsonb,
  staleness_flags                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  unscored_dimensions              jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence                        numeric NOT NULL DEFAULT 0,
  computed_by_agent_id              text NOT NULL DEFAULT 'BEN-QLF-05',
  computed_at                       timestamptz NOT NULL DEFAULT now(),
  created_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_timing_readiness_prospect ON pil_timing_readiness_assessments(prospect_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pil_timing_readiness_org ON pil_timing_readiness_assessments(organization_id);

ALTER TABLE pil_timing_readiness_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_timing_readiness_assessments FROM anon;

CREATE POLICY pil_timing_readiness_assessments_org_select ON pil_timing_readiness_assessments FOR SELECT TO authenticated USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_timing_readiness_assessments_org_insert ON pil_timing_readiness_assessments FOR INSERT TO authenticated WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
