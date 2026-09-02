-- ============================================================================
-- BENAVORA - Migration 170: Auto-create pil_research_runs on prospect insert
--
-- Task (queue-integration-pil-dossier-REAL.yaml, id: create-pil-trigger-research-run):
-- when a new pil_prospect is discovered/imported, automatically create a
-- pil_research_run to orchestrate the 9-family pipeline.
--
-- The task's inline SQL was written against that queue file's own draft schema
-- (pil_prospects.tenant_id, pil_research_runs.tenant_id/triggered_by,
-- status default 'pending') rather than the schema actually applied in
-- migrations 150-169 (PROSPECT_INTELLIGENCE_SCHEMA.md). Per migration 163's
-- precedent for this exact discrepancy, this migration uses the columns that
-- really exist:
--   - pil_prospects has organization_id, not tenant_id (migration 150).
--   - pil_research_runs has organization_id, not tenant_id, and has no
--     triggered_by column at all (migration 154).
--   - pil_research_runs.status CHECK constraint only allows
--     'planning' | 'running' | 'completed' | 'failed' | 'cancelled' -- 'pending'
--     would violate it. 'planning' is the table's own default and documented
--     initial state, so the trigger lets it default rather than setting it.
--   - pil_research_runs.initiating_agent_id is NOT NULL with a FK to
--     pil_agent_registry(agent_id) (added in migration 155). BEN-SUP-01
--     ("Chief Prospect Intelligence Orchestrator", seeded in migration 155)
--     is the agent whose documented job is exactly this: "own the persistent
--     prospect-intelligence objective for each tenant and coordinate the
--     entire research fleet" -- the natural attribution for a
--     system-initiated run.
--
-- goal_id is left NULL: this trigger's scope is limited to what the task
-- asked for (create the run), not to also synthesizing a pil_research_goals
-- row, which is BEN-SUP-02/03's concern.
--
-- SECURITY DEFINER + fixed search_path, matching this codebase's existing
-- trigger-function convention (see migration 141's
-- enforce_application_stage_transition()) -- guarantees the orchestration
-- row is always created regardless of the inserting role's own grants on
-- pil_research_runs, and closes the search_path-hijack vector SECURITY
-- DEFINER functions are otherwise exposed to.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pil_create_research_run_on_prospect_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pil_research_runs (organization_id, prospect_id, initiating_agent_id)
  VALUES (NEW.organization_id, NEW.id, 'BEN-SUP-01');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pil_prospects_auto_research ON public.pil_prospects;
CREATE TRIGGER trg_pil_prospects_auto_research
  AFTER INSERT ON public.pil_prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.pil_create_research_run_on_prospect_insert();
