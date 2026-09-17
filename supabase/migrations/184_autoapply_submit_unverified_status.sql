-- Migration 184: AR-3.1 AutoApply submit integrity
--
-- Adds 'submit_unverified' to autoapply_submissions.status. Previously
-- worker/queue-processor.ts set status='submitted' unconditionally whenever
-- FormFillerAgent.fillAndSubmit() returned without throwing, even though a
-- submit-button click that produces no page navigation and no POST response
-- is not proof of a real submission. FormFillerAgent now returns a
-- discriminated `outcome` ('submitted' | 'not_submitted' | 'unverified') and
-- the queue processor maps 'unverified' to this new status instead of
-- claiming a confirmed submission it cannot prove happened.

ALTER TABLE autoapply_submissions DROP CONSTRAINT IF EXISTS autoapply_submissions_status_check;

ALTER TABLE autoapply_submissions ADD CONSTRAINT autoapply_submissions_status_check CHECK (status IN (
  'queued','in_progress','submitted','failed',
  'captcha_blocked','account_required','site_error','already_submitted',
  'submit_unverified'
));
