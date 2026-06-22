-- Migration 058: Backfill deadlines table from opportunities.deadline
--
-- Research agents (grants-gov, sam-gov, etc.) insert opportunities with deadline
-- dates but historically did not create corresponding deadlines table entries.
-- The Deadlines page reads from the deadlines table, not opportunities.deadline,
-- so all existing opportunities with deadlines were invisible on the calendar.
--
-- This creates application_deadline records for any opportunity that has a
-- deadline date but no existing application_deadline in the deadlines table.

INSERT INTO deadlines (
  organization_id,
  opportunity_id,
  deadline_type,
  due_date,
  title,
  is_completed,
  created_at,
  updated_at
)
SELECT
  o.organization_id,
  o.id,
  'application_deadline'::deadline_type,
  o.deadline,
  o.name || ' – Application Deadline',
  false,
  now(),
  now()
FROM opportunities o
WHERE o.deadline IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM deadlines d
    WHERE d.opportunity_id = o.id
      AND d.deadline_type = 'application_deadline'
  );
