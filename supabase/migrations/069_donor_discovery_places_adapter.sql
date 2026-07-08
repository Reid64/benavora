-- 069_donor_discovery_places_adapter.sql — Donor Discovery Google Places
-- adapter support (DONOR_DISCOVERY_ARCHITECTURE.md §2A). Adds the API spend
-- ledger the budget guard in src/lib/donor-discovery/adapters/google-places.ts
-- reads/writes, plus two helper functions: an atomic spend increment (avoids
-- read-then-write races on the monthly counter) and a merge-upsert into
-- donor_discovery_directory (the dedup unique index from migration 067 is
-- built on expressions — lower(legal_name), donor_discovery_extract_domain
-- (website) — which supabase-js's `.upsert(onConflict:)` cannot target
-- directly, since it only accepts plain column names).
--
-- Both new tables/functions are SHARED platform-wide (no organization_id,
-- no RLS) — same posture as donor_discovery_directory and dd_robots_cache.
--
-- File only — not applied to production per this task's instructions.

-- ── dd_api_spend ─────────────────────────────────────────────────────────────
-- Monthly spend ledger per external API provider. `month` is 'YYYY-MM' in
-- UTC, matching the budget guard's rollover check.
create table public.dd_api_spend (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  month         text not null,
  requests      integer not null default 0,
  est_cost_usd  numeric(10, 4) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (provider, month)
);

-- ── donor_discovery_increment_api_spend ─────────────────────────────────────
-- Atomically adds `p_requests`/`p_cost_usd` to the current month's row,
-- creating it on first use. Returns the post-increment row so the caller can
-- compare against its budget cap without a separate read.
create or replace function public.donor_discovery_increment_api_spend(
  p_provider text,
  p_month text,
  p_requests integer,
  p_cost_usd numeric
) returns public.dd_api_spend
language plpgsql
as $$
declare
  v_row public.dd_api_spend;
begin
  insert into public.dd_api_spend (provider, month, requests, est_cost_usd)
  values (p_provider, p_month, p_requests, p_cost_usd)
  on conflict (provider, month)
  do update set
    requests = public.dd_api_spend.requests + excluded.requests,
    est_cost_usd = public.dd_api_spend.est_cost_usd + excluded.est_cost_usd,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ── donor_discovery_upsert_directory ────────────────────────────────────────
-- Merge-upsert for the shared directory. `geo` is stored as a native
-- Postgres `point(x, y)` — x=longitude, y=latitude, matching the
-- (lon, lat) convention `ST_MakePoint`/GeoJSON use, so downstream radius
-- queries built later don't have to guess the axis order. naics_codes and
-- source_adapters are unioned rather than overwritten, since the same
-- directory row is written by every adapter/request that finds it.
create or replace function public.donor_discovery_upsert_directory(
  p_legal_name text,
  p_website text,
  p_hq_address text,
  p_lat double precision,
  p_lng double precision,
  p_phone text,
  p_naics_codes text[],
  p_source_adapter text
) returns public.donor_discovery_directory
language plpgsql
as $$
declare
  v_row public.donor_discovery_directory;
begin
  insert into public.donor_discovery_directory as d
    (legal_name, website, hq_address, geo, phone, naics_codes, source_adapters)
  values
    (
      p_legal_name,
      p_website,
      p_hq_address,
      case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end,
      p_phone,
      coalesce(p_naics_codes, '{}'),
      case when p_source_adapter is not null then array[p_source_adapter] else '{}' end
    )
  on conflict (lower(legal_name), public.donor_discovery_extract_domain(website))
  do update set
    website = coalesce(d.website, excluded.website),
    hq_address = coalesce(excluded.hq_address, d.hq_address),
    geo = coalesce(excluded.geo, d.geo),
    phone = coalesce(excluded.phone, d.phone),
    naics_codes = (select array(select distinct unnest(d.naics_codes || excluded.naics_codes))),
    source_adapters = (select array(select distinct unnest(d.source_adapters || excluded.source_adapters)))
  returning * into v_row;

  return v_row;
end;
$$;
