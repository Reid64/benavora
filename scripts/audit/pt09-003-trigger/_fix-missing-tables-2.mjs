// ONE-TIME LOCAL SCAFFOLDING PATCH for PT-09-003 batch 2 remainder (AG-25
// disaster response, AG-25 deadline prediction, AG-28).
//
// Same SAFETY RULE 5 precedent as _fix-missing-tables.mjs: live-checked via a
// direct pg \d before writing this -- disaster_declarations,
// disaster_emergency_funds, deadline_predictions, and application_followups
// all genuinely do NOT exist on the local stack, even though every one of
// them is a real CREATE TABLE IF NOT EXISTS already committed on disk
// (src/supabase/migrations/079_disaster_response.sql,
// 097_deadline_prediction_agent.sql, 081_application_followups.sql). Applying
// the exact, already-committed DDL here (idempotent, IF NOT EXISTS
// throughout) lets this session get a REAL verdict for each agent's own
// code/business logic. agent_type is a plain `text` column on this local
// stack (confirmed via information_schema before writing this), so the
// source migrations' `ALTER TYPE agent_type ADD VALUE ...` statements are
// deliberately omitted.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/_fix-missing-tables-2.mjs

import { setupLocalEnv, pgClient } from "../pt09-003-lib.mjs";

setupLocalEnv();

const DDL = `
-- From src/supabase/migrations/079_disaster_response.sql (AG-25 disaster response)
CREATE TABLE IF NOT EXISTS disaster_declarations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fema_disaster_number   text UNIQUE,
  disaster_type          text,
  incident_type          text,
  affected_states        text[],
  declaration_date       date,
  incident_begin_date    date,
  response_deployed      boolean NOT NULL DEFAULT false,
  response_deployed_at   timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disaster_emergency_funds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  funder          text NOT NULL,
  program_type    text,
  typical_amount  text,
  application_url text,
  notes           text,
  disaster_types  text[],
  active          boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_disaster_decl_states ON disaster_declarations USING gin(affected_states);

-- From src/supabase/migrations/097_deadline_prediction_agent.sql (AG-25 deadline prediction)
CREATE TABLE IF NOT EXISTS deadline_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  predicted_deadline date NOT NULL,
  source text NOT NULL CHECK (source IN ('description_text','sam_gov','web_search','cycle_pattern','estimated_cycle')),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  urgency_tier text CHECK (urgency_tier IN ('red','amber','yellow','green')),
  source_detail text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deadline_predictions_org ON deadline_predictions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deadline_predictions_opportunity ON deadline_predictions(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_deadline_predictions_funder ON deadline_predictions(funder_id);

ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS next_predicted_open_date date,
  ADD COLUMN IF NOT EXISTS avg_cycle_length_days integer;

-- From src/supabase/migrations/081_application_followups.sql (AG-28)
CREATE TABLE IF NOT EXISTS application_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  follow_up_type text NOT NULL CHECK (follow_up_type IN ('check_in','thank_you','feedback_request','renewal_prep')),
  scheduled_date date NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  content text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_followups_org ON application_followups(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_application_followups_application ON application_followups(application_id);
`;

async function main() {
  const db = await pgClient();
  try {
    await db.query(DDL);
    console.log("Local scaffolding patch applied cleanly (idempotent).");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
