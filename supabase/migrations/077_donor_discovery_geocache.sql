-- 077_donor_discovery_geocache.sql — address -> lat/lng/state/county/zip
-- cache for src/lib/donor-discovery/adapters/geocoding-adapter.ts
-- (DONOR_DISCOVERY_ARCHITECTURE.md §4 "New Discovery" wizard geography step).
--
-- Requested as migration "074" in the task, but 074 is already taken by
-- 074_donor_discovery_foundation_linkage_and_scoring.sql (075 and 076 are
-- also in use) — numbered 077 to follow the next-available convention, same
-- as migration 076's renumbering note.
--
-- Keyed by a sha256 hash of the normalized (trimmed, lowercased,
-- whitespace-collapsed) input address string rather than the raw address
-- text, so two equivalent user-typed addresses ("123 Main St, Austin, TX"
-- vs "123  main st, austin, tx ") hit the same cache row. Shared platform-wide
-- cache (no organization_id, no RLS) — same posture as dd_robots_cache
-- (migration 068) and donor_discovery_directory (migration 067): the
-- Geocoding API result for a given address string is a public fact, not
-- tenant data.
--
-- File only — not applied to production per this task's instructions.

CREATE TABLE IF NOT EXISTS donor_discovery_geocache (
  address_hash     text PRIMARY KEY,
  lat              numeric NOT NULL,
  lng              numeric NOT NULL,
  formatted_address text NOT NULL,
  state            text,
  county           text,
  zip              text,
  cached_at        timestamptz NOT NULL DEFAULT now()
);
