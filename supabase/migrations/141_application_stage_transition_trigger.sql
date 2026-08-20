-- 141_application_stage_transition_trigger.sql — enforce the application
-- stage-transition state machine at the database layer (WGR-130/WGR-131).
--
-- Problem (test-evidence/_register/WIRING_GAP_REGISTER.md WGR-130/WGR-131):
-- the legal stage-transition graph (BEHAVIORAL_CONTRACTS §6,
-- src/components/applications/pipeline.ts's FORWARD const + getTransitionRule())
-- is enforced ONLY in application code, and only by the one call site
-- (StageTransitionModal.tsx) that bothers to check getTransitionRule() before
-- calling executeTransition(). Neither executeTransition() itself nor a raw
-- `supabase.from('applications').update({stage:...})` (no executeTransition()
-- call at all) enforces anything — both live-confirmed to persist an illegal
-- stage skip (e.g. discovered -> awarded, skipping 10 of 12 stages) with no
-- error. RLS (applications_org_isolation) scopes rows by organization_id only
-- and has no opinion on what value `stage` may transition to. There is no
-- existing admin-override/force-transition path anywhere in the app design
-- (confirmed by repo-wide search) — this trigger has no bypass.
--
-- This migration transcribes the CANONICAL legal-transition graph directly
-- from pipeline.ts's FORWARD const and getTransitionRule() (the single
-- source of truth the app itself uses) and enforces the same (OLD.stage,
-- NEW.stage) legality check as a BEFORE UPDATE trigger, so no write path —
-- app code, a future API route, a script, or a raw REST call — can bypass it.
--
-- Legal transition = TRUE iff:
--   (a) (OLD.stage, NEW.stage) is one of the 16 explicit forward edges below
--       (transcribed verbatim from pipeline.ts's FORWARD const), OR
--   (b) NEW.stage's rank in the canonical 12-stage linear order
--       (PIPELINE_STAGES, src/lib/utils/constants.ts) is strictly lower than
--       OLD.stage's rank — i.e. any move to an earlier stage. This mirrors
--       getTransitionRule()'s own "any backward move is allowed, with a
--       mandatory note" rule exactly; the trigger enforces only the
--       structural (from,to) legality, the same layer the app's own
--       requiresNote UI-level requirement sits above, not the per-edge
--       business conditions (eligibility_score_exists, draft_not_empty,
--       etc.) — those depend on joined data (opportunities, documents) that
--       is out of scope for a single-row trigger and remains an app-layer
--       concern, same division of labor the app itself already has between
--       getTransitionRule() (structural) and evaluateCondition() (data).
--
-- Deliberately does NOT special-case denied->discovered or
-- renewal_opportunity->discovered as "forward" edges the way pipeline.ts's
-- FORWARD const does — both already satisfy rule (b) (discovered is rank 1,
-- the lowest, so a move to it from anywhere is always a backward move) so
-- listing them again would be redundant, not a divergence from the app's
-- real behavior.

-- pipeline_stage_rank() — the canonical linear order, transcribed verbatim
-- from PIPELINE_STAGES (src/lib/utils/constants.ts). STABLE, not IMMUTABLE:
-- depends only on its argument, never on table state, but kept STABLE to
-- match this project's existing convention for small lookup functions.
CREATE OR REPLACE FUNCTION public.pipeline_stage_rank(stage public.pipeline_stage)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE stage
    WHEN 'discovered'          THEN 1
    WHEN 'eligibility_review'  THEN 2
    WHEN 'qualified'           THEN 3
    WHEN 'drafting'            THEN 4
    WHEN 'awaiting_documents'  THEN 5
    WHEN 'ready_for_review'    THEN 6
    WHEN 'submitted'           THEN 7
    WHEN 'follow_up_due'       THEN 8
    WHEN 'awarded'             THEN 9
    WHEN 'denied'              THEN 10
    WHEN 'reporting_required'  THEN 11
    WHEN 'renewal_opportunity' THEN 12
  END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_application_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_legal_forward_edge boolean;
BEGIN
  -- (a) explicit forward edges, transcribed verbatim from pipeline.ts's
  -- FORWARD const (16 edges across all 12 stages).
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('discovered',          'eligibility_review'),
      ('eligibility_review',  'qualified'),
      ('eligibility_review',  'denied'),
      ('qualified',           'drafting'),
      ('drafting',            'awaiting_documents'),
      ('awaiting_documents',  'ready_for_review'),
      ('ready_for_review',    'submitted'),
      ('submitted',           'follow_up_due'),
      ('submitted',           'awarded'),
      ('submitted',           'denied'),
      ('follow_up_due',       'awarded'),
      ('follow_up_due',       'denied'),
      ('awarded',             'reporting_required'),
      ('denied',              'discovered'),
      ('reporting_required',  'renewal_opportunity'),
      ('renewal_opportunity', 'discovered')
    ) AS forward_edges(from_stage, to_stage)
    WHERE forward_edges.from_stage = OLD.stage::text
      AND forward_edges.to_stage = NEW.stage::text
  ) INTO is_legal_forward_edge;

  IF is_legal_forward_edge THEN
    RETURN NEW;
  END IF;

  -- (b) any backward move (to a strictly earlier stage in the canonical order).
  IF public.pipeline_stage_rank(NEW.stage) < public.pipeline_stage_rank(OLD.stage) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal application stage transition: % -> % is not a legal forward edge or backward move.', OLD.stage, NEW.stage
    USING ERRCODE = '23514', -- check_violation
          HINT = 'See src/components/applications/pipeline.ts FORWARD const / getTransitionRule() for the legal transition graph.';
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_application_stage_transition ON public.applications;
CREATE TRIGGER trg_enforce_application_stage_transition
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
  EXECUTE FUNCTION public.enforce_application_stage_transition();
