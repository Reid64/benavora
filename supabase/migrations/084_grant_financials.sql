-- Migration 084: grant_budgets + grant_expenses - per-application budget
-- envelopes and expense line items for financial reconciliation.

CREATE TABLE IF NOT EXISTS grant_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  total_budget numeric DEFAULT 0,
  personnel numeric DEFAULT 0,
  supplies numeric DEFAULT 0,
  equipment numeric DEFAULT 0,
  other numeric DEFAULT 0,
  period_start date,
  period_end date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE grant_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grant_budgets_org" ON grant_budgets
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_grant_budgets_org ON grant_budgets(organization_id);
CREATE INDEX IF NOT EXISTS idx_grant_budgets_application ON grant_budgets(application_id);

CREATE TABLE IF NOT EXISTS grant_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id uuid REFERENCES grant_budgets(id) ON DELETE CASCADE,
  category text,
  description text,
  amount numeric NOT NULL,
  expense_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE grant_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grant_expenses_org" ON grant_expenses
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_grant_expenses_org ON grant_expenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_grant_expenses_budget ON grant_expenses(budget_id);
