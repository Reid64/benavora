-- Migration 089: financial reconciliation additions.
--
-- grant_budgets and grant_expenses already exist (migration 084) with a
-- narrower schema than this feature needs (fixed personnel/supplies/
-- equipment/other columns, no line-item breakdown, no receipt attachment,
-- and expenses only link to a budget row, not directly to an application).
-- Rather than dropping/recreating those tables, this migration extends them
-- additively and adds the one genuinely missing table
-- (grant_reconciliation_reports) for the new /api/applications/[id]/reconcile
-- endpoint to upsert into.

ALTER TABLE grant_budgets
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS total_approved numeric,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE grant_expenses
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- Backfill application_id on existing expense rows from their parent budget,
-- so the new application-scoped route can query by application_id alone.
UPDATE grant_expenses ge
SET application_id = gb.application_id
FROM grant_budgets gb
WHERE ge.budget_id = gb.id
  AND ge.application_id IS NULL
  AND gb.application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grant_expenses_application ON grant_expenses(application_id);

CREATE TABLE IF NOT EXISTS grant_reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  total_budget numeric,
  total_spent numeric,
  variance numeric,
  compliance_status text,
  generated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, application_id)
);

ALTER TABLE grant_reconciliation_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grant_reconciliation_reports_org" ON grant_reconciliation_reports
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_grant_reconciliation_reports_org
  ON grant_reconciliation_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_grant_reconciliation_reports_application
  ON grant_reconciliation_reports(application_id);
