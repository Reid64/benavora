CREATE TABLE IF NOT EXISTS worker_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'online',
  last_heartbeat_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz NOT NULL DEFAULT NOW(),
  current_item_id uuid REFERENCES submission_queue(id),
  items_processed integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  version text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submission_queue_pending
  ON submission_queue (priority ASC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_domain
  ON autoapply_submissions (funder_id, submitted_at DESC);
