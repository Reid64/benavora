-- ============================================================================
-- BENAVORA - Migration 159: Prospect Intelligence Layer, PIL-01 Group 10 -- Audit
--
-- Second of 4 sequential migrations (158-161) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 9-12. See migration 158's header for the batch context.
--
-- No deferred foreign keys in this file. pil_policy_decisions references
-- pil_agent_registry(agent_id) and pil_delegated_tasks(task_id), both already live from
-- migrations 155-156.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10.1 pil_audit_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type       text NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id         text NOT NULL,
  action           text NOT NULL,
  resource_type    text NOT NULL,
  resource_id      text NOT NULL,
  before_state     jsonb,
  after_state      jsonb,
  policy_decision  text,
  ip_address       inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_audit_org ON pil_audit_log(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pil_audit_resource ON pil_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_pil_audit_actor ON pil_audit_log(actor_type, actor_id);

ALTER TABLE pil_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_audit_log FROM anon;
CREATE POLICY pil_audit_log_org_select ON pil_audit_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_audit_log_org_insert ON pil_audit_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy for any role, including owner: append-only by design.
-- Corrections are new rows referencing the corrected row's id in after_state, never edits.

-- ----------------------------------------------------------------------------
-- 10.2 pil_policy_decisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_policy_decisions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_agent_id            text NOT NULL REFERENCES pil_agent_registry(agent_id),
  action_requested          text NOT NULL,
  policy_name               text NOT NULL,
  decision                  text NOT NULL CHECK (decision IN ('allow', 'deny', 'require_human')),
  reason                    text NOT NULL,
  related_delegated_task_id uuid REFERENCES pil_delegated_tasks(task_id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_policy_decisions_org ON pil_policy_decisions(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pil_policy_decisions_agent ON pil_policy_decisions(actor_agent_id, decision);

ALTER TABLE pil_policy_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_policy_decisions FROM anon;
CREATE POLICY pil_policy_decisions_org_select ON pil_policy_decisions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_policy_decisions_org_insert ON pil_policy_decisions FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
