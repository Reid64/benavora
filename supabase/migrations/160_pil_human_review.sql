-- ============================================================================
-- BENAVORA - Migration 160: Prospect Intelligence Layer, PIL-01 Group 11 -- Human Review Queue
--
-- Third of 4 sequential migrations (158-161) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 9-12. See migration 158's header for the batch context.
--
-- No deferred foreign keys in this file. pil_human_review_queue.requested_by_agent_id
-- references pil_agent_registry(agent_id) (migration 155) and .assigned_to_user_id
-- references the existing profiles(id) table; pil_human_review_decisions.review_id/
-- decided_by_user_id reference pil_human_review_queue(id) (created earlier in this same
-- file) and profiles(id).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 11.1 pil_human_review_queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_human_review_queue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_type          text NOT NULL CHECK (review_type IN (
                          'identity_linkage', 'capacity_determination', 'policy_exception',
                          'autonomy_increase', 'high_impact_action', 'critic_block',
                          'contact_outreach_approval'
                        )),
  subject_type         text NOT NULL,
  subject_id           uuid NOT NULL,
  requested_by_agent_id text REFERENCES pil_agent_registry(agent_id),
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'in_review', 'approved', 'rejected', 'changes_requested', 'expired'
                        )),
  summary              text NOT NULL,
  evidence_refs        jsonb NOT NULL DEFAULT '[]',
  assigned_to_user_id  uuid REFERENCES profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pil_review_queue_org_status ON pil_human_review_queue(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_pil_review_queue_subject ON pil_human_review_queue(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_pil_review_queue_assignee ON pil_human_review_queue(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

ALTER TABLE pil_human_review_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_human_review_queue FROM anon;
CREATE POLICY pil_review_queue_org_select ON pil_human_review_queue FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_review_queue_org_insert ON pil_human_review_queue FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_review_queue_org_update ON pil_human_review_queue FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 11.2 pil_human_review_decisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_human_review_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES pil_human_review_queue(id) ON DELETE CASCADE,
  decided_by_user_id uuid NOT NULL REFERENCES profiles(id),
  decision         text NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  rationale        text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_review_decisions_review ON pil_human_review_decisions(review_id);

ALTER TABLE pil_human_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_human_review_decisions FROM anon;
CREATE POLICY pil_review_decisions_select ON pil_human_review_decisions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_human_review_queue q WHERE q.id = review_id
      AND q.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_review_decisions_insert ON pil_human_review_decisions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_human_review_queue q WHERE q.id = review_id
      AND q.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ) AND decided_by_user_id = auth.uid());
