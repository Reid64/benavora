-- ============================================================================
-- BENAVORA - Migration 169: Prospect Intelligence Layer -- BEN-APP-03
-- (Submission Orchestrator) registry seed + pil_submission_queue
--
-- This task commissioned BEN-APP-03 (agent 3 of 3 in the APP family:
-- application / recommendation / executor) to translate BEN-APP-01's
-- application-profile recommendations and BEN-APP-02's priority ranking into
-- concrete submission ACTIONS: can we submit, should we submit, how (portal /
-- email / direct outreach / manual research), when, and who handles it.
--
-- Same schema gap migrations 167/168 already flagged for BEN-APP-01/02,
-- recurring here: the task spec's own literal instruction was "Create
-- autoapply_submission_queue items" -- but no table by that name exists.
-- Two real candidates were considered and both are used, for two different
-- purposes:
--
--   1. `submission_queue` (migration 045) IS the real, already-wired queue
--      the real FormFillerAgent / AutoApply worker (src/app/api/agents/
--      form-filler, src/app/api/cron/autoapply) actually consumes. It is
--      funder_id/priority/automation_mode/scheduled_for only -- no room for
--      this agent's own richer decisioning (can_submit/should_submit
--      checklist results, blockers, dossier linkage, personalized pitch,
--      staff assignment, submission strategy notes) and, like every other
--      legacy (pre-PIL) table this PIL build writes near, carries no
--      per-run append-only-history convention. BEN-APP-03 still WRITES a row
--      here -- see "Integration with AutoApply" below -- because that is the
--      one and only table the real execution pipeline reads; recording this
--      agent's own decision nowhere real would make the "queue items feed
--      AutoApply" requirement fiction.
--   2. The full decision record -- including every candidate this run
--      reviewed, not just the ones actually enqueued for portal automation --
--      needs its own dedicated, append-only, org-scoped detail table,
--      matching the exact convention migrations 165/167/168 already
--      established. That table is pil_submission_queue, created below. This
--      is BEN-APP-03's own source of truth for "what did the Prospect
--      Intelligence Layer decide, and why" -- not to be confused with the
--      legacy submission_queue table's narrower "what does the automation
--      worker still need to do" role.
--
-- One row per (prospect, this run's computed_at) -- like BEN-APP-02,
-- BEN-APP-03 acts on one representative application profile per prospect
-- (the same one BEN-APP-02 already scored), since "which staff member/queue
-- slot handles this prospect" is a per-prospect operational decision, not a
-- per-request-type one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pil_agent_registry seed: BEN-APP-03
-- ----------------------------------------------------------------------------
INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref)
VALUES (
  'BEN-APP-03',
  $$Submission Orchestrator$$,
  'application',
  $$Translate BEN-APP-01/BEN-APP-02's ranked application-profile recommendations into concrete submission actions: run the can-submit checklist, apply the should-submit readiness formula, decide how to submit (AutoApply portal, email draft, direct outreach task, or manual research escalation), when, and which staff member owns it. Enqueues into the real submission_queue table for portal-eligible, submit-now items and creates pil_human_review_queue contact_outreach_approval items for every non-portal path -- it never sends an email, places a call, or fills a form itself.$$,
  'A2',
  $$Never self-certifies a submission as sent -- portal-eligible items are handed to the existing AutoApply worker (submission_queue/FormFillerAgent), which enforces its own automation_mode/queue_controls gates; every email-draft or direct-outreach path always creates a pil_human_review_queue item (review_type contact_outreach_approval) for a human to actually send/place. Also escalates (a fresh review item) any legacy submission_queue row still 'pending' more than 7 days after it was queued.$$,
  $$On demand, once BEN-APP-02 has produced a priority-ranked batch for the prospects a tenant wants moved to submission.$$,
  $$Task-directed addition -- new APP family (application/recommendation/executor), agent 3 of 3, not present in PROSPECT_INTELLIGENCE_AGENTS.md's original 7-family/44-agent list.$$
)
ON CONFLICT (agent_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- pil_submission_queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_submission_queue (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id                 uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  application_profile_id      uuid REFERENCES pil_application_profiles(id) ON DELETE SET NULL,
  priority_score_id           uuid REFERENCES pil_priority_scores(id) ON DELETE SET NULL,
  funder_id                   uuid REFERENCES funders(id) ON DELETE SET NULL,
  request_profile_id          uuid REFERENCES request_profiles(id) ON DELETE SET NULL,
  dossier_id                  uuid REFERENCES pil_prospect_dossiers(id) ON DELETE SET NULL,
  form_template_id            uuid REFERENCES form_templates(id) ON DELETE SET NULL,
  legacy_submission_queue_id  uuid REFERENCES submission_queue(id) ON DELETE SET NULL,
  can_submit                  boolean NOT NULL,
  should_submit                boolean NOT NULL,
  blockers                    text[] NOT NULL DEFAULT '{}',
  status                      text NOT NULL CHECK (status IN (
                                'submit_now', 'submit_next_30_days', 'submit_q2',
                                'needs_more_research', 'blocked'
                              )),
  submission_method           text NOT NULL CHECK (submission_method IN (
                                'portal_autoapply', 'email_draft',
                                'direct_outreach_task', 'manual_research_required',
                                'not_applicable'
                              )),
  direct_submission           jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_ask_amount        numeric(12,2),
  personalized_pitch          text,
  priority                    numeric NOT NULL DEFAULT 0,
  scheduled_submission_date   date,
  assigned_to                 text NOT NULL DEFAULT 'unassigned',
  submission_strategy         text NOT NULL,
  evidence_refs                uuid[] NOT NULL DEFAULT '{}',
  computed_by_agent_id        text NOT NULL DEFAULT 'BEN-APP-03',
  computed_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_submission_queue_prospect
  ON pil_submission_queue(organization_id, prospect_id, computed_at DESC);

-- Every row from the same execute() call shares one explicit computed_at
-- value (mirroring pil_application_profiles/pil_priority_scores' identical
-- convention), so a caller can group "this run's full reviewed batch" and
-- find "still not submitted after 7 days" without a separate run_id column.
CREATE INDEX IF NOT EXISTS idx_pil_submission_queue_run_status
  ON pil_submission_queue(organization_id, computed_at DESC, status);

ALTER TABLE pil_submission_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_submission_queue FROM anon;
CREATE POLICY pil_submission_queue_org_select ON pil_submission_queue FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_submission_queue_org_insert ON pil_submission_queue FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: each run's reviewed batch is a new set of rows,
-- not a correction of a prior run -- identical append-only convention to
-- pil_application_profiles/pil_priority_scores (migrations 167/168). Whether
-- a queued item was actually submitted is tracked on the real
-- submission_queue/autoapply_submissions tables this agent hands
-- portal-eligible rows to, not by mutating this row after the fact.
