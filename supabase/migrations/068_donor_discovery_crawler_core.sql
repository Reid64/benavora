-- 068_donor_discovery_crawler_core.sql — Donor Discovery crawler compliance
-- tables (DONOR_DISCOVERY_ARCHITECTURE.md §5). Extends the dd-101 foundation
-- (migration 067) with the robots.txt DB fallback cache and the per-source
-- ToS registry that src/lib/donor-discovery/crawler-core.ts reads from.
--
-- Both tables are SHARED platform-wide reference/cache data (no
-- organization_id, no RLS) — same posture as donor_discovery_taxonomy /
-- donor_discovery_directory (migration 067) and foundation_directory
-- (migration 046).
--
-- File only — not applied to production per this task's instructions.

-- ── dd_robots_cache ──────────────────────────────────────────────────────────
-- DB fallback for the in-memory 24h robots.txt cache in crawler-core.ts.
-- One row per domain; overwritten on every re-fetch.
create table public.dd_robots_cache (
  domain      text primary key,
  robots_txt  text not null default '',
  status_code integer,
  fetched_at  timestamptz not null default now()
);

-- ── donor_discovery_tos_registry ────────────────────────────────────────────
-- Per-source ToS overrides. Absence of a row means "allowed" — this registry
-- only needs to carry the exceptions (domains where scraping is disallowed).
create table public.donor_discovery_tos_registry (
  domain          text primary key,
  scrape_allowed  boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
