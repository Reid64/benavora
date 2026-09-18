-- ============================================================================
-- BENAVORA - Migration 200: AR-12.1 - deleting a funder cancels its pending
-- AutoApply queue items instead of silently orphaning them.
--
-- ROOT CAUSE (production-verified 2026-09-18 against the live project):
-- autoapply_queue_processor's recurring 'funder_not_found' skip is caused by
-- src/components/funders/FunderDetail.tsx's delete button, which runs a
-- plain `supabase.from('funders').delete().eq('id', ...)` from the browser
-- with no awareness of submission_queue. submission_queue_funder_id_fkey is
-- `ON DELETE SET NULL` (not a block), so deleting a funder that still has a
-- pending/processing queue item silently nulls that item's funder_id instead
-- of cancelling it - the worker only discovers the funder is gone minutes or
-- hours later, when it dequeues the item and the funders lookup in
-- worker/queue-processor.ts's processItem() (`.eq('id', funderId).maybeSingle()`)
-- comes back empty. That lookup itself is correct - already-verified
-- service-role (RLS-bypassing, per src/lib/supabase/admin.ts), already
-- distinguishing a query error (`funder_fetch_error`, AR-11.2's error-vs-empty
-- class) from a genuine empty result (`funder_not_found`) - so this is
-- category (d) from the AR-12.1 prompt (funder genuinely deleted after the
-- item was queued), not (b)/(c) (wrong query/RLS conflation). Live counts at
-- investigation time: 0 orphaned funder_id references, only 2 historical
-- 'funder_not_found' rows total (ever), both already terminal - this is a
-- real but rare race, not a hot loop; concurrent_automation_conflict remains
-- the dominant skip reason and is unrelated (that is AR-7.2's mutual-exclusion
-- check operating as designed, not a bug).
--
-- FIX: close the gap at its source (the database), not just the one UI entry
-- point, so ANY deletion path (this button, a future admin tool, a direct
-- SQL delete) is covered. A BEFORE DELETE trigger on funders finds every
-- non-terminal submission_queue row still pointing at the funder being
-- deleted, marks it terminal with a clear reason (so it can never be
-- retried - the worker's poll query only ever selects status='pending'), and
-- raises a manual_review_required alert via the shared
-- public.raise_orchestration_alert() helper (migration 191) so an operator
-- sees it happened instead of the item just quietly vanishing from the
-- pipeline. Mirrors migration 191's blast-radius contract: wrapped in
-- EXCEPTION WHEN OTHERS so a bug in this safety net can never block the
-- funder deletion itself.
--
-- Also included: a one-time cleanup for any pre-existing non-terminal
-- submission_queue row whose funder_id is already NULL (the FK's SET NULL
-- already fired, before this fix existed, for a delete that happened before
-- this migration). queue-processor.ts's processItem() already treats a null
-- funder_id as an immediate, terminal SkipError('no_funder_id') the moment
-- such a row is next dequeued - this just applies that same terminal state
-- retroactively instead of waiting for the next poll cycle. Live count at
-- investigation time: 0 rows match (the FK has only fired twice, ever, and
-- both resulting rows already reached 'skipped' through the normal worker
-- path) - this is insurance, not a fix for an active backlog.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One-time retroactive cleanup (idempotent: only ever touches rows that are
-- STILL non-terminal with a NULL funder_id at the time this runs).
-- ----------------------------------------------------------------------------
UPDATE public.submission_queue
SET
  status = 'skipped',
  error_message = 'no_funder_id: this item''s funder_id was cleared (its funder record no longer exists) before AR-12.1 closed this gap.',
  completed_at = now()
WHERE
  funder_id IS NULL
  AND status IN ('pending', 'processing', 'paused_verification', 'requires_account_setup', 'pending_manual');

-- ----------------------------------------------------------------------------
-- Trigger: cancel dependent submission_queue rows BEFORE a funder is deleted.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_queue_items_on_funder_delete() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT id, organization_id
    FROM public.submission_queue
    WHERE funder_id = OLD.id
      AND status IN ('pending', 'processing', 'paused_verification', 'requires_account_setup', 'pending_manual')
  LOOP
    UPDATE public.submission_queue
    SET
      status = 'skipped',
      error_message = 'funder_deleted: funder "' || COALESCE(OLD.name, OLD.id::text) || '" (' || OLD.id || ') was deleted while this item was still queued.',
      completed_at = now()
    WHERE id = v_item.id;

    PERFORM public.raise_orchestration_alert(
      v_item.organization_id,
      NULL,
      'manual_review_required',
      'warning',
      'AutoApply queue item ' || v_item.id || ' was cancelled because funder "' ||
        COALESCE(OLD.name, OLD.id::text) || '" was deleted while still queued for submission.',
      'orchestration:manual_review_required:' || v_item.id::text
    );
  END LOOP;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[cancel_queue_items_on_funder_delete] swallowed % for funder %', SQLERRM, OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_queue_items_on_funder_delete ON public.funders;
CREATE TRIGGER trg_cancel_queue_items_on_funder_delete
  BEFORE DELETE ON public.funders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_queue_items_on_funder_delete();

-- Trigger invocation is not gated by EXECUTE grants, but this function is
-- also directly callable as a PostgREST RPC by default (same default-ACL
-- behavior documented in migration 191) - lock that down the same way.
REVOKE EXECUTE ON FUNCTION public.cancel_queue_items_on_funder_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_queue_items_on_funder_delete() TO service_role;

-- ============================================================================
-- END Migration 200
-- ============================================================================
