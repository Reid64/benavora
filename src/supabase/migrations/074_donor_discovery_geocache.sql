CREATE TABLE IF NOT EXISTS donor_discovery_geocache (
  address_hash      text PRIMARY KEY,
  lat               numeric NOT NULL,
  lng               numeric NOT NULL,
  formatted_address text NOT NULL,
  state             text,
  county            text,
  zip               text,
  cached_at         timestamptz NOT NULL DEFAULT now()
);
