-- AR-17.6: one-time backfill correcting 42,515 historical ag-29-knowledge-
-- indexer agent_runs rows that recorded status='completed' while embedding
-- zero of the items they found (items_found > 0 AND items_processed = 0) --
-- a whole-batch embedding failure (most commonly a missing/invalid
-- OPENAI_API_KEY during that period), not a success. The AR-14.1 fix
-- (commit 5e608148) already stops this going forward for new runs
-- (status='failed' via the batchLevelFailure check); this corrects the
-- historical rows so they stop reading as successes in any retrospective
-- analysis, per AR-17.3's explicit recommendation to "backfill-correct or
-- explicitly exclude" them.
UPDATE agent_runs
SET status = 'failed',
    error_message = COALESCE(error_message, 'AR-17.6 backfill: historical whole-batch embedding failure (items_found > 0, items_processed = 0) previously mislabeled completed.')
WHERE agent_type = 'ag-29-knowledge-indexer'
  AND status = 'completed'
  AND items_found > 0
  AND items_processed = 0;
