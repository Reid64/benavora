CREATE TABLE IF NOT EXISTS funding_forecasts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  forecast_date        date NOT NULL,
  forecast_period      text NOT NULL,
  projected_min        numeric,
  projected_max        numeric,
  projected_most_likely numeric,
  confidence           numeric,
  methodology          text,
  factors              jsonb NOT NULL DEFAULT '{}',
  key_risks            text[],
  key_opportunities    text[],
  recommended_actions  text[],
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  name         text NOT NULL,
  email        text,
  role         text,
  committee    text[],
  term_start   date,
  term_end     date,
  expertise    text[],
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  meeting_date date NOT NULL,
  meeting_type text NOT NULL DEFAULT 'regular',
  agenda       text,
  status       text NOT NULL DEFAULT 'scheduled',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_meeting_packets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  meeting_id      uuid REFERENCES board_meetings(id) ON DELETE CASCADE,
  packet_content  jsonb NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  viewed_by       text[]
);

CREATE TABLE IF NOT EXISTS impact_simulations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  scenario_type      text NOT NULL,
  scenario_params    jsonb NOT NULL,
  simulation_result  jsonb,
  confidence         text,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  created_by         uuid
);

CREATE INDEX IF NOT EXISTS idx_forecasts_org ON funding_forecasts(org_id, forecast_date);
CREATE INDEX IF NOT EXISTS idx_board_members_org ON board_members(org_id);
CREATE INDEX IF NOT EXISTS idx_board_meetings_org ON board_meetings(org_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_board_packets_org ON board_meeting_packets(org_id);
CREATE INDEX IF NOT EXISTS idx_simulations_org ON impact_simulations(org_id);
