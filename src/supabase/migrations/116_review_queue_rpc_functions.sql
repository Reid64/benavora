-- 116_review_queue_rpc_functions.sql
--
-- AUTOAPPLY_ARCHITECTURE_V2.md §10C "Human Review Queue UI" -- atomic,
-- concurrency-guarded conditional-UPDATE-with-RETURNING actions for
-- submission_queue rows paused at status='paused_verification' (§10B,
-- 115_autoapply_captcha_pause_columns.sql).
--
-- supabase-js's .update() builder can only send a plain-value payload -- it
-- cannot express "SET col = col || x", a SQL expression that reads the row's
-- own pre-update value. §10C's resume action needs exactly that (appending
-- the current pause_reason/paused_at into paused_history before clearing
-- them), so a stored function is required here, not a client-side .update()
-- call -- matching the existing precedent for this exact class of problem
-- (022_usage_tracking.sql's increment_usage_tracking: "Atomic increment:
-- INSERT ... ON CONFLICT DO UPDATE avoids read-modify-write races").
--
-- All three functions are SECURITY INVOKER (the default -- omitted, matching
-- 022's own convention) so submission_queue's existing RLS policies
-- (066_fix_autoapply_rls_policies.sql: organization_id = caller's own
-- profiles.organization_id) still apply when called via the session-bound
-- client from an API route's requireRole() gate. The explicit
-- organization_id = p_org_id check in each WHERE clause is defense-in-depth
-- on top of RLS, matching this codebase's established belt-and-suspenders
-- convention (role-gate.ts: "organization_id ... derived server-side, never
-- trusted from the body").
--
-- Each function returns the row's id on success, or NULL if the WHERE clause
-- (id + organization_id + expected current status) matched zero rows --
-- meaning another reviewer already acted on this row between page-load and
-- this call, or it belongs to a different org. The calling API route treats
-- a NULL return as a 409 Conflict, per §10C: "If this returns zero rows,
-- another reviewer already resumed (or skipped/reassigned) this row... The
-- API returns 409 Conflict in that case."
--
-- Deviation from §10C's literal resume SQL: the spec's own SQL sets
-- status='queued', but worker/queue-processor.ts's real poll/claim query
-- (dequeue(), ~line 408) only ever selects .eq('status', 'pending') --
-- confirmed live by reading the function body. Setting 'queued' would
-- silently strand the item forever, never claimed by the real worker,
-- directly contradicting §10C's own stated intent ("Resuming means retry
-- from the top... a fresh page navigation on the next queue pass"). This
-- function sets 'pending' instead so a resumed item is actually reprocessed.
-- See 117_submission_queue_status_check_fix.sql for the related CHECK
-- constraint fix this also required.

CREATE OR REPLACE FUNCTION resume_paused_submission_queue_item(
  p_id uuid,
  p_org_id uuid,
  p_reviewer_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET status = 'pending',
      paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'resumed',
        'reason', pause_reason,
        'paused_at', paused_at,
        'resumed_by', p_reviewer_id,
        'resumed_at', now()
      ),
      pause_reason = NULL,
      paused_at = NULL,
      paused_screenshot_path = NULL,
      resume_count = COALESCE(resume_count, 0) + 1
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION skip_paused_submission_queue_item(
  p_id uuid,
  p_org_id uuid,
  p_reason text,
  p_reviewer_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET status = 'skipped',
      paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'skipped',
        'reason', p_reason,
        'previous_pause_reason', pause_reason,
        'skipped_by', p_reviewer_id,
        'skipped_at', now()
      ),
      pause_reason = NULL,
      paused_at = NULL,
      paused_screenshot_path = NULL
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Reassign does not resolve the pause -- it only routes the item to another
-- reviewer and logs it, so status stays 'paused_verification'. The WHERE
-- guard still applies (per §10C: "the same WHERE status = '<expected
-- current status>' guard pattern applies to /skip and /reassign") so
-- reassigning a row someone else already resumed/skipped correctly reports
-- a conflict instead of silently notifying about a row no longer in play.
CREATE OR REPLACE FUNCTION reassign_paused_submission_queue_item(
  p_id uuid,
  p_org_id uuid,
  p_assignee_id uuid,
  p_reviewer_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'reassigned',
        'reassigned_to', p_assignee_id,
        'reassigned_by', p_reviewer_id,
        'reassigned_at', now()
      )
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default (which
-- includes anon/authenticated); these grants are explicit for clarity and
-- to document the intended callers -- the real access boundary is
-- submission_queue's own RLS policies (SECURITY INVOKER), not this grant.
GRANT EXECUTE ON FUNCTION resume_paused_submission_queue_item(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION skip_paused_submission_queue_item(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reassign_paused_submission_queue_item(uuid, uuid, uuid, uuid) TO authenticated;
