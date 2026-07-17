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
