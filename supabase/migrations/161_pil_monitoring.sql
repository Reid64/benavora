-- ============================================================================
-- BENAVORA - Migration 161: Prospect Intelligence Layer, PIL-01 Group 12 -- Monitoring
--
-- Fourth of 4 sequential migrations (158-161) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 9-12, closing out the PIL-01 batch (150-161, all 12 schema groups / 31 tables --
-- see PROSPECT_INTELLIGENCE_SCHEMA.md's "Table count" section).
--
-- No deferred foreign keys in this file. pil_monitoring_events references
-- pil_agent_registry(agent_id) and pil_evidence(id), both already live from migrations
-- 153 and 155.
--
-- With this migration, every forward-referencing FK named in
-- PROSPECT_INTELLIGENCE_SCHEMA.md's "Cross-group foreign key summary" has been added:
-- pil_prospects.created_by_agent_id, pil_prospect_classifications.evidence_id,
-- pil_evidence.research_run_id, and pil_agent_runs.delegated_task_id were all backfilled
-- in migrations 154-156. No table in this file introduces a new deferred reference.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 12.1 pil_monitoring_subscriptions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_monitoring_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  trigger_types    text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_monitoring_subs_org ON pil_monitoring_subscriptions(organization_id, status);

ALTER TABLE pil_monitoring_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_monitoring_subscriptions FROM anon;
CREATE POLICY pil_monitoring_subs_org_select ON pil_monitoring_subscriptions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_subs_org_insert ON pil_monitoring_subscriptions FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_subs_org_update ON pil_monitoring_subscriptions FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 12.2 pil_monitoring_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_monitoring_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id           uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  trigger_type          text NOT NULL CHECK (trigger_type IN (
                           'company_sale', 'acquisition', 'ipo', 'executive_appointment',
                           'retirement', 'foundation_appointment', 'board_appointment',
                           'new_nonprofit_affiliation', 'major_charitable_gift',
                           'new_foundation_filing', 'corporate_giving_program_launch',
                           'geographic_expansion', 'significant_business_event',
                           'philanthropic_announcement'
                         )),
  detected_by_agent_id  text NOT NULL REFERENCES pil_agent_registry(agent_id),
  evidence_id           uuid REFERENCES pil_evidence(id),
  impact_assessment     jsonb NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'dismissed')),
  detected_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_monitoring_events_org_status ON pil_monitoring_events(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_monitoring_events_prospect ON pil_monitoring_events(prospect_id, detected_at DESC);

ALTER TABLE pil_monitoring_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_monitoring_events FROM anon;
CREATE POLICY pil_monitoring_events_org_select ON pil_monitoring_events FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_events_org_insert ON pil_monitoring_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_events_org_update ON pil_monitoring_events FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
